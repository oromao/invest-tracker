from __future__ import annotations

import json
import logging
from datetime import datetime, timezone
from typing import List

import httpx
import redis.asyncio as aioredis
from fastapi import APIRouter, Depends
from sqlalchemy import desc, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.schemas import PortfolioPosition, PortfolioResponse
from app.config import settings
from app.db.models import OHLCVBar, Position, Signal, Trade
from app.db.session import get_db

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/portfolio", tags=["portfolio"])


async def _latest_price(db: AsyncSession, asset: str) -> float | None:
    stmt = (
        select(OHLCVBar.close)
        .where(OHLCVBar.asset == asset)
        .order_by(desc(OHLCVBar.timestamp))
        .limit(1)
    )
    result = await db.execute(stmt)
    return result.scalar_one_or_none()


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
                entry = float(p.get("entry_price", 0.0) or 0.0)
                current = float(p.get("current_price", entry) or entry)
                size = float(p.get("size", 0.0) or 0.0)
                direction = p.get("direction", "LONG")
                pnl = (current - entry) * size if direction == "LONG" else (entry - current) * size
                pnl_pct = (pnl / (entry * size)) if entry * size > 0 else 0.0
                positions.append(
                    PortfolioPosition(
                        asset=p.get("asset", ""),
                        side=direction,
                        direction=direction,
                        entry_price=entry,
                        current_price=current,
                        size=size,
                        pnl=pnl,
                        pnl_pct=pnl_pct,
                        last_signal_id=str(p.get("signal_id")) if p.get("signal_id") is not None else None,
                    )
                )
        except Exception as exc:
            logger.warning("Failed to parse paper positions: %s", exc)

    capital = settings.paper_trading_initial_capital
    total_pnl = 0.0
    daily_pnl = 0.0
    if stats_raw:
        try:
            stats = json.loads(stats_raw)
            capital = float(stats.get("capital", capital))
            total_pnl = float(stats.get("total_pnl", 0.0))
            daily_pnl = float(stats.get("daily_pnl", 0.0))
        except Exception:
            pass

    invested = sum(p.entry_price * p.size for p in positions)
    total_value = capital + invested
    daily_pnl_pct = daily_pnl / total_value if total_value > 0 else 0.0
    total_pnl_pct = (
        total_pnl / settings.paper_trading_initial_capital
        if settings.paper_trading_initial_capital > 0
        else 0.0
    )

    return PortfolioResponse(
        total_value=total_value,
        cash=capital,
        invested=invested,
        open_pnl=total_pnl,
        daily_pnl=daily_pnl,
        daily_pnl_pct=daily_pnl_pct,
        total_pnl=total_pnl,
        total_pnl_pct=total_pnl_pct,
        active_positions=len(positions),
        positions=positions,
        timestamp=datetime.now(tz=timezone.utc),
    )


async def _build_db_response(db: AsyncSession) -> PortfolioResponse:
    stmt = select(Position).where(Position.status == "open").order_by(desc(Position.opened_at))
    result = await db.execute(stmt)
    positions = result.scalars().all()

    if not positions:
        now = datetime.now(tz=timezone.utc)
        return PortfolioResponse(
            total_value=0.0,
            cash=0.0,
            invested=0.0,
            open_pnl=0.0,
            daily_pnl=0.0,
            daily_pnl_pct=0.0,
            total_pnl=0.0,
            total_pnl_pct=0.0,
            active_positions=0,
            positions=[],
            timestamp=now,
        )

    latest_prices: dict[str, float] = {}
    for position in positions:
        if position.asset not in latest_prices:
            latest_prices[position.asset] = await _latest_price(db, position.asset) or position.entry_price

    open_positions: List[PortfolioPosition] = []
    invested = 0.0
    open_pnl = 0.0
    for position in positions:
        current_price = latest_prices.get(position.asset, position.entry_price)
        side = position.side.value if hasattr(position.side, "value") else str(position.side)
        pnl = (current_price - position.entry_price) * position.size
        if side == "SHORT":
            pnl = (position.entry_price - current_price) * position.size
        invested_value = position.entry_price * position.size
        invested += invested_value
        open_pnl += pnl
        pnl_pct = (pnl / invested_value * 100.0) if invested_value > 0 else 0.0

        last_signal_stmt = (
            select(Signal.id)
            .where(Signal.asset == position.asset)
            .order_by(desc(Signal.timestamp))
            .limit(1)
        )
        last_signal_result = await db.execute(last_signal_stmt)
        last_signal_id = last_signal_result.scalar_one_or_none()

        open_positions.append(
            PortfolioPosition(
                id=position.id,
                asset=position.asset,
                side=side,
                direction=side,
                entry_price=position.entry_price,
                current_price=current_price,
                size=position.size,
                pnl=pnl,
                pnl_pct=pnl_pct,
                last_signal_id=str(last_signal_id) if last_signal_id is not None else None,
            )
        )

    now = datetime.now(tz=timezone.utc)
    midnight = now.replace(hour=0, minute=0, second=0, microsecond=0)
    trades_stmt = select(Trade.pnl).where(Trade.exit_time >= midnight)
    trades_result = await db.execute(trades_stmt)
    daily_pnl = sum(float(row or 0.0) for row in trades_result.scalars().all())

    total_value = sum(p.current_price * p.size for p in open_positions)
    total_pnl = open_pnl + daily_pnl

    return PortfolioResponse(
        total_value=total_value,
        cash=0.0,
        invested=invested,
        open_pnl=open_pnl,
        daily_pnl=daily_pnl,
        daily_pnl_pct=(daily_pnl / total_value * 100.0) if total_value > 0 else 0.0,
        total_pnl=total_pnl,
        total_pnl_pct=(open_pnl / invested * 100.0) if invested > 0 else 0.0,
        active_positions=len(open_positions),
        positions=open_positions,
        timestamp=now,
    )


@router.get("", response_model=PortfolioResponse)
async def get_portfolio(db: AsyncSession = Depends(get_db)):
    """
    Portfolio overview.
    Prefer external invest-tracker API when configured, otherwise use real DB-backed
    positions and paper-trading Redis state as a fallback.
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
            logger.warning("Failed to fetch portfolio from invest-tracker API: %s", exc)

    db_response = await _build_db_response(db)
    if db_response.active_positions and db_response.positions:
        return db_response

    return await _build_paper_response()
