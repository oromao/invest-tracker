from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import List, Optional

from sqlalchemy import select, update, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import Strategy, Trade, StrategyStatusEnum
from app.db.session import AsyncSessionLocal

logger = logging.getLogger(__name__)

class StrategyAuditor:
    def __init__(
        self,
        min_trades: int = 5,
        win_rate_threshold: float = 0.40,
        profit_factor_threshold: float = 1.0,
    ):
        self.min_trades = min_trades
        self.win_rate_threshold = win_rate_threshold
        self.profit_factor_threshold = profit_factor_threshold

    async def audit_all_strategies(self) -> int:
        """
        Audit all active/candidate strategies and deprecate those that are underperforming.
        Returns the number of strategies deprecated.
        """
        deprecated_count = 0
        async with AsyncSessionLocal() as session:
            # 1. Fetch active strategies
            stmt = select(Strategy).where(
                Strategy.status.in_([StrategyStatusEnum.active, StrategyStatusEnum.candidate])
            )
            result = await session.execute(stmt)
            strategies = result.scalars().all()

            for strategy in strategies:
                is_decayed = await self._check_strategy_decay(session, strategy.strategy_id)
                if is_decayed:
                    logger.warning(
                        "Strategy %s decayed! Deprecating...", strategy.strategy_id
                    )
                    strategy.status = StrategyStatusEnum.deprecated
                    strategy.updated_at = datetime.now(timezone.utc)
                    deprecated_count += 1
            
            await session.commit()
        
        if deprecated_count > 0:
            logger.info("Audit complete: %d strategies deprecated.", deprecated_count)
        return deprecated_count

    async def _check_strategy_decay(self, session: AsyncSession, strategy_id: str) -> bool:
        """
        Check if a specific strategy ID shows signs of performance decay.
        Uses the last N trades to calculate metrics.
        """
        # Fetch last 20 trades for this strategy
        stmt = (
            select(Trade)
            .where(Trade.strategy_id == strategy_id)
            .order_by(Trade.exit_time.desc())
            .limit(20)
        )
        result = await session.execute(stmt)
        trades = result.scalars().all()

        if len(trades) < self.min_trades:
            return False  # Not enough data to judge yet

        wins = [t.pnl for t in trades if t.pnl > 0]
        losses = [abs(t.pnl) for t in trades if t.pnl <= 0]
        
        win_rate = len(wins) / len(trades)
        
        sum_wins = sum(wins)
        sum_losses = sum(losses)
        profit_factor = sum_wins / sum_losses if sum_losses > 0 else 10.0 # High value if no losses

        # Logic: If win rate is below threshold AND profit factor is below threshold, it's garbage.
        # Note: Some strategies might have low win rate but high profit factor (trend followers).
        # We only deprecate if BOTH are bad for the recent window.
        if win_rate < self.win_rate_threshold and profit_factor < self.profit_factor_threshold:
            logger.info(
                "DECAY DETECTED for %s | WR: %.2f | PF: %.2f",
                strategy_id, win_rate, profit_factor
            )
            return True

        return False
