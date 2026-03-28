from __future__ import annotations
from fastapi import APIRouter, Depends, BackgroundTasks, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from pydantic import BaseModel

from app.db.models import Strategy
from app.db.session import get_db
from app.api.schemas import StrategyOut

router = APIRouter(prefix="/research", tags=["research"])


@router.get("/strategies", response_model=list[StrategyOut])
async def list_strategies(db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Strategy).order_by(Strategy.updated_at.desc()))
    return result.scalars().all()


class StatusUpdate(BaseModel):
    status: str  # draft | candidate | active | deprecated


@router.patch("/strategies/{sid}/status", response_model=StrategyOut)
async def update_status(sid: str, body: StatusUpdate, db: AsyncSession = Depends(get_db)):
    allowed = {"draft", "candidate", "active", "deprecated"}
    if body.status not in allowed:
        raise HTTPException(400, f"status must be one of {allowed}")

    result = await db.execute(select(Strategy).where(Strategy.strategy_id == sid))
    strat = result.scalar_one_or_none()
    if not strat:
        raise HTTPException(404, "Strategy not found")

    strat.status = body.status
    await db.commit()
    await db.refresh(strat)
    return strat


async def _research_cycle() -> None:
    from app.research.lab import run_research_cycle
    from app.config import settings
    from app.db.session import async_session
    async with async_session() as db:
        for asset in settings.assets:
            await run_research_cycle(db, asset, "1h")


@router.post("/run", status_code=202)
async def trigger_research(background_tasks: BackgroundTasks):
    background_tasks.add_task(_research_cycle)
    return {"status": "started"}
