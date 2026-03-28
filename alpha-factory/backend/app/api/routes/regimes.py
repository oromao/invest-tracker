from __future__ import annotations
from typing import Optional
from fastapi import APIRouter, Depends, Query
from sqlalchemy import select, desc, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import MarketRegime
from app.db.session import get_db
from app.api.schemas import RegimeOut

router = APIRouter(prefix="/regimes", tags=["regimes"])


@router.get("", response_model=list[RegimeOut])
async def latest_regimes(db: AsyncSession = Depends(get_db)):
    """Latest regime per asset (1h timeframe)."""
    subq = (
        select(MarketRegime.asset, func.max(MarketRegime.timestamp).label("max_ts"))
        .where(MarketRegime.timeframe == "1h")
        .group_by(MarketRegime.asset)
        .subquery()
    )
    q = select(MarketRegime).join(
        subq,
        (MarketRegime.asset == subq.c.asset) & (MarketRegime.timestamp == subq.c.max_ts),
    )
    result = await db.execute(q)
    return result.scalars().all()


@router.get("/{asset}/history", response_model=list[RegimeOut])
async def regime_history(
    asset: str,
    timeframe: str = "1h",
    limit: int = Query(100, le=500),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(MarketRegime)
        .where(MarketRegime.asset == asset.upper(), MarketRegime.timeframe == timeframe)
        .order_by(desc(MarketRegime.timestamp))
        .limit(limit)
    )
    return result.scalars().all()
