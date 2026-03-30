from __future__ import annotations

import json
import logging
import uuid
from typing import Dict, List, Optional

from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import Strategy, StrategyMemory, StrategyStatusEnum
from app.research.memory import StrategyMemoryStore
from app.shared.time import now_sao_paulo

logger = logging.getLogger(__name__)


class StrategyRegistry:
    def __init__(self) -> None:
        self.memory = StrategyMemoryStore()

    async def create_strategy(
        self,
        session: AsyncSession,
        name: str,
        params: Dict,
        status: StrategyStatusEnum = StrategyStatusEnum.draft,
    ) -> Strategy:
        strategy_id = f"{name}_{uuid.uuid4().hex[:8]}"
        strategy = Strategy(
            strategy_id=strategy_id,
            version=1,
            name=name,
            params_json=json.dumps(params),
            status=status,
        )
        session.add(strategy)
        await session.flush()
        logger.info("Created strategy %s (status=%s)", strategy_id, status.value)
        return strategy

    async def get_by_strategy_id(
        self, session: AsyncSession, strategy_id: str
    ) -> Optional[Strategy]:
        stmt = select(Strategy).where(Strategy.strategy_id == strategy_id)
        result = await session.execute(stmt)
        return result.scalar_one_or_none()

    async def update_status(
        self,
        session: AsyncSession,
        strategy_id: str,
        new_status: StrategyStatusEnum,
    ) -> Optional[Strategy]:
        strat = await self.get_by_strategy_id(session, strategy_id)
        if strat is None:
            logger.warning("Strategy %s not found", strategy_id)
            return None
        strat.status = new_status
        strat.updated_at = now_sao_paulo()
        await session.flush()
        return strat

    async def get_active_strategies(self, session: AsyncSession) -> List[Strategy]:
        stmt = select(Strategy).where(Strategy.status == StrategyStatusEnum.active)
        result = await session.execute(stmt)
        return list(result.scalars().all())

    async def get_candidates(self, session: AsyncSession) -> List[Strategy]:
        stmt = select(Strategy).where(Strategy.status == StrategyStatusEnum.candidate)
        result = await session.execute(stmt)
        return list(result.scalars().all())

    async def promote_to_active(
        self, session: AsyncSession, strategy_id: str
    ) -> Optional[Strategy]:
        """Promote strategy to active, deprecating all currently active strategies."""
        # Deprecate existing active strategies
        await session.execute(
            update(Strategy)
            .where(Strategy.status == StrategyStatusEnum.active)
            .values(status=StrategyStatusEnum.deprecated, updated_at=now_sao_paulo())
        )
        # Promote target
        strat = await self.get_by_strategy_id(session, strategy_id)
        if strat is None:
            return None
        strat.status = StrategyStatusEnum.active
        strat.updated_at = now_sao_paulo()
        await session.flush()
        logger.info("Promoted strategy %s to active", strategy_id)
        return strat

    async def list_all(self, session: AsyncSession) -> List[Strategy]:
        stmt = select(Strategy).order_by(Strategy.created_at.desc())
        result = await session.execute(stmt)
        return list(result.scalars().all())

    async def list_with_latest_state(self, session: AsyncSession) -> List[Dict]:
        rows = await self.list_all(session)
        payload: List[Dict] = []
        for strat in rows:
            latest_state = await self.memory.latest_state(session, strat.strategy_id)
            payload.append(
                {
                    "strategy": strat,
                    "latest_state": latest_state,
                }
            )
        return payload

    async def get_best_strategy(
        self,
        session: AsyncSession,
        *,
        asset: Optional[str] = None,
        timeframe: Optional[str] = None,
    ) -> Optional[Dict]:
        leaderboard = await self.memory.leaderboard(session, asset=asset, timeframe=timeframe, limit=1)
        if leaderboard:
            best = leaderboard[0]
            strat = await self.get_by_strategy_id(session, best.strategy_id)
            return {"strategy": strat, "memory": best}

        candidates = await self.get_active_strategies(session)
        if not candidates:
            candidates = await self.get_candidates(session)
        if not candidates:
            return None
        strat = candidates[0]
        latest = await self.memory.latest_state(session, strat.strategy_id)
        return {"strategy": strat, "memory": latest}

    async def get_or_create_draft(
        self,
        session: AsyncSession,
        name: str,
        params: Dict,
    ) -> Strategy:
        """Get existing draft by name or create new one."""
        stmt = select(Strategy).where(
            Strategy.name == name, Strategy.status == StrategyStatusEnum.draft
        )
        result = await session.execute(stmt)
        existing = result.scalar_one_or_none()
        if existing:
            return existing
        return await self.create_strategy(session, name, params, StrategyStatusEnum.draft)
