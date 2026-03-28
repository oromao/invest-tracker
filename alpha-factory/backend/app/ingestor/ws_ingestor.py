from __future__ import annotations

import asyncio
import json
import logging
from datetime import datetime, timezone
from typing import List, Optional

import websockets
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.db.models import OHLCVBar
from app.db.session import AsyncSessionLocal

logger = logging.getLogger(__name__)

WS_BASE = "wss://stream.binance.com:9443/stream"
RECONNECT_DELAY = 5  # seconds


def _symbol_to_stream(asset: str) -> str:
    """Convert 'BTC/USDT' -> 'btcusdt@kline_1m'"""
    symbol = asset.replace("/", "").lower()
    return f"{symbol}@kline_1m"


class BinanceWSIngestor:
    def __init__(self) -> None:
        self._running = False
        self._task: Optional[asyncio.Task] = None

    def start(self) -> asyncio.Task:
        self._running = True
        self._task = asyncio.create_task(self._run_forever())
        return self._task

    def stop(self) -> None:
        self._running = False
        if self._task and not self._task.done():
            self._task.cancel()

    async def _run_forever(self) -> None:
        while self._running:
            try:
                await self._connect_and_listen()
            except asyncio.CancelledError:
                logger.info("WS ingestor cancelled")
                break
            except Exception as exc:
                logger.error("WS connection error: %s. Reconnecting in %ds...", exc, RECONNECT_DELAY)
                await asyncio.sleep(RECONNECT_DELAY)

    async def _connect_and_listen(self) -> None:
        streams = [_symbol_to_stream(a) for a in settings.assets]
        stream_path = "/".join(streams)
        url = f"{WS_BASE}?streams={stream_path}"

        logger.info("Connecting to Binance WS: %s", url)
        async with websockets.connect(
            url,
            ping_interval=20,
            ping_timeout=10,
            close_timeout=5,
        ) as ws:
            logger.info("WS connected, listening for klines...")
            async for raw_msg in ws:
                if not self._running:
                    break
                try:
                    await self._handle_message(raw_msg)
                except Exception as exc:
                    logger.error("WS message handling error: %s", exc)

    async def _handle_message(self, raw_msg: str) -> None:
        data = json.loads(raw_msg)
        # Combined stream format: {"stream": "btcusdt@kline_1m", "data": {...}}
        payload = data.get("data", data)
        if payload.get("e") != "kline":
            return

        kline = payload["k"]
        is_closed = kline.get("x", False)
        if not is_closed:
            return

        symbol_raw = kline["s"]  # e.g. "BTCUSDT"
        # Convert back to asset format "BTC/USDT"
        asset = self._normalize_symbol(symbol_raw)
        if asset is None:
            return

        ts = datetime.fromtimestamp(int(kline["t"]) / 1000, tz=timezone.utc)
        bar = {
            "asset": asset,
            "timeframe": "1m",
            "timestamp": ts,
            "open": float(kline["o"]),
            "high": float(kline["h"]),
            "low": float(kline["l"]),
            "close": float(kline["c"]),
            "volume": float(kline["v"]),
            "funding_rate": None,
            "open_interest": None,
            "mark_price": None,
        }

        async with AsyncSessionLocal() as session:
            stmt = (
                pg_insert(OHLCVBar)
                .values([bar])
                .on_conflict_do_update(
                    constraint="uq_ohlcv_asset_tf_ts",
                    set_={
                        "open": pg_insert(OHLCVBar).excluded.open,
                        "high": pg_insert(OHLCVBar).excluded.high,
                        "low": pg_insert(OHLCVBar).excluded.low,
                        "close": pg_insert(OHLCVBar).excluded.close,
                        "volume": pg_insert(OHLCVBar).excluded.volume,
                    },
                )
            )
            await session.execute(stmt)
            await session.commit()

            try:
                await self._aggregate_higher_timeframes(session, asset, bar)
            except Exception as exc:
                logger.error("Higher TF aggregation error for %s: %s", asset, exc)

        logger.debug("WS upserted 1m bar for %s at %s", asset, ts)

    async def _aggregate_higher_timeframes(self, db: AsyncSession, asset: str, bar_1m: dict) -> None:
        """Aggregate 1m bars into higher timeframes (5m, 15m, 1h, 4h, 1d) when a TF boundary is reached."""
        ts: datetime = bar_1m["timestamp"]

        # (timeframe_label, num_1m_bars, boundary_check_fn)
        tf_configs = [
            ("5m",  5,    lambda t: t.minute % 5 == 4),
            ("15m", 15,   lambda t: t.minute % 15 == 14),
            ("1h",  60,   lambda t: t.minute == 59),
            ("4h",  240,  lambda t: t.hour % 4 == 3 and t.minute == 59),
            ("1d",  1440, lambda t: t.hour == 23 and t.minute == 59),
        ]

        for tf_label, n_bars, boundary_check in tf_configs:
            if not boundary_check(ts):
                continue

            # Query the last N 1m bars for this asset (ordered ascending)
            stmt = (
                select(OHLCVBar)
                .where(OHLCVBar.asset == asset, OHLCVBar.timeframe == "1m")
                .order_by(OHLCVBar.timestamp.desc())
                .limit(n_bars)
            )
            result = await db.execute(stmt)
            rows = result.scalars().all()

            if len(rows) < n_bars:
                logger.debug("Not enough 1m bars to aggregate %s for %s (have %d, need %d)", tf_label, asset, len(rows), n_bars)
                continue

            # Rows are desc; reverse to ascending order
            rows_asc = list(reversed(rows))

            agg_open = rows_asc[0].open
            agg_high = max(r.high for r in rows_asc)
            agg_low = min(r.low for r in rows_asc)
            agg_close = rows_asc[-1].close
            agg_volume = sum(r.volume for r in rows_asc)

            fr_values = [r.funding_rate for r in rows_asc if r.funding_rate is not None]
            agg_funding_rate = sum(fr_values) / len(fr_values) if fr_values else None

            oi_values = [r.open_interest for r in rows_asc if r.open_interest is not None]
            agg_open_interest = sum(oi_values) / len(oi_values) if oi_values else None

            # Use the timestamp of the first bar in the window as the TF bar timestamp
            agg_ts = rows_asc[0].timestamp

            agg_bar = {
                "asset": asset,
                "timeframe": tf_label,
                "timestamp": agg_ts,
                "open": agg_open,
                "high": agg_high,
                "low": agg_low,
                "close": agg_close,
                "volume": agg_volume,
                "funding_rate": agg_funding_rate,
                "open_interest": agg_open_interest,
                "mark_price": None,
            }

            upsert_stmt = (
                pg_insert(OHLCVBar)
                .values([agg_bar])
                .on_conflict_do_update(
                    constraint="uq_ohlcv_asset_tf_ts",
                    set_={
                        "open": pg_insert(OHLCVBar).excluded.open,
                        "high": pg_insert(OHLCVBar).excluded.high,
                        "low": pg_insert(OHLCVBar).excluded.low,
                        "close": pg_insert(OHLCVBar).excluded.close,
                        "volume": pg_insert(OHLCVBar).excluded.volume,
                        "funding_rate": pg_insert(OHLCVBar).excluded.funding_rate,
                        "open_interest": pg_insert(OHLCVBar).excluded.open_interest,
                    },
                )
            )
            await db.execute(upsert_stmt)
            await db.commit()
            logger.debug("Aggregated %s bar for %s at %s", tf_label, asset, agg_ts)

    def _normalize_symbol(self, raw: str) -> Optional[str]:
        """Convert 'BTCUSDT' to 'BTC/USDT' by matching against settings.assets."""
        raw_upper = raw.upper()
        for asset in settings.assets:
            normalized = asset.replace("/", "").upper()
            if normalized == raw_upper:
                return asset
        # Fallback: try common quote currencies
        for quote in ("USDT", "BUSD", "BTC", "ETH", "BNB"):
            if raw_upper.endswith(quote):
                base = raw_upper[: -len(quote)]
                return f"{base}/{quote}"
        return None
