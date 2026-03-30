from __future__ import annotations

import json
import logging
from typing import List, Optional

import redis.asyncio as aioredis
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query
from sqlalchemy import desc, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.schemas import SignalGenerateRequest, SignalResponse
from app.config import settings
from app.db.models import Signal
from app.db.session import get_db
from app.shared.time import to_sao_paulo

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/signals", tags=["signals"])

redis_client = aioredis.from_url(settings.redis_url, decode_responses=True)

_SIGNALS_CACHE_KEY = "alpha:signals:latest"
_SIGNALS_CACHE_TTL = 30  # seconds


def _signal_to_response(s: Signal) -> SignalResponse:
    return SignalResponse(
        id=s.id,
        asset=s.asset,
        timeframe=s.timeframe,
        timestamp=to_sao_paulo(s.timestamp),
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
        created_at=to_sao_paulo(s.created_at),
    )


@router.get("", response_model=List[SignalResponse])
async def list_latest_signals(
    limit: int = Query(50, le=200),
    db: AsyncSession = Depends(get_db),
):
    """List the latest signals (one per asset+timeframe, most recent first). Response is cached in Redis for 30s."""
    # Try Redis cache first
    try:
        cached = await redis_client.get(_SIGNALS_CACHE_KEY)
        if cached is not None:
            return json.loads(cached)
    except Exception as exc:
        logger.warning("Redis GET failed (non-fatal): %s", exc)

    # Latest signal per (asset, timeframe) so 1h and 4h signals coexist
    subq = (
        select(Signal.asset, Signal.timeframe, func.max(Signal.timestamp).label("max_ts"))
        .group_by(Signal.asset, Signal.timeframe)
        .subquery()
    )
    stmt = select(Signal).join(
        subq,
        (Signal.asset == subq.c.asset)
        & (Signal.timeframe == subq.c.timeframe)
        & (Signal.timestamp == subq.c.max_ts),
    ).order_by(desc(Signal.timestamp)).limit(limit)
    result = await db.execute(stmt)
    signals = result.scalars().all()
    response_data = [_signal_to_response(s) for s in signals]

    # Populate cache
    try:
        serialized = json.dumps([r.model_dump(mode="json") for r in response_data])
        await redis_client.set(_SIGNALS_CACHE_KEY, serialized, ex=_SIGNALS_CACHE_TTL)
    except Exception as exc:
        logger.warning("Redis SET failed (non-fatal): %s", exc)

    return response_data


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


async def _background_generate_all(timeframe: str) -> None:
    from app.signals.engine import SignalEngine
    engine = SignalEngine()
    try:
        await engine.generate_all_signals(timeframe=timeframe)
    except Exception as exc:
        import logging
        logging.getLogger(__name__).error("Background generate_all error: %s", exc)


@router.post("/generate", status_code=202)
async def trigger_signal_generation(
    background_tasks: BackgroundTasks,
    req: Optional[SignalGenerateRequest] = None,
):
    """Trigger signal generation. If asset is omitted generates for all configured assets."""
    asset = req.asset if req and req.asset else None
    timeframe = req.timeframe if req else "1h"
    if asset:
        background_tasks.add_task(_background_generate, asset, timeframe)
    else:
        background_tasks.add_task(_background_generate_all, timeframe)
    return {"status": "accepted", "asset": asset or "ALL", "timeframe": timeframe}
