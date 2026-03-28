from __future__ import annotations

import json
from typing import List, Optional

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query
from sqlalchemy import desc, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.schemas import SignalGenerateRequest, SignalResponse
from app.db.models import Signal
from app.db.session import get_db

router = APIRouter(prefix="/signals", tags=["signals"])


def _signal_to_response(s: Signal) -> SignalResponse:
    return SignalResponse(
        id=s.id,
        asset=s.asset,
        timeframe=s.timeframe,
        timestamp=s.timestamp,
        direction=s.direction.value if hasattr(s.direction, "value") else s.direction,
        confidence=s.confidence,
        entry_price=s.entry_price,
        tp1=s.tp1,
        tp2=s.tp2,
        sl=s.sl,
        regime=s.regime,
        rag_context=s.rag_context,
        explanation=s.explanation,
        strategy_id=s.strategy_id,
        created_at=s.created_at,
    )


@router.get("", response_model=List[SignalResponse])
async def list_latest_signals(
    limit: int = Query(50, le=200),
    db: AsyncSession = Depends(get_db),
):
    """List the latest signals (one per asset, most recent first)."""
    subq = (
        select(Signal.asset, func.max(Signal.timestamp).label("max_ts"))
        .group_by(Signal.asset)
        .subquery()
    )
    stmt = select(Signal).join(
        subq,
        (Signal.asset == subq.c.asset) & (Signal.timestamp == subq.c.max_ts),
    ).order_by(desc(Signal.timestamp)).limit(limit)
    result = await db.execute(stmt)
    signals = result.scalars().all()
    return [_signal_to_response(s) for s in signals]


@router.get("/{asset}", response_model=List[SignalResponse])
async def get_signal_history(
    asset: str,
    timeframe: Optional[str] = None,
    limit: int = Query(100, le=500),
    db: AsyncSession = Depends(get_db),
):
    """Get signal history for a specific asset."""
    asset_normalized = asset.replace("-", "/").upper()
    stmt = (
        select(Signal)
        .where(Signal.asset == asset_normalized)
        .order_by(desc(Signal.timestamp))
        .limit(limit)
    )
    if timeframe:
        stmt = stmt.where(Signal.timeframe == timeframe)
    result = await db.execute(stmt)
    signals = result.scalars().all()
    return [_signal_to_response(s) for s in signals]


async def _background_generate(asset: str, timeframe: str) -> None:
    from app.signals.engine import SignalEngine
    engine = SignalEngine()
    try:
        await engine.generate_signal(asset, timeframe)
    except Exception as exc:
        import logging
        logging.getLogger(__name__).error("Background signal error: %s", exc)


@router.post("/generate", status_code=202)
async def trigger_signal_generation(
    req: SignalGenerateRequest,
    background_tasks: BackgroundTasks,
):
    """Manually trigger signal generation for a specific asset."""
    background_tasks.add_task(_background_generate, req.asset, req.timeframe)
    return {"status": "accepted", "asset": req.asset, "timeframe": req.timeframe}
