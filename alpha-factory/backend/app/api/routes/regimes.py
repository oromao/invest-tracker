from __future__ import annotations

import json
from datetime import datetime
from typing import List, Optional

from fastapi import APIRouter, Depends, Query
from sqlalchemy import desc, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.schemas import RegimeResponse
from app.db.models import MarketRegime
from app.db.session import get_db

router = APIRouter(prefix="/regimes", tags=["regimes"])


def _regime_to_response(r: MarketRegime) -> RegimeResponse:
    features = None
    if r.features_json:
        try:
            features = json.loads(r.features_json)
        except Exception:
            pass
    return RegimeResponse(
        id=r.id,
        asset=r.asset,
        timeframe=r.timeframe,
        timestamp=r.timestamp,
        regime=r.regime.value if hasattr(r.regime, "value") else r.regime,
        confidence=r.confidence,
        features=features,
        created_at=r.created_at,
    )


@router.get("", response_model=List[RegimeResponse])
async def get_latest_regimes(
    timeframe: str = "1h",
    db: AsyncSession = Depends(get_db),
):
    """Latest regime per asset."""
    subq = (
        select(MarketRegime.asset, func.max(MarketRegime.id).label("max_id"))
        .where(MarketRegime.timeframe == timeframe)
        .group_by(MarketRegime.asset)
        .subquery()
    )
    stmt = select(MarketRegime).join(
        subq,
        MarketRegime.id == subq.c.max_id,
    )
    result = await db.execute(stmt)
    regimes = result.scalars().all()
    if not regimes:
        return []
    return [_regime_to_response(r) for r in regimes]


@router.get("/{asset}/history", response_model=List[RegimeResponse])
async def get_regime_history(
    asset: str,
    timeframe: str = "1h",
    limit: int = Query(100, le=500),
    db: AsyncSession = Depends(get_db),
):
    """Regime history for a specific asset."""
    asset_normalized = asset.replace("-", "/").upper()
    stmt = (
        select(MarketRegime)
        .where(
            MarketRegime.asset == asset_normalized,
            MarketRegime.timeframe == timeframe,
        )
        .order_by(desc(MarketRegime.timestamp))
        .limit(limit)
    )
    result = await db.execute(stmt)
    regimes = result.scalars().all()
    return [_regime_to_response(r) for r in regimes]
