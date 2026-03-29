from __future__ import annotations

import json
import logging
from datetime import datetime, timezone
from typing import List

import httpx
import redis.asyncio as aioredis
from fastapi import APIRouter

from app.api.schemas import PortfolioPosition, PortfolioResponse
from app.config import settings

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/portfolio", tags=["portfolio"])


async def _build_paper_response() -> PortfolioResponse:
    """Build portfolio response from paper trading state in Redis."""
    r = aioredis.from_url(settings.redis_url, decode_responses=True)
    try:
        positions_raw = await r.get("alpha:paper:positions")
        stats_raw = await r.get("alpha:paper:stats")
    finally:
        await r.aclose()

    positions: List[PortfolioPosition] = []
    if positions_raw:
        try:
            for p in json.loads(positions_raw):
                entry = p.get("entry_price", 0.0) or 0.0
                current = p.get("current_price", entry) or entry
                size = p.get("size", 0.0) or 0.0
                direction = p.get("direction", "LONG")
                pnl = (current - entry) * size if direction == "LONG" else (entry - current) * size
                pnl_pct = (pnl / (entry * size)) if entry * size > 0 else 0.0
                positions.append(PortfolioPosition(
                    asset=p.get("asset", ""),
                    direction=direction,
                    entry_price=entry,
                    current_price=current,
                    size=size,
                    pnl=round(pnl, 4),
                    pnl_pct=round(pnl_pct, 6),
                ))
        except Exception as exc:
            logger.warning("Failed to parse paper positions: %s", exc)

    capital = settings.paper_trading_initial_capital
    total_pnl = 0.0
    daily_pnl = 0.0
    if stats_raw:
        try:
            stats = json.loads(stats_raw)
            capital = stats.get("capital", capital)
            total_pnl = stats.get("total_pnl", 0.0)
            daily_pnl = stats.get("daily_pnl", 0.0)
        except Exception:
            pass

    invested = sum(p.entry_price * p.size for p in positions)
    total_value = capital + invested
    daily_pnl_pct = daily_pnl / total_value if total_value > 0 else 0.0
    total_pnl_pct = total_pnl / settings.paper_trading_initial_capital if settings.paper_trading_initial_capital > 0 else 0.0

    return PortfolioResponse(
        total_value=total_value,
        cash=capital,
        invested=invested,
        daily_pnl=daily_pnl,
        daily_pnl_pct=daily_pnl_pct,
        total_pnl=total_pnl,
        total_pnl_pct=total_pnl_pct,
        positions=positions,
        timestamp=datetime.now(tz=timezone.utc),
    )


@router.get("", response_model=PortfolioResponse)
async def get_portfolio():
    """
    Portfolio overview. Returns live paper trading state from Redis.
    Falls back to invest-tracker API if configured.
    """
    if settings.invest_tracker_url:
        try:
            async with httpx.AsyncClient(timeout=3.0) as client:
                resp = await client.get(f"{settings.invest_tracker_url}/api/portfolio")
                resp.raise_for_status()
                data = resp.json()
                if data:
                    return PortfolioResponse(**data)
        except Exception as exc:
            logger.warning("invest-tracker API unavailable: %s — using paper state", exc)

    return await _build_paper_response()
