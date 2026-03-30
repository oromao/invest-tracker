from __future__ import annotations

from datetime import datetime
from typing import Any, Dict, List, Optional

from pydantic import BaseModel, Field


class SignalResponse(BaseModel):
    id: int
    asset: str
    timeframe: str
    timestamp: datetime
    direction: str
    confidence: float
    entry_price: Optional[float] = None
    tp1: Optional[float] = None
    tp2: Optional[float] = None
    sl: Optional[float] = None
    regime: Optional[str] = None
    rag_context: Optional[str] = None
    explanation: Optional[str] = None
    strategy_id: Optional[int] = None
    created_at: datetime

    class Config:
        from_attributes = True


class BacktestResponse(BaseModel):
    id: int
    strategy_id: int
    run_at: datetime
    asset: str
    timeframe: str
    start_date: Optional[datetime] = None
    end_date: Optional[datetime] = None
    params: Optional[Dict[str, Any]] = None
    sharpe: Optional[float] = None
    profit_factor: Optional[float] = None
    expectancy: Optional[float] = None
    max_drawdown: Optional[float] = None
    win_rate: Optional[float] = None
    avg_rr: Optional[float] = None
    total_trades: Optional[int] = None
    equity_curve: Optional[List[float]] = None
    trades: Optional[List[Dict[str, Any]]] = None

    class Config:
        from_attributes = True


class StrategyResponse(BaseModel):
    id: int
    strategy_id: str
    version: int
    name: str
    params: Optional[Dict[str, Any]] = None
    status: str
    lifecycle_state: Optional[str] = None
    latest_score: Optional[float] = None
    latest_reason: Optional[str] = None
    latest_metrics: Optional[Dict[str, Any]] = None
    promotion_diagnostics: Optional[Dict[str, Any]] = None
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


class RegimeResponse(BaseModel):
    id: int
    asset: str
    timeframe: str
    timestamp: datetime
    regime: str
    confidence: float
    features: Optional[Dict[str, Any]] = None
    created_at: datetime

    class Config:
        from_attributes = True


class PortfolioPosition(BaseModel):
    id: Optional[int] = None
    asset: str
    side: str
    direction: str
    entry_price: float
    current_price: float
    size: float
    pnl: float
    pnl_pct: float
    last_signal_id: Optional[str] = None


class PaperStrategyAllocationResponse(BaseModel):
    id: Optional[int] = None
    strategy_id: str
    asset: str
    timeframe: str
    lifecycle_state: Optional[str] = None
    regime: Optional[str] = None
    allocation_weight: float
    capital_allocated: float
    realized_pnl: float
    unrealized_pnl: float
    net_pnl: float
    trade_count: int
    win_rate: Optional[float] = None
    payoff_ratio: Optional[float] = None
    max_drawdown: Optional[float] = None
    recent_pnl: Optional[float] = None
    recent_win_rate: Optional[float] = None
    recent_trade_count: Optional[int] = None
    backtest_win_rate: Optional[float] = None
    backtest_profit_factor: Optional[float] = None
    backtest_sharpe: Optional[float] = None
    backtest_max_drawdown: Optional[float] = None
    regime_fit_score: Optional[float] = None
    concentration_penalty: Optional[float] = None
    paper_backtest_delta: Optional[float] = None
    reason: Optional[str] = None
    updated_at: datetime


class PortfolioResponse(BaseModel):
    total_value: float
    cash: float
    invested: float
    open_pnl: Optional[float] = None
    daily_pnl: float
    daily_pnl_pct: float
    total_pnl: float
    total_pnl_pct: float
    active_positions: Optional[int] = None
    positions: List[PortfolioPosition]
    strategy_allocations: List[PaperStrategyAllocationResponse] = []
    timestamp: datetime


class ResearchCycleRequest(BaseModel):
    asset: str = "BTC/USDT"
    timeframe: str = "1h"


class BacktestRunRequest(BaseModel):
    strategy_id: str
    asset: str
    timeframe: str


class SignalGenerateRequest(BaseModel):
    asset: Optional[str] = None   # None → generate for all configured assets
    timeframe: str = "1h"


class StatusUpdateRequest(BaseModel):
    status: str = Field(..., pattern="^(draft|candidate|active|deprecated)$")


class SchedulerJobInfo(BaseModel):
    id: str
    name: str
    next_run: Optional[str] = None


class HealthResponse(BaseModel):
    status: str
    version: str
    timestamp: datetime
    jobs: List[SchedulerJobInfo] = []


class EvolutionCycleResponse(BaseModel):
    id: int
    asset: str
    timeframe: str
    cycle_at: datetime
    baseline_active_strategy_id: Optional[str] = None
    baseline_active_score: Optional[float] = None
    top_candidate_strategy_id: Optional[str] = None
    top_candidate_score: Optional[float] = None
    promotion_attempted: bool
    promotion_succeeded: bool
    promotion_blockers: List[str] = []
    deprecated_strategy_ids: List[str] = []
    competition_mode: Optional[str] = None
    previous_active_strategy_id: Optional[str] = None
    current_active_strategy_id: Optional[str] = None
    leader_changed: bool = False
    leader_change_reason: Optional[str] = None
    promotion_diagnostics: Optional[Dict[str, Any]] = None
    created_at: datetime
