from __future__ import annotations

import asyncio
import json
import logging
import time
from datetime import datetime, timezone
from typing import Optional

import websockets
from sqlalchemy.dialects.postgresql import insert as pg_insert

from app.config import settings
from app.data.validator import validate_and_clean_bars
from app.db.models import OHLCVBar
from app.db.session import AsyncSessionLocal
from app.shared.time import ensure_timezone

logger = logging.getLogger(__name__)

WS_BASE = "wss://stream.binance.com:9443/stream"

# Reconnect: 5s, 10s, 20s, 40s, 60s max
_BASE_RECONNECT_DELAY = 5
_MAX_RECONNECT_DELAY = 60


def _symbol_to_stream(asset: str) -> str:
    return f"{asset.replace('/', '').lower()}@kline_1m"


class BinanceWSIngestor:
    def __init__(self) -> None:
        self._running = False
        self._task: Optional[asyncio.Task] = None
        self._last_msg_time: float = 0.0
        self._reconnect_count: int = 0
        self._bars_received: int = 0

    def start(self) -> asyncio.Task:
        self._running = True
        self._task = asyncio.create_task(self._run_forever())
        return self._task

    def stop(self) -> None:
        self._running = False
        if self._task and not self._task.done():
            self._task.cancel()

    async def _run_forever(self) -> None:
        attempt = 0
        while self._running:
            try:
                await self._connect_and_listen()
                attempt = 0  # reset on clean exit
            except asyncio.CancelledError:
                logger.info("WS ingestor cancelled")
                break
            except Exception as exc:
                self._reconnect_count += 1
                delay = min(_BASE_RECONNECT_DELAY * (2 ** attempt), _MAX_RECONNECT_DELAY)
                logger.error(
                    "WS error (attempt=%d reconnects=%d): %s — retrying in %ds",
                    attempt + 1, self._reconnect_count, exc, delay,
                )
                attempt += 1
                await asyncio.sleep(delay)

    async def _connect_and_listen(self) -> None:
        streams = [_symbol_to_stream(a) for a in settings.assets]
        url = f"{WS_BASE}?streams={'/'.join(streams)}"
        heartbeat_timeout = settings.ws_heartbeat_timeout

        logger.info("Connecting Binance WS: %s", url)
        async with websockets.connect(
            url,
            ping_interval=20,
            ping_timeout=10,
            close_timeout=5,
        ) as ws:
            logger.info("WS connected — listening for klines")
            self._last_msg_time = time.monotonic()

            while self._running:
                try:
                    # Use explicit recv() with timeout to detect silent feeds
                    raw_msg = await asyncio.wait_for(
                        ws.recv(), timeout=heartbeat_timeout
                    )
                    self._last_msg_time = time.monotonic()
                except asyncio.TimeoutError:
                    silent_for = time.monotonic() - self._last_msg_time
                    logger.warning(
                        "WS silent for %.0fs (threshold=%ds) — forcing reconnect",
                        silent_for, heartbeat_timeout,
                    )
                    raise ConnectionError("WS heartbeat timeout")
                except websockets.ConnectionClosed as exc:
                    logger.warning("WS closed by server: %s", exc)
                    raise

                try:
                    await self._handle_message(raw_msg)
                except Exception as exc:
                    logger.error("WS message handling error: %s", exc)

    async def _handle_message(self, raw_msg: str) -> None:
        data = json.loads(raw_msg)
        payload = data.get("data", data)

        if payload.get("e") != "kline":
            return

        kline = payload["k"]
        if not kline.get("x", False):  # only closed candles
            return

        symbol_raw = kline["s"]
        asset = self._normalize_symbol(symbol_raw)
        if asset is None:
            return

        ts = ensure_timezone(datetime.fromtimestamp(int(kline["t"]) / 1000, tz=timezone.utc))
        bar = {
            "asset": asset,
            "timeframe": "1m",
            "timestamp": ts,
            "open": float(kline["o"]),
            "high": float(kline["h"]),
            "low": float(kline["l"]),
            "close": float(kline["c"]),
            "volume": float(kline["v"]),
        }

        # Validate before writing to DB
        clean, vr = validate_and_clean_bars([bar], "1m", asset)
        if not clean:
            logger.warning("WS bar rejected for %s: %s", asset, vr.issues[:2])
            return

        clean_bar = clean[0]
        db_row = {
            "asset": clean_bar["asset"],
            "timeframe": clean_bar["timeframe"],
            "timestamp": clean_bar["timestamp"],
            "open": clean_bar["open"],
            "high": clean_bar["high"],
            "low": clean_bar["low"],
            "close": clean_bar["close"],
            "volume": clean_bar["volume"],
            "funding_rate": None,
            "open_interest": None,
            "mark_price": None,
        }

        async with AsyncSessionLocal() as session:
            stmt = (
                pg_insert(OHLCVBar)
                .values([db_row])
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
                await self._aggregate_higher_timeframes(session, asset, db_row)
            except Exception as exc:
                logger.error("Higher TF aggregation error %s: %s", asset, exc)

        self._bars_received += 1
        logger.debug("WS bar %s 1m @ %s (total=%d)", asset, ts, self._bars_received)

    async def _aggregate_higher_timeframes(self, db, asset: str, bar_1m: dict) -> None:
        from sqlalchemy import select

        ts: datetime = bar_1m["timestamp"]

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

            stmt = (
                select(OHLCVBar)
                .where(OHLCVBar.asset == asset, OHLCVBar.timeframe == "1m")
                .order_by(OHLCVBar.timestamp.desc())
                .limit(n_bars)
            )
            result = await db.execute(stmt)
            rows = result.scalars().all()

            if len(rows) < n_bars:
                continue

            rows_asc = list(reversed(rows))
            fr_values = [r.funding_rate for r in rows_asc if r.funding_rate is not None]
            oi_values = [r.open_interest for r in rows_asc if r.open_interest is not None]

            agg_bar = {
                "asset": asset,
                "timeframe": tf_label,
                "timestamp": rows_asc[0].timestamp,
                "open": rows_asc[0].open,
                "high": max(r.high for r in rows_asc),
                "low": min(r.low for r in rows_asc),
                "close": rows_asc[-1].close,
                "volume": sum(r.volume for r in rows_asc),
                "funding_rate": sum(fr_values) / len(fr_values) if fr_values else None,
                "open_interest": sum(oi_values) / len(oi_values) if oi_values else None,
                "mark_price": None,
            }

            upsert = (
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
            await db.execute(upsert)
            await db.commit()
            logger.debug("Aggregated %s bar for %s at %s", tf_label, asset, agg_bar["timestamp"])

    def _normalize_symbol(self, raw: str) -> Optional[str]:
        raw_upper = raw.upper()
        for asset in settings.assets:
            if asset.replace("/", "").upper() == raw_upper:
                return asset
        for quote in ("USDT", "BUSD", "BTC", "ETH", "BNB"):
            if raw_upper.endswith(quote):
                return f"{raw_upper[:-len(quote)]}/{quote}"
        return None
