from __future__ import annotations

import json
import logging
from datetime import datetime, timezone
from typing import Dict, Optional, Tuple

import numpy as np
import pandas as pd
from sklearn.cluster import KMeans
from sklearn.preprocessing import StandardScaler
from sqlalchemy import select, text
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import MarketRegime, RegimeEnum
from app.db.session import AsyncSessionLocal

logger = logging.getLogger(__name__)

REGIME_FEATURES = [
    "returns_1",
    "returns_5",
    "returns_24",
    "atr_14",
    "rsi_14",
    "macd_hist",
    "ma_dist_20",
    "volatility_20",
    "volume_zscore",
]

N_CLUSTERS = 5


def _assign_regime_label(centroids: np.ndarray, feature_names: list) -> Dict[int, RegimeEnum]:
    """
    Assign regime labels to clusters based on centroid characteristics.
    Uses heuristic analysis of key features.
    """
    returns_idx = feature_names.index("returns_24") if "returns_24" in feature_names else 0
    vol_idx = feature_names.index("volatility_20") if "volatility_20" in feature_names else 3
    rsi_idx = feature_names.index("rsi_14") if "rsi_14" in feature_names else 4
    macd_idx = feature_names.index("macd_hist") if "macd_hist" in feature_names else 5

    assignments: Dict[int, RegimeEnum] = {}
    used: set = set()

    scores = []
    for i, c in enumerate(centroids):
        ret = c[returns_idx] if returns_idx < len(c) else 0
        vol = c[vol_idx] if vol_idx < len(c) else 0
        rsi = c[rsi_idx] if rsi_idx < len(c) else 50
        macd = c[macd_idx] if macd_idx < len(c) else 0
        scores.append(
            {
                "cluster": i,
                "ret": ret,
                "vol": vol,
                "rsi": rsi,
                "macd": macd,
                "bull_score": ret + (rsi - 50) / 50 + macd,
                "bear_score": -ret - (rsi - 50) / 50 - macd,
                "vol_score": vol,
                "range_score": -abs(ret) - vol,
            }
        )

    # Assign trend_bull: highest bull_score
    bull_cluster = max(scores, key=lambda x: x["bull_score"])["cluster"]
    assignments[bull_cluster] = RegimeEnum.trend_bull
    used.add(bull_cluster)

    # Assign trend_bear: highest bear_score among unused
    remaining = [s for s in scores if s["cluster"] not in used]
    if remaining:
        bear_cluster = max(remaining, key=lambda x: x["bear_score"])["cluster"]
        assignments[bear_cluster] = RegimeEnum.trend_bear
        used.add(bear_cluster)

    # Assign high_vol: highest vol_score among unused
    remaining = [s for s in scores if s["cluster"] not in used]
    if remaining:
        hv_cluster = max(remaining, key=lambda x: x["vol_score"])["cluster"]
        assignments[hv_cluster] = RegimeEnum.high_vol
        used.add(hv_cluster)

    # Assign range: highest range_score (lowest abs ret + low vol) among unused
    remaining = [s for s in scores if s["cluster"] not in used]
    if remaining:
        range_cluster = max(remaining, key=lambda x: x["range_score"])["cluster"]
        assignments[range_cluster] = RegimeEnum.range
        used.add(range_cluster)

    # Remaining → low_vol
    for s in scores:
        if s["cluster"] not in assignments:
            assignments[s["cluster"]] = RegimeEnum.low_vol

    return assignments


class RegimeDetector:
    async def _load_features(
        self,
        session: AsyncSession,
        asset: str,
        timeframe: str,
        n_bars: int = 200,
    ) -> Optional[pd.DataFrame]:
        stmt = text(
            """
            SELECT timestamp, feature_name, value
            FROM features
            WHERE asset = :asset AND timeframe = :timeframe
              AND feature_name = ANY(:names)
              AND timestamp IN (
                  SELECT DISTINCT timestamp FROM features
                  WHERE asset = :asset AND timeframe = :timeframe
                  ORDER BY timestamp DESC
                  LIMIT :n
              )
            ORDER BY timestamp ASC
            """
        )
        result = await session.execute(
            stmt,
            {
                "asset": asset,
                "timeframe": timeframe,
                "names": REGIME_FEATURES,
                "n": n_bars,
            },
        )
        rows = result.fetchall()
        if not rows:
            return None

        df = pd.DataFrame(rows, columns=["timestamp", "feature_name", "value"])
        pivot = df.pivot_table(index="timestamp", columns="feature_name", values="value")
        pivot = pivot.reindex(columns=REGIME_FEATURES)
        pivot = pivot.dropna()
        return pivot

    async def detect(self, asset: str, timeframe: str) -> Optional[Tuple[RegimeEnum, float]]:
        async with AsyncSessionLocal() as session:
            pivot = await self._load_features(session, asset, timeframe)
            if pivot is None or len(pivot) < N_CLUSTERS * 2:
                logger.warning("Not enough feature data for regime detection %s/%s", asset, timeframe)
                return None

            X = pivot.values
            scaler = StandardScaler()
            X_scaled = scaler.fit_transform(X)

            kmeans = KMeans(n_clusters=N_CLUSTERS, n_init=10, random_state=42)
            kmeans.fit(X_scaled)

            cluster_labels = _assign_regime_label(
                kmeans.cluster_centers_, list(pivot.columns)
            )

            # Current bar = last row
            last_scaled = X_scaled[-1].reshape(1, -1)
            pred_cluster = kmeans.predict(last_scaled)[0]
            current_regime = cluster_labels.get(pred_cluster, RegimeEnum.range)

            # Confidence = 1 - normalized distance to centroid
            distances = kmeans.transform(last_scaled)[0]
            min_dist = distances[pred_cluster]
            max_dist = distances.max()
            confidence = float(1.0 - min_dist / (max_dist + 1e-9))

            current_ts = pivot.index[-1]
            if hasattr(current_ts, "to_pydatetime"):
                current_ts = current_ts.to_pydatetime()
            if current_ts.tzinfo is None:
                current_ts = current_ts.replace(tzinfo=timezone.utc)

            features_snapshot = {
                col: float(pivot.iloc[-1][col]) for col in pivot.columns
            }

            regime_row = MarketRegime(
                asset=asset,
                timeframe=timeframe,
                timestamp=current_ts,
                regime=current_regime,
                confidence=confidence,
                features_json=json.dumps(features_snapshot),
            )
            session.add(regime_row)
            await session.commit()

            logger.info(
                "Regime for %s/%s: %s (confidence=%.2f)", asset, timeframe, current_regime.value, confidence
            )
            return current_regime, confidence

    async def get_latest_regime(
        self, session: AsyncSession, asset: str, timeframe: str
    ) -> Optional[MarketRegime]:
        stmt = (
            select(MarketRegime)
            .where(MarketRegime.asset == asset, MarketRegime.timeframe == timeframe)
            .order_by(MarketRegime.timestamp.desc())
            .limit(1)
        )
        result = await session.execute(stmt)
        return result.scalar_one_or_none()
