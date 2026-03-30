from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timezone
from typing import List, Optional

import ccxt.async_support as ccxt
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.data.validator import validate_and_clean_bars
from app.db.models import OHLCVBar
from app.db.session import AsyncSessionLocal
from app.observability.metrics import record_market_update
from app.shared.time import ensure_timezone

logger = logging.getLogger(__name__)

_RETRY_DELAYS = (2, 4, 8)  # seconds between retries


async def _retry_async(coro_fn, *args, label: str = "ccxt", **kwargs):
    """Call an async function with exponential-backoff retry."""
    last_exc: Exception = RuntimeError("unreachable")
    for attempt, delay in enumerate((*_RETRY_DELAYS, None), start=1):
        try:
            return await coro_fn(*args, **kwargs)
        except Exception as exc:
            last_exc = exc
            if delay is None:
                break
            logger.warning("%s attempt %d failed: %s — retrying in %ds", label, attempt, exc, delay)
            await asyncio.sleep(delay)
    logger.error("%s failed after %d attempts: %s", label, len(_RETRY_DELAYS) + 1, last_exc)
    return None


class CCXTIngestor:
    def __init__(self) -> None:
        self.exchange: Optional[ccxt.binance] = None
        self._closed: bool = False

    async def _get_exchange(self) -> ccxt.binance:
        if self.exchange is None or self._closed:
            self._closed = False
            self.exchange = ccxt.binance(
                {
                    "apiKey": settings.binance_api_key or None,
                    "secret": settings.binance_api_secret or None,
                    "enableRateLimit": True,
                    "options": {"defaultType": "future"},
                }
            )
        return self.exchange

    async def close(self) -> None:
        if self.exchange and not self._closed:
            try:
                await self.exchange.close()
            except Exception:
                pass
            finally:
                self._closed = True
                self.exchange = None

    async def fetch_ohlcv(
        self,
        asset: str,
        timeframe: str,
        limit: int = 500,
    ) -> List[dict]:
        async def _fetch():
            exchange = await self._get_exchange()
            raw = await exchange.fetch_ohlcv(asset, timeframe, limit=limit)
            bars = []
            for row in raw:
                ts, o, h, l, c, v = row
                bars.append(
                    {
                        "asset": asset,
                        "timeframe": timeframe,
                        "timestamp": ensure_timezone(datetime.fromtimestamp(ts / 1000, tz=timezone.utc)),
                        "open": float(o),
                        "high": float(h),
                        "low": float(l),
                        "close": float(c),
                        "volume": float(v),
                    }
                )
            return bars

        result = await _retry_async(_fetch, label=f"fetch_ohlcv/{asset}/{timeframe}")
        if result is None:
            return []

        # Validate and clean before returning
        clean, vr = validate_and_clean_bars(result, timeframe, asset)
        if vr.rejected_count > 0:
            logger.warning(
                "Dropped %d invalid bars for %s/%s",
                vr.rejected_count, asset, timeframe,
            )
        return clean

    async def fetch_funding_rate(self, asset: str) -> Optional[float]:
        async def _fetch():
            exchange = await self._get_exchange()
            result = await exchange.fetch_funding_rate(asset)
            return float(result.get("fundingRate", 0.0) or 0.0)

        val = await _retry_async(_fetch, label=f"funding_rate/{asset}")
        if val is None:
            logger.debug("fetch_funding_rate %s: all retries failed", asset)
        return val

    async def fetch_open_interest(self, asset: str) -> Optional[float]:
        async def _fetch():
            exchange = await self._get_exchange()
            result = await exchange.fetch_open_interest(asset)
            val = result.get("openInterestAmount") or result.get("openInterest")
            return float(val) if val is not None else None

        val = await _retry_async(_fetch, label=f"open_interest/{asset}")
        if val is None:
            logger.debug("fetch_open_interest %s: all retries failed", asset)
        return val

    async def fetch_mark_price(self, asset: str) -> Optional[float]:
        async def _fetch():
            exchange = await self._get_exchange()
            ticker = await exchange.fetch_ticker(asset)
            return float(ticker.get("last") or ticker.get("close") or 0.0)

        val = await _retry_async(_fetch, label=f"mark_price/{asset}")
        if val is None:
            logger.debug("fetch_mark_price %s: all retries failed", asset)
        return val

    async def upsert_bars(
        self,
        session: AsyncSession,
        bars: List[dict],
        funding_rate: Optional[float],
        open_interest: Optional[float],
        mark_price: Optional[float],
    ) -> int:
        if not bars:
            return 0

        rows = [
            {
                "asset": bar["asset"],
                "timeframe": bar["timeframe"],
                "timestamp": bar["timestamp"],
                "open": bar["open"],
                "high": bar["high"],
                "low": bar["low"],
                "close": bar["close"],
                "volume": bar["volume"],
                "funding_rate": funding_rate,
                "open_interest": open_interest,
                "mark_price": mark_price,
            }
            for bar in bars
        ]

        stmt = (
            pg_insert(OHLCVBar)
            .values(rows)
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
                    "mark_price": pg_insert(OHLCVBar).excluded.mark_price,
                },
            )
        )
        await session.execute(stmt)
        return len(rows)

    async def ingest_asset_timeframe(self, asset: str, timeframe: str) -> int:
        bars = await self.fetch_ohlcv(asset, timeframe)
        if not bars:
            return 0

        funding_rate = None
        open_interest = None
        mark_price = None

        # Only fetch funding/OI for primary timeframes to avoid rate limits
        if timeframe in ("1h", "4h", "1d"):
            funding_rate = await self.fetch_funding_rate(asset)
            await asyncio.sleep(0.1)
            open_interest = await self.fetch_open_interest(asset)
            await asyncio.sleep(0.1)
            mark_price = await self.fetch_mark_price(asset)
            await asyncio.sleep(0.1)

        async with AsyncSessionLocal() as session:
            count = await self.upsert_bars(session, bars, funding_rate, open_interest, mark_price)
            await session.commit()

        if bars:
            record_market_update(asset, timeframe, bars[-1]["timestamp"], count)
        logger.info("Ingested %d bars for %s/%s", count, asset, timeframe)
        return count

    async def run_full_ingest(self) -> None:
        exchange = await self._get_exchange()
        try:
            for asset in settings.assets:
                for timeframe in settings.timeframes:
                    try:
                        await self.ingest_asset_timeframe(asset, timeframe)
                        await asyncio.sleep(0.3)
                    except Exception as exc:
                        logger.error("Ingest error %s/%s: %s", asset, timeframe, exc)
        finally:
            await self.close()
