from __future__ import annotations

from typing import List

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    database_url: str = "postgresql+asyncpg://alpha:alpha@localhost:5432/alpha_factory"
    redis_url: str = "redis://localhost:6379/0"
    qdrant_url: str = "http://localhost:6333"

    binance_api_key: str = ""
    binance_api_secret: str = ""

    assets_raw: str = "BTC/USDT,ETH/USDT,BNB/USDT,SOL/USDT"
    timeframes_raw: str = "1m,5m,15m,1h,4h,1d"

    tb_pt: float = 0.02
    tb_sl: float = 0.01
    tb_t: int = 48

    risk_max_exposure: float = 0.20
    risk_daily_loss_limit: float = 0.03
    risk_min_rr: float = 1.5

    qdrant_collection: str = "alpha_factory_rag"

    @property
    def assets(self) -> List[str]:
        return [a.strip() for a in self.assets_raw.split(",") if a.strip()]

    @property
    def timeframes(self) -> List[str]:
        return [t.strip() for t in self.timeframes_raw.split(",") if t.strip()]

    class Config:
        env_prefix = ""
        # Map ASSETS env var to assets_raw field
        fields = {
            "assets_raw": {"env": "ASSETS"},
            "timeframes_raw": {"env": "TIMEFRAMES"},
        }


settings = Settings()
