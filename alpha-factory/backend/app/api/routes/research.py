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
from app.research.memory import StrategyMemoryStore
from app.shared.time import to_sao_paulo

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/research", tags=["research"])
registry = StrategyRegistry()
memory_store = StrategyMemoryStore()


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
        created_at=to_sao_paulo(s.created_at),
        updated_at=to_sao_paulo(s.updated_at),
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
    response: List[StrategyResponse] = []
    for s in all_strats:
        row = _strat_to_response(s)
        latest = await memory_store.latest_state(db, s.strategy_id)
        if latest:
            row.lifecycle_state = latest.lifecycle_state
            row.latest_score = latest.score
            row.latest_reason = latest.reason
            if latest.metrics_json:
                try:
                    row.latest_metrics = json.loads(latest.metrics_json)
                except Exception:
                    row.latest_metrics = None
        response.append(row)
    return response


@router.get("/leaderboard", response_model=List[StrategyResponse])
async def strategy_leaderboard(
    asset: Optional[str] = None,
    timeframe: Optional[str] = None,
    limit: int = 10,
    db: AsyncSession = Depends(get_db),
):
    """Return the current best strategies ranked by robust backtest score."""
    rows = await memory_store.leaderboard(db, asset=asset, timeframe=timeframe, limit=limit)
    response: List[StrategyResponse] = []
    for row in rows:
        strat = await registry.get_by_strategy_id(db, row.strategy_id)
        if strat is None:
            continue
        response.append(
            StrategyResponse(
                id=strat.id,
                strategy_id=strat.strategy_id,
                version=strat.version,
                name=strat.name,
                params=json.loads(strat.params_json) if strat.params_json else None,
                status=strat.status.value if hasattr(strat.status, "value") else strat.status,
                lifecycle_state=row.lifecycle_state,
                latest_score=row.score,
                latest_reason=row.reason,
                latest_metrics={
                    "sharpe": row.sharpe,
                    "profit_factor": row.profit_factor,
                    "win_rate": row.win_rate,
                    "total_trades": row.total_trades,
                    "max_drawdown": row.max_drawdown,
                    "oos_sharpe": row.oos_sharpe,
                    "oos_profit_factor": row.oos_profit_factor,
                },
                created_at=to_sao_paulo(strat.created_at),
                updated_at=to_sao_paulo(strat.updated_at),
            )
        )
    return response


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


@router.patch("/strategies/{strategy_id}/promote", response_model=StrategyResponse)
async def promote_strategy(
    strategy_id: str,
    db: AsyncSession = Depends(get_db),
):
    """Promote a strategy through the lifecycle: draft → candidate → active."""
    result = await db.execute(select(Strategy).where(Strategy.strategy_id == strategy_id))
    strat = result.scalar_one_or_none()
    if strat is None:
        raise HTTPException(status_code=404, detail=f"Strategy {strategy_id} not found")

    transitions = {
        StrategyStatusEnum.draft: StrategyStatusEnum.candidate,
        StrategyStatusEnum.candidate: StrategyStatusEnum.active,
    }
    current_status = strat.status if isinstance(strat.status, StrategyStatusEnum) else StrategyStatusEnum(strat.status)
    next_status = transitions.get(current_status)
    if next_status is None:
        raise HTTPException(
            status_code=400,
            detail=f"Cannot promote strategy in status '{current_status.value}'. Valid source statuses: draft, candidate.",
        )

    strat.status = next_status
    db.add(strat)
    await db.commit()
    await db.refresh(strat)
    return _strat_to_response(strat)


@router.patch("/strategies/{strategy_id}/deprecate", response_model=StrategyResponse)
async def deprecate_strategy(
    strategy_id: str,
    db: AsyncSession = Depends(get_db),
):
    """Deprecate a strategy (any status can be deprecated)."""
    result = await db.execute(select(Strategy).where(Strategy.strategy_id == strategy_id))
    strat = result.scalar_one_or_none()
    if strat is None:
        raise HTTPException(status_code=404, detail=f"Strategy {strategy_id} not found")

    strat.status = StrategyStatusEnum.deprecated
    db.add(strat)
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
