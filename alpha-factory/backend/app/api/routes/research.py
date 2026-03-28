from __future__ import annotations

import json
import logging
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.schemas import ResearchCycleRequest, StatusUpdateRequest, StrategyResponse
from app.db.models import Strategy, StrategyStatusEnum
from app.db.session import get_db
from app.registry.strategies import StrategyRegistry

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/research", tags=["research"])
registry = StrategyRegistry()


def _strat_to_response(s: Strategy) -> StrategyResponse:
    params = None
    if s.params_json:
        try:
            params = json.loads(s.params_json)
        except Exception:
            pass
    return StrategyResponse(
        id=s.id,
        strategy_id=s.strategy_id,
        version=s.version,
        name=s.name,
        params=params,
        status=s.status.value if hasattr(s.status, "value") else s.status,
        created_at=s.created_at,
        updated_at=s.updated_at,
    )


@router.get("/strategies", response_model=List[StrategyResponse])
async def list_strategies(
    status: Optional[str] = None,
    db: AsyncSession = Depends(get_db),
):
    """List all strategies with their current status."""
    all_strats = await registry.list_all(db)
    if status:
        all_strats = [s for s in all_strats if s.status.value == status or s.status == status]
    return [_strat_to_response(s) for s in all_strats]


@router.post("/run", status_code=202)
async def trigger_research_cycle(
    req: ResearchCycleRequest,
    background_tasks: BackgroundTasks,
):
    """Trigger a research cycle for a specific asset+timeframe."""
    background_tasks.add_task(_background_research, req.asset, req.timeframe)
    return {"status": "accepted", "asset": req.asset, "timeframe": req.timeframe}


@router.patch("/strategies/{strategy_id}/status", response_model=StrategyResponse)
async def update_strategy_status(
    strategy_id: str,
    req: StatusUpdateRequest,
    db: AsyncSession = Depends(get_db),
):
    """Manually update a strategy's status."""
    try:
        new_status = StrategyStatusEnum(req.status)
    except ValueError:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid status: {req.status}. Must be one of: draft, candidate, active, deprecated",
        )

    if new_status == StrategyStatusEnum.active:
        strat = await registry.promote_to_active(db, strategy_id)
    else:
        strat = await registry.update_status(db, strategy_id, new_status)

    if strat is None:
        raise HTTPException(status_code=404, detail=f"Strategy {strategy_id} not found")

    await db.commit()
    await db.refresh(strat)
    return _strat_to_response(strat)


async def _background_research(asset: str, timeframe: str) -> None:
    from app.research.lab import ResearchLab

    lab = ResearchLab()
    try:
        result = await lab.run_research_cycle(asset, timeframe)
        logger.info("Research cycle done for %s/%s", asset, timeframe)
    except Exception as exc:
        logger.error("Background research error for %s/%s: %s", asset, timeframe, exc)
