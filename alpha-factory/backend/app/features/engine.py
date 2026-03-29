from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Dict, List, Optional

import numpy as np
import pandas as pd
from sqlalchemy import select, text
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import Feature, OHLCVBar
from app.db.session import AsyncSessionLocal

logger = logging.getLogger(__name__)


def _wilder_rsi(series: pd.Series, period: int = 14) -> pd.Series:
    delta = series.diff()
    gain = delta.clip(lower=0)
    loss = -delta.clip(upper=0)
    avg_gain = gain.ewm(alpha=1 / period, min_periods=period, adjust=False).mean()
    avg_loss = loss.ewm(alpha=1 / period, min_periods=period, adjust=False).mean()
    rs = avg_gain / avg_loss.replace(0, np.nan)
    rsi = 100 - (100 / (1 + rs))
    return rsi


def _atr(high: pd.Series, low: pd.Series, close: pd.Series, period: int = 14) -> pd.Series:
    prev_close = close.shift(1)
    tr = pd.concat(
        [
            high - low,
            (high - prev_close).abs(),
            (low - prev_close).abs(),
        ],
        axis=1,
    ).max(axis=1)
    atr = tr.ewm(alpha=1 / period, min_periods=period, adjust=False).mean()
    return atr


def _macd(close: pd.Series, fast: int = 12, slow: int = 26, signal: int = 9) -> pd.Series:
    ema_fast = close.ewm(span=fast, adjust=False).mean()
    ema_slow = close.ewm(span=slow, adjust=False).mean()
    macd_line = ema_fast - ema_slow
    signal_line = macd_line.ewm(span=signal, adjust=False).mean()
    return macd_line - signal_line


def _vwap(high: pd.Series, low: pd.Series, close: pd.Series, volume: pd.Series) -> pd.Series:
    """VWAP using standard (H+L+C)/3 typical price."""
    typical_price = (high + low + close) / 3
    cumulative_tp_vol = (typical_price * volume).cumsum()
    cumulative_vol = volume.cumsum().replace(0, np.nan)
    return cumulative_tp_vol / cumulative_vol


def compute_features(df: pd.DataFrame) -> pd.DataFrame:
    """
    Compute all features from OHLCV dataframe.
    df must have columns: open, high, low, close, volume, funding_rate, open_interest
    index: DatetimeIndex sorted ascending.
    Returns dataframe with feature columns (NaN rows preserved — filtered at upsert time).
    """
    feats = pd.DataFrame(index=df.index)

    close = df["close"]
    high = df["high"]
    low = df["low"]
    volume = df["volume"]

    # Returns
    feats["returns_1"] = close.pct_change(1)
    feats["returns_5"] = close.pct_change(5)
    feats["returns_24"] = close.pct_change(24)

    # ATR
    feats["atr_14"] = _atr(high, low, close, 14)

    # RSI
    feats["rsi_14"] = _wilder_rsi(close, 14)

    # MACD histogram
    feats["macd_hist"] = _macd(close, 12, 26, 9)

    # VWAP — correct (H+L+C)/3 typical price
    feats["vwap"] = _vwap(high, low, close, volume)

    # MA distances
    sma_20 = close.rolling(20, min_periods=20).mean()
    sma_50 = close.rolling(50, min_periods=50).mean()
    feats["ma_dist_20"] = (close - sma_20) / sma_20.replace(0, np.nan)
    feats["ma_dist_50"] = (close - sma_50) / sma_50.replace(0, np.nan)

    # Annualised volatility
    returns = close.pct_change()
    feats["volatility_20"] = returns.rolling(20, min_periods=20).std() * np.sqrt(252)

    # Volume z-score
    vol_mean = volume.rolling(20, min_periods=20).mean()
    vol_std = volume.rolling(20, min_periods=20).std().replace(0, np.nan)
    feats["volume_zscore"] = (volume - vol_mean) / vol_std

    # Funding rate delta (None → NaN antes de diff)
    if "funding_rate" in df.columns:
        funding = pd.to_numeric(df["funding_rate"], errors="coerce").ffill()
        feats["funding_delta"] = funding.diff(1) if funding.notna().any() else np.nan
    else:
        feats["funding_delta"] = np.nan

    # Open interest delta (fractional change)
    if "open_interest" in df.columns:
        oi = pd.to_numeric(df["open_interest"], errors="coerce").ffill()
        if oi.notna().any():
            prev_oi = oi.shift(1).replace(0, np.nan)
            feats["oi_delta"] = (oi - oi.shift(1)) / prev_oi
        else:
            feats["oi_delta"] = np.nan
    else:
        feats["oi_delta"] = np.nan

    return feats


class FeatureEngine:
    async def _load_ohlcv(
        self,
        session: AsyncSession,
        asset: str,
        timeframe: str,
        limit: int = 500,
    ) -> pd.DataFrame:
        stmt = (
            select(OHLCVBar)
            .where(OHLCVBar.asset == asset, OHLCVBar.timeframe == timeframe)
            .order_by(OHLCVBar.timestamp.desc())
            .limit(limit)
        )
        result = await session.execute(stmt)
        rows = result.scalars().all()

        if not rows:
            return pd.DataFrame()

        data = [
            {
                "timestamp": r.timestamp,
                "open": r.open,
                "high": r.high,
                "low": r.low,
                "close": r.close,
                "volume": r.volume,
                "funding_rate": r.funding_rate,
                "open_interest": r.open_interest,
            }
            for r in rows
        ]
        df = pd.DataFrame(data)
        df = df.sort_values("timestamp").set_index("timestamp")
        return df

    async def _upsert_features(
        self,
        session: AsyncSession,
        asset: str,
        timeframe: str,
        feats_df: pd.DataFrame,
    ) -> int:
        rows = []
        for ts, row in feats_df.iterrows():
            for feat_name, value in row.items():
                if pd.isna(value) or not np.isfinite(value):
                    continue
                rows.append(
                    {
                        "asset": asset,
                        "timeframe": timeframe,
                        "timestamp": ts,
                        "feature_name": feat_name,
                        "value": float(value),
                    }
                )

        if not rows:
            return 0

        chunk_size = 500
        total = 0
        for i in range(0, len(rows), chunk_size):
            chunk = rows[i : i + chunk_size]
            stmt = (
                pg_insert(Feature)
                .values(chunk)
                .on_conflict_do_update(
                    constraint="uq_features_asset_tf_ts_name",
                    set_={"value": pg_insert(Feature).excluded.value},
                )
            )
            await session.execute(stmt)
            total += len(chunk)

        return total

    async def run(self, asset: str, timeframe: str) -> int:
        async with AsyncSessionLocal() as session:
            df = await self._load_ohlcv(session, asset, timeframe)
            if df.empty or len(df) < 50:
                logger.warning("Not enough OHLCV data for features %s/%s (need >=50, got %d)",
                               asset, timeframe, len(df))
                return 0

            feats_df = compute_features(df)
            # Upsert ALL computed rows — no arbitrary tail() cap
            count = await self._upsert_features(session, asset, timeframe, feats_df)
            await session.commit()

        logger.info("Upserted %d feature rows for %s/%s", count, asset, timeframe)
        return count

    async def get_latest_features(
        self, session: AsyncSession, asset: str, timeframe: str
    ) -> tuple[Dict[str, float], Optional[datetime]]:
        """Return the most recent feature snapshot and its timestamp."""
        stmt = text(
            """
            SELECT DISTINCT ON (feature_name)
                feature_name, value, timestamp
            FROM features
            WHERE asset = :asset AND timeframe = :timeframe
            ORDER BY feature_name, timestamp DESC
            """
        )
        result = await session.execute(stmt, {"asset": asset, "timeframe": timeframe})
        rows = result.fetchall()
        
        if not rows:
            return {}, None
            
        feats = {row.feature_name: row.value for row in rows}
        # Since we use DISTINCT ON, all rows might not have the SAME timestamp 
        # but in practice they are upserted together. We take the max.
        ts = max(row.timestamp for row in rows)
        return feats, ts
