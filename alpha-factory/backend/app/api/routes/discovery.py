from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from typing import Dict, List

from app.db.session import get_session
from app.discovery.engine import AlphaDiscoveryEngine
from app.config import settings

router = APIRouter()
engine = AlphaDiscoveryEngine()

@router.post("/run")
async def run_discovery(
    background_tasks: BackgroundTasks,
    asset: str = "BTC",
    timeframe: str = "1h"
):
    """Manually trigger a discovery cycle in the background."""
    if asset not in settings.assets:
        raise HTTPException(status_code=400, detail=f"Asset {asset} not supported")
    
    background_tasks.add_task(engine.run_discovery_cycle, asset, timeframe)
    return {"status": "Discovery cycle started", "asset": asset, "timeframe": timeframe}

@router.get("/status")
async def get_discovery_status():
    """Check status of discovery (simplified)."""
    # In a real app, we'd track job status in Redis or DB
    return {"status": "idle", "last_run": "not implemented"}
