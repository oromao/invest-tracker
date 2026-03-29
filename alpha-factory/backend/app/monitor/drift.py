"""
Feature drift detection and regime velocity monitoring.

Compares the distribution of recent features against a longer baseline window.
Flags assets showing statistical drift (z-score > threshold) or regime instability
(too many regime changes per hour). Results cached in Redis for health endpoint.
"""
from __future__ import annotations

import json
import logging
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from typing import Dict, List, Optional, Tuple

import numpy as np
import redis.asyncio as aioredis
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.db.models import MarketRegime
from app.db.session import AsyncSessionLocal

logger = logging.getLogger(__name__)

_DRIFT_REDIS_PREFIX = "alpha:monitor:drift"
_DRIFT_TTL = 7200  # 2 hours

# Features to track
MONITORED_FEATURES = [
    "rsi_14",
    "volatility_20",
    "volume_zscore",
    "ma_dist_20",
    "returns_24",
    "atr_14",
]

# Maximum regime changes in 24h before flagging instability
MAX_REGIME_CHANGES_24H = 8


@dataclass
class DriftResult:
    asset: str
    timeframe: str
    drift_detected: bool = False
    drifted_features: List[str] = field(default_factory=list)
    regime_unstable: bool = False
    regime_change_rate: float = 0.0  # changes per hour
    feature_details: Dict = field(default_factory=dict)
    checked_at: str = ""


async def _compute_feature_drift(
    session: AsyncSession,
    asset: str,
    timeframe: str,
    baseline_n: int = 200,
    recent_n: int = 20,
    sigma_threshold: float = 3.0,
) -> Tuple[bool, List[str], Dict]:
    """
    Load the last `baseline_n` rows for each monitored feature.
    Baseline = older (baseline_n - recent_n) rows.
    Recent  = newest recent_n rows.
    Drift detected if |z_score| > sigma_threshold.
    """
    drifted: List[str] = []
    details: Dict = {}

    for feature in MONITORED_FEATURES:
        stmt = text(
            """
            SELECT value FROM features
            WHERE asset = :asset AND timeframe = :tf AND feature_name = :feat
            ORDER BY timestamp DESC
            LIMIT :n
            """
        )
        result = await session.execute(
            stmt,
            {"asset": asset, "tf": timeframe, "feat": feature, "n": baseline_n},
        )
        values = [r[0] for r in result.fetchall() if r[0] is not None]

        if len(values) < recent_n + 10:
            continue

        arr = np.array(values, dtype=float)
        # arr[0] is the most recent (DESC order)
        recent = arr[:recent_n]
        baseline = arr[recent_n:]

        if baseline.std() < 1e-9:
            continue

        z = abs(recent.mean() - baseline.mean()) / baseline.std()
        flagged = z > sigma_threshold

        details[feature] = {
            "baseline_mean": round(float(baseline.mean()), 6),
            "recent_mean": round(float(recent.mean()), 6),
            "baseline_std": round(float(baseline.std()), 6),
            "z_score": round(float(z), 3),
            "drifted": flagged,
        }

        if flagged:
            drifted.append(feature)
            logger.warning(
                "Drift %s/%s/%s: z=%.2f  baseline_mean=%.4f  recent_mean=%.4f",
                asset, timeframe, feature,
                z, baseline.mean(), recent.mean(),
            )

    return bool(drifted), drifted, details


async def _compute_regime_velocity(
    session: AsyncSession,
    asset: str,
    timeframe: str,
    hours: int = 24,
) -> Tuple[float, bool]:
    """Count how many regime transitions occurred in the last `hours` hours."""
    cutoff = datetime.now(tz=timezone.utc) - timedelta(hours=hours)
    stmt = (
        select(MarketRegime.regime)
        .where(
            MarketRegime.asset == asset,
            MarketRegime.timeframe == timeframe,
            MarketRegime.timestamp > cutoff,
        )
        .order_by(MarketRegime.timestamp.asc())
    )
    result = await session.execute(stmt)
    regimes = [r[0] for r in result.fetchall()]

    if len(regimes) < 2:
        return 0.0, False

    changes = sum(1 for i in range(1, len(regimes)) if regimes[i] != regimes[i - 1])
    rate = changes / max(hours, 1)
    unstable = changes >= MAX_REGIME_CHANGES_24H

    if unstable:
        logger.warning(
            "Regime instability %s/%s: %d changes in %dh (%.2f/h)",
            asset, timeframe, changes, hours, rate,
        )

    return rate, unstable


class DriftMonitor:
    async def run(self, asset: str, timeframe: str) -> DriftResult:
        result = DriftResult(
            asset=asset,
            timeframe=timeframe,
            checked_at=datetime.now(tz=timezone.utc).isoformat(),
        )

        async with AsyncSessionLocal() as session:
            detected, drifted_features, details = await _compute_feature_drift(
                session, asset, timeframe,
                sigma_threshold=settings.drift_sigma_threshold,
            )
            rate, unstable = await _compute_regime_velocity(session, asset, timeframe)

        result.drift_detected = detected
        result.drifted_features = drifted_features
        result.feature_details = details
        result.regime_unstable = unstable
        result.regime_change_rate = rate

        # Cache in Redis
        try:
            r = aioredis.from_url(settings.redis_url, decode_responses=True)
            key = f"{_DRIFT_REDIS_PREFIX}:{asset.replace('/', '_')}:{timeframe}"
            await r.set(
                key,
                json.dumps(
                    {
                        "asset": asset,
                        "timeframe": timeframe,
                        "drift_detected": result.drift_detected,
                        "drifted_features": result.drifted_features,
                        "regime_unstable": result.regime_unstable,
                        "regime_change_rate": result.regime_change_rate,
                        "feature_details": result.feature_details,
                        "checked_at": result.checked_at,
                    }
                ),
                ex=_DRIFT_TTL,
            )
            await r.aclose()
        except Exception as exc:
            logger.debug("Drift Redis write failed (non-fatal): %s", exc)

        return result

    async def run_all(self) -> List[DriftResult]:
        results = []
        for asset in settings.assets:
            for tf in ["1h", "4h"]:
                try:
                    r = await self.run(asset, tf)
                    results.append(r)
                except Exception as exc:
                    logger.error("Drift error %s/%s: %s", asset, tf, exc)
        return results

    @staticmethod
    async def get_cached_results() -> List[Dict]:
        """Read all cached drift results from Redis for the health endpoint."""
        try:
            r = aioredis.from_url(settings.redis_url, decode_responses=True)
            keys = await r.keys(f"{_DRIFT_REDIS_PREFIX}:*")
            results = []
            for key in keys:
                raw = await r.get(key)
                if raw:
                    try:
                        results.append(json.loads(raw))
                    except Exception:
                        pass
            await r.aclose()
            return results
        except Exception:
            return []
