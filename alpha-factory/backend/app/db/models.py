from __future__ import annotations

import enum
from datetime import datetime
from typing import Optional

from sqlalchemy import (
    BigInteger,
    DateTime,
    Enum,
    Float,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
    func,
    text,
)
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship


class Base(DeclarativeBase):
    pass


class RegimeEnum(str, enum.Enum):
    trend_bull = "trend_bull"
    trend_bear = "trend_bear"
    range = "range"
    high_vol = "high_vol"
    low_vol = "low_vol"


class StrategyStatusEnum(str, enum.Enum):
    draft = "draft"
    candidate = "candidate"
    active = "active"
    deprecated = "deprecated"


class DirectionEnum(str, enum.Enum):
    LONG = "LONG"
    SHORT = "SHORT"
    NO_TRADE = "NO_TRADE"


class BarrierEnum(str, enum.Enum):
    tp = "tp"
    sl = "sl"
    time = "time"


class OHLCVBar(Base):
    __tablename__ = "ohlcv_bars"
    __table_args__ = (
        Index('ix_ohlcv_asset_tf_ts', 'asset', 'timeframe', 'timestamp'),
        UniqueConstraint("asset", "timeframe", "timestamp", name="uq_ohlcv_asset_tf_ts"),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    asset: Mapped[str] = mapped_column(String(32), nullable=False, index=True)
    timeframe: Mapped[str] = mapped_column(String(8), nullable=False, index=True)
    timestamp: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, index=True)
    open: Mapped[float] = mapped_column(Float, nullable=False)
    high: Mapped[float] = mapped_column(Float, nullable=False)
    low: Mapped[float] = mapped_column(Float, nullable=False)
    close: Mapped[float] = mapped_column(Float, nullable=False)
    volume: Mapped[float] = mapped_column(Float, nullable=False)
    funding_rate: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    open_interest: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    mark_price: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )


class Feature(Base):
    __tablename__ = "features"
    __table_args__ = (
        UniqueConstraint(
            "asset", "timeframe", "timestamp", "feature_name", name="uq_feature_asset_tf_ts_name"
        ),
        Index('ix_feature_asset_tf_ts', 'asset', 'timeframe', 'timestamp', 'feature_name'),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    asset: Mapped[str] = mapped_column(String(32), nullable=False, index=True)
    timeframe: Mapped[str] = mapped_column(String(8), nullable=False, index=True)
    timestamp: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, index=True)
    feature_name: Mapped[str] = mapped_column(String(64), nullable=False)
    value: Mapped[float] = mapped_column(Float, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )


class MarketRegime(Base):
    __tablename__ = "market_regimes"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    asset: Mapped[str] = mapped_column(String(32), nullable=False, index=True)
    timeframe: Mapped[str] = mapped_column(String(8), nullable=False, index=True)
    timestamp: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, index=True)
    regime: Mapped[RegimeEnum] = mapped_column(Enum(RegimeEnum), nullable=False)
    confidence: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    features_json: Mapped[Optional[str]] = mapped_column("market_features_json", Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )


class Label(Base):
    __tablename__ = "labels"
    __table_args__ = (
        UniqueConstraint("asset", "timeframe", "timestamp", name="uq_label_asset_tf_ts"),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    asset: Mapped[str] = mapped_column(String(32), nullable=False, index=True)
    timeframe: Mapped[str] = mapped_column(String(8), nullable=False, index=True)
    timestamp: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, index=True)
    label: Mapped[int] = mapped_column(Integer, nullable=False)  # 1, -1, 0
    barrier_hit: Mapped[BarrierEnum] = mapped_column(Enum(BarrierEnum), nullable=False)
    ret: Mapped[float] = mapped_column(Float, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )


class Strategy(Base):
    __tablename__ = "strategies"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    strategy_id: Mapped[str] = mapped_column(String(128), unique=True, nullable=False, index=True)
    version: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    name: Mapped[str] = mapped_column(String(128), nullable=False)
    params_json: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    status: Mapped[StrategyStatusEnum] = mapped_column(
        Enum(StrategyStatusEnum), nullable=False, default=StrategyStatusEnum.draft
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )

    backtest_runs: Mapped[list["BacktestRun"]] = relationship(
        "BacktestRun", back_populates="strategy", lazy="select"
    )
    signals: Mapped[list["Signal"]] = relationship(
        "Signal", back_populates="strategy", lazy="select"
    )


class BacktestRun(Base):
    __tablename__ = "backtest_runs"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    strategy_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("strategies.id"), nullable=False, index=True
    )
    run_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    asset: Mapped[str] = mapped_column(String(32), nullable=False)
    timeframe: Mapped[str] = mapped_column(String(8), nullable=False)
    start_date: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    end_date: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    params_json: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    sharpe: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    profit_factor: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    expectancy: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    max_drawdown: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    win_rate: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    avg_rr: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    total_trades: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    equity_curve_json: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    trades_json: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    strategy: Mapped["Strategy"] = relationship("Strategy", back_populates="backtest_runs")


class Signal(Base):
    __tablename__ = "signals"
    __table_args__ = (
        Index('ix_signal_asset_tf_ts', 'asset', 'timeframe', 'timestamp'),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    asset: Mapped[str] = mapped_column(String(32), nullable=False, index=True)
    timeframe: Mapped[str] = mapped_column(String(8), nullable=False, index=True)
    timestamp: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, index=True)
    direction: Mapped[DirectionEnum] = mapped_column(Enum(DirectionEnum), nullable=False)
    confidence: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    entry_price: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    tp1: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    tp2: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    sl: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    regime: Mapped[Optional[str]] = mapped_column(String(32), nullable=True)
    rag_context: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    explanation: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    strategy_id: Mapped[Optional[int]] = mapped_column(
        BigInteger, ForeignKey("strategies.id"), nullable=True, index=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    strategy: Mapped[Optional["Strategy"]] = relationship("Strategy", back_populates="signals")


class RagDocument(Base):
    __tablename__ = "rag_documents"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    asset: Mapped[str] = mapped_column(String(32), nullable=False, index=True)
    timestamp: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, index=True)
    regime: Mapped[Optional[str]] = mapped_column(String(32), nullable=True)
    features_json: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    context_summary: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    trade_outcome: Mapped[Optional[str]] = mapped_column(String(32), nullable=True)
    risk_reward: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    vector_id: Mapped[Optional[str]] = mapped_column(String(128), nullable=True, index=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )


class Position(Base):
    __tablename__ = "positions"
    __table_args__ = (
        Index(
            "uq_one_open_pos_per_asset",
            "asset",
            unique=True,
            postgresql_where=(text("status = 'open'")),
        ),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    asset: Mapped[str] = mapped_column(String(32), nullable=False, index=True)
    side: Mapped[DirectionEnum] = mapped_column(Enum(DirectionEnum), nullable=False)
    entry_price: Mapped[float] = mapped_column(Float, nullable=False)
    size: Mapped[float] = mapped_column(Float, nullable=False)
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="open")  # open, closed
    strategy_id: Mapped[Optional[str]] = mapped_column(String(128), nullable=True)
    exchange_ref: Mapped[Optional[str]] = mapped_column(String(128), nullable=True)
    opened_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    closed_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)

    @property
    def unrealized_pnl(self) -> float:
        return 0.0


class Trade(Base):
    __tablename__ = "trades"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    asset: Mapped[str] = mapped_column(String(32), nullable=False, index=True)
    side: Mapped[DirectionEnum] = mapped_column(Enum(DirectionEnum), nullable=False)
    entry_price: Mapped[float] = mapped_column(Float, nullable=False)
    exit_price: Mapped[float] = mapped_column(Float, nullable=False)
    size: Mapped[float] = mapped_column(Float, nullable=False)
    pnl: Mapped[float] = mapped_column(Float, nullable=False)
    entry_time: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    exit_time: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    strategy_id: Mapped[Optional[str]] = mapped_column(String(128), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
