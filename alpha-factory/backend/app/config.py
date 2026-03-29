from __future__ import annotations

from typing import List

from pydantic import AliasChoices, Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    database_url: str = "postgresql+asyncpg://alpha:alpha@localhost:5432/alpha_factory"
    redis_url: str = "redis://localhost:6379/0"
    qdrant_url: str = "http://localhost:6333"

    binance_api_key: str = ""
    binance_api_secret: str = ""

    assets_raw: str = Field(
        default="BTC/USDT,ETH/USDT,BNB/USDT,SOL/USDT",
        validation_alias=AliasChoices("ASSETS", "ASSETS_RAW", "assets_raw"),
    )
    timeframes_raw: str = Field(
        default="1m,5m,15m,1h,4h,1d",
        validation_alias=AliasChoices("TIMEFRAMES", "TIMEFRAMES_RAW", "timeframes_raw"),
    )

    # Triple barrier labeling
    tb_pt: float = 0.02
    tb_sl: float = 0.01
    tb_t: int = 48

    # Risk engine
    risk_max_exposure: float = 0.20
    risk_daily_loss_limit: float = 0.03
    risk_min_rr: float = 1.5
    risk_position_size_pct: float = 0.01  # fraction of capital to risk per trade

    # Execution
    dry_run: bool = True  # never place real orders when True

    # Backtest realism
    backtest_fee_pct: float = 0.001       # 0.1% taker fee per side
    backtest_slippage_pct: float = 0.0002 # 2bps market impact slippage

    # Strategy promotion / quant quality gates
    min_trades_for_promotion: int = 30    # minimum trades to be considered for promotion
    oos_min_sharpe_ratio: float = 0.5     # OOS Sharpe must be >= oos_min_sharpe_ratio * IS Sharpe
    promotion_min_sharpe: float = 1.0
    promotion_min_pf: float = 1.3
    promotion_confirmed_runs: int = 3     # confirmed backtests required before going active

    # RAG quality
    rag_min_score: float = 0.50           # minimum cosine similarity to include in context
    qdrant_collection: str = "alpha_factory_rag"

    # Signal cooldown (seconds) — avoid duplicate signals for same asset
    signal_cooldown_seconds: int = 1800   # 30 minutes

    # Real-time resilience
    ws_heartbeat_timeout: float = 30.0    # seconds before declaring WS silent/dead
    signal_staleness_seconds: int = 7200  # signal older than 2h is stale

    # Paper trading engine
    paper_trading_initial_capital: float = 10000.0
    paper_trading_tp_pct: float = 0.04    # take-profit target (4%)
    paper_trading_sl_pct: float = 0.02    # stop-loss target (2%)
    max_consecutive_losses: int = 5       # instability threshold
    max_portfolio_drawdown: float = 0.15  # 15% drawdown → halt

    # Strategy decay detection
    decay_min_trades: int = 20            # min live trades before checking decay
    decay_win_rate_ratio: float = 0.60    # live WR must be >= 60% of backtest WR

    # Feature drift thresholds
    drift_sigma_threshold: float = 3.0   # z-score threshold for feature drift
    max_regime_changes_24h: int = 8       # regime velocity alarm

    cors_origins: list[str] = ["*"]

    invest_tracker_url: str = ""

    ollama_url: str = "http://ollama:11434"
    ollama_model: str = "phi3:mini"
    llm_enabled: bool = True

    @field_validator("cors_origins", mode="before")
    @classmethod
    def parse_cors(cls, v):
        if isinstance(v, str):
            return [s.strip() for s in v.split(",")]
        return v

    @property
    def assets(self) -> List[str]:
        return [a.strip() for a in self.assets_raw.split(",") if a.strip()]

    @property
    def timeframes(self) -> List[str]:
        return [t.strip() for t in self.timeframes_raw.split(",") if t.strip()]


settings = Settings()
