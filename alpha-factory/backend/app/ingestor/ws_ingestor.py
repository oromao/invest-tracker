from __future__ import annotations

import asyncio
import json
import logging
from datetime import datetime, timezone
from typing import List, Optional

import websockets
from sqlalchemy.dialects.postgresql import insert as pg_insert

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

        logger.debug("WS upserted 1m bar for %s at %s", asset, ts)

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
