from __future__ import annotations

import json
from typing import Optional

from fastapi import APIRouter, Depends, Query, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.schemas import RegimeResponse
from app.db.session import get_db
from app.regime.detector import RegimeDetector

router = APIRouter(prefix="/market", tags=["market"])

@router.get("/regime/{asset}", response_model=RegimeResponse)
async def get_market_regime(
    asset: str,
    timeframe: str = Query("1h", pattern="^(15m|1h|4h)$"),
    db: AsyncSession = Depends(get_db),
):
    """
    Get the current market regime for a specific asset.
    Example: GET /api/market/regime/BTC-USDT?timeframe=1h
    """
    # Normalize asset for DB lookup
    asset_norm = asset.replace("-", "/").upper()
    
    ai = RegimeDetector()
    regime_data = await ai.get_latest_regime(db, asset_norm, timeframe)
    
    # If no data exists in DB, attempt a real-time detection
    if not regime_data:
        try:
            await ai.detect(asset_norm, timeframe)
            # Fetch again after detection
            regime_data = await ai.get_latest_regime(db, asset_norm, timeframe)
        except Exception as exc:
            raise HTTPException(
                status_code=500, 
                detail=f"Error detecting regime for {asset_norm}: {str(exc)}"
            )
            
    if not regime_data:
        raise HTTPException(
            status_code=404, 
            detail=f"No regime data found for {asset_norm} on {timeframe} timeframe."
        )

    # Convert to response
    features = None
    if regime_data.features_json:
        try:
            features = json.loads(regime_data.features_json)
        except Exception:
            pass
            
    return RegimeResponse(
        id=regime_data.id,
        asset=regime_data.asset,
        timeframe=regime_data.timeframe,
        timestamp=regime_data.timestamp,
        regime=regime_data.regime.value,
        confidence=regime_data.confidence,
        features=features,
        created_at=regime_data.created_at,
    )
