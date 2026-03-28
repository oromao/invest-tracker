from __future__ import annotations

import json
import logging
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query
from sqlalchemy import desc, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.schemas import BacktestResponse, BacktestRunRequest
from app.db.models import BacktestRun, Strategy
from app.db.session import get_db

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/backtests", tags=["backtests"])


def _run_to_response(run: BacktestRun) -> BacktestResponse:
    equity_curve = None
    trades = None
    params = None

    if run.equity_curve_json:
        try:
            equity_curve = json.loads(run.equity_curve_json)
        except Exception:
            pass
    if run.trades_json:
        try:
            trades = json.loads(run.trades_json)
        except Exception:
            pass
    if run.params_json:
        try:
            params = json.loads(run.params_json)
        except Exception:
            pass

    return BacktestResponse(
        id=run.id,
        strategy_id=run.strategy_id,
        run_at=run.run_at,
        asset=run.asset,
        timeframe=run.timeframe,
        start_date=run.start_date,
        end_date=run.end_date,
        params=params,
        sharpe=run.sharpe,
        profit_factor=run.profit_factor,
        expectancy=run.expectancy,
        max_drawdown=run.max_drawdown,
        win_rate=run.win_rate,
        avg_rr=run.avg_rr,
        total_trades=run.total_trades,
        equity_curve=equity_curve,
        trades=trades,
    )


@router.get("", response_model=List[BacktestResponse])
async def list_backtests(
    strategy_id: Optional[str] = None,
    asset: Optional[str] = None,
    limit: int = Query(50, le=200),
    db: AsyncSession = Depends(get_db),
):
    """List backtest runs with optional filters."""
    stmt = select(BacktestRun).order_by(desc(BacktestRun.run_at)).limit(limit)

    if strategy_id:
        strat_result = await db.execute(
            select(Strategy).where(Strategy.strategy_id == strategy_id)
        )
        strat = strat_result.scalar_one_or_none()
        if strat:
            stmt = stmt.where(BacktestRun.strategy_id == strat.id)

    if asset:
        asset_normalized = asset.replace("-", "/").upper()
        stmt = stmt.where(BacktestRun.asset == asset_normalized)

    result = await db.execute(stmt)
    runs = result.scalars().all()
    return [_run_to_response(r) for r in runs]


@router.get("/{run_id}", response_model=BacktestResponse)
async def get_backtest(run_id: int, db: AsyncSession = Depends(get_db)):
    """Get full backtest run details including equity curve and trades."""
    result = await db.execute(select(BacktestRun).where(BacktestRun.id == run_id))
    run = result.scalar_one_or_none()
    if run is None:
        raise HTTPException(status_code=404, detail=f"Backtest run {run_id} not found")
    return _run_to_response(run)


async def _background_backtest(strategy_sid: str, asset: str, timeframe: str) -> None:
    """Background task to run a backtest for a specific strategy."""
    from app.db.session import AsyncSessionLocal
    from app.registry.strategies import StrategyRegistry
    from app.research.lab import ResearchLab

    lab = ResearchLab()
    try:
        result = await lab.run_research_cycle(asset, timeframe)
        logger.info("Manual backtest completed for %s/%s: %s", asset, timeframe, result.get("top_strategy"))
    except Exception as exc:
        logger.error("Background backtest error: %s", exc)


@router.post("/run", status_code=202)
async def trigger_backtest(
    req: BacktestRunRequest,
    background_tasks: BackgroundTasks,
):
    """Trigger a backtest run for a strategy+asset combination."""
    background_tasks.add_task(
        _background_backtest, req.strategy_id, req.asset, req.timeframe
    )
    return {
        "status": "accepted",
        "strategy_id": req.strategy_id,
        "asset": req.asset,
        "timeframe": req.timeframe,
    }
