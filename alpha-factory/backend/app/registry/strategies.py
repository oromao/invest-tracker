from __future__ import annotations

import json
import logging
import uuid
from datetime import datetime, timezone
from typing import Dict, List, Optional

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import Strategy, StrategyStatusEnum

logger = logging.getLogger(__name__)


class StrategyRegistry:
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
        strat.updated_at = datetime.now(tz=timezone.utc)
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
            .values(status=StrategyStatusEnum.deprecated, updated_at=datetime.now(tz=timezone.utc))
        )
        # Promote target
        strat = await self.get_by_strategy_id(session, strategy_id)
        if strat is None:
            return None
        strat.status = StrategyStatusEnum.active
        strat.updated_at = datetime.now(tz=timezone.utc)
        await session.flush()
        logger.info("Promoted strategy %s to active", strategy_id)
        return strat

    async def list_all(self, session: AsyncSession) -> List[Strategy]:
        stmt = select(Strategy).order_by(Strategy.created_at.desc())
        result = await session.execute(stmt)
        return list(result.scalars().all())

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
