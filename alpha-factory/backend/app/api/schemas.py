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
