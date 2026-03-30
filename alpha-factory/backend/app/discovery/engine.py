import logging
import json
import asyncio
from datetime import datetime, timezone
from typing import List, Dict, Any, Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from app.db.session import async_session_factory
from app.db.models import StrategyVersion, BacktestRun, BacktestTrade, BacktestMetric, StrategyVersionStatusEnum
from app.registry.strategies import StrategyVersionRegistry
from app.discovery.vector_researcher import VectorResearcher
from app.discovery.bt_simulator import BTSimulator

logger = logging.getLogger(__name__)

class AlphaDiscoveryEngine:
    """Orchestrates the discovery, backtesting, and promotion of strategy_versions."""

    def __init__(self):
        self.registry = StrategyVersionRegistry()

    async def run_discovery_cycle(self, asset: str, timeframe: str):
        """Run a full discovery cycle for a given asset/timeframe."""
        logger.info("Starting discovery cycle for %s/%s", asset, timeframe)
        
        researcher = VectorResearcher(asset, timeframe)
        if not await researcher.load_data():
            logger.warning("No data for %s/%s. Skipping cycle.", asset, timeframe)
            return
            
        # 1. High-speed vectorized research
        candidates = await researcher.get_top_candidates(top_n=3)
        logger.info("Found %d candidates via vector research", len(candidates))
        
        # 2. Deep validation with Backtrader
        simulator = BTSimulator(researcher.df)
        
        for candidate in candidates:
            try:
                # Run the deep simulation
                # BTSimulator expects a strategy_type and its related params
                # For now, we only support ema_crossover in BTSimulator
                metrics = simulator.run(
                    strategy_type="ema_crossover", 
                    params=candidate["params"]
                )
                
                # 3. Persist results
                async with async_session_factory() as session:
                    await self._persist_results(session, asset, timeframe, candidate, metrics)
                    await session.commit()
                    
                # 4. Promotion Logic
                await self._evaluate_promotion(asset, timeframe, candidate, metrics)
                
            except Exception as e:
                logger.error("Error processing candidate %s: %s", candidate["name"], e)

    async def _persist_results(
        self, session: AsyncSession, asset: str, timeframe: str, candidate: Dict, metrics: Dict
    ):
        """Persist candidate, backtest run, and metrics."""
        # Ensure strategy exists in registry as draft
        strategy = await self.registry.get_or_create_draft(
            session, candidate["name"], candidate["params"]
        )
        
        # Create BacktestRun
        run = BacktestRun(
            strategy_id=strategy.id,
            asset=asset,
            timeframe=timeframe,
            params_json=json.dumps(candidate["params"]),
            sharpe=metrics.get("sharpe"),
            profit_factor=metrics.get("profit_factor"),
            max_drawdown=metrics.get("max_drawdown"),
            total_trades=metrics.get("total_trades"),
            # etc...
        )
        session.add(run)
        await session.flush() # Get run.id
        
        # Persist granular metrics
        for name, value in metrics.items():
            if isinstance(value, (int, float)):
                m = BacktestMetric(
                    backtest_run_id=run.id,
                    metric_name=name,
                    value=float(value)
                )
                session.add(m)
                
        logger.info("Persisted results for strategy %s (Run ID: %s)", strategy.name, run.id)

    async def _evaluate_promotion(self, asset: str, timeframe: str, candidate: Dict, metrics: Dict):
        """Evaluate if strategy should be promoted from draft to candidate or active."""
        # Promotion Criteria:
        # Profit Factor > 1.2 and Sharpe > 1.0 and min trades > 10
        pf = metrics.get("profit_factor", 0.0)
        sharpe = metrics.get("sharpe", 0.0)
        trades = metrics.get("total_trades", 0)
        
        if pf > 1.2 and sharpe > 1.0 and trades > 10:
            logger.info("StrategyVersion %s meets PROMOTION criteria (PF=%.2f, Sharpe=%.2f)", candidate["name"], pf, sharpe)
            
            async with async_session_factory() as session:
                strat = await self.registry.get_by_strategy_id(session, candidate["name"])
                if strat and strat.status == StrategyVersionStatusEnum.draft:
                    strat.status = StrategyVersionStatusEnum.candidate
                    await session.commit()
                    logger.info("Promoted %s to CANDIDATE", candidate["name"])
        
        # Further promotion to ACTIVE would usually require manual approval or 
        # a longer validation period, but we can automate if the PF is exceptional
        if pf > 2.0 and sharpe > 2.5 and trades > 20:
             async with async_session_factory() as session:
                await self.registry.promote_to_active(session, candidate["name"])
                await session.commit()
                logger.info("Promoted %s to ACTIVE (Exceptional performance)", candidate["name"])

    async def batch_promote_strategy_versions(self):
        """Periodically run a global promotion/deprecation check across all strategy_versions."""
        logger.info("Starting batch strategy promotion/deprecation check")
        async with async_session_factory() as session:
            # 1. Check candidates for promotion to active
            candidates = await self.registry.get_candidates(session)
            for strat in candidates:
                # Get latest backtest run
                stmt = select(BacktestRun).where(BacktestRun.strategy_id == strat.id).order_by(BacktestRun.run_at.desc()).limit(1)
                result = await session.execute(stmt)
                run = result.scalar_one_or_none()
                
                if (run and run.profit_factor and run.profit_factor > 1.2 
                    and run.total_trades and run.total_trades > 30 
                    and run.sharpe and run.sharpe > 1.0):
                    logger.info("Promoting strategy %s to active", strat.strategy_id)
                    strat.status = StrategyVersionStatusEnum.active
            
            # 2. Check active for deprecation
            active = await self.registry.get_active_strategy_versions(session)
            for strat in active:
                # If we had a live trade logger, we'd check live Pnl here
                # For now, let's re-check the latest backtest
                stmt = select(BacktestRun).where(BacktestRun.strategy_id == strat.id).order_by(BacktestRun.run_at.desc()).limit(1)
                result = await session.execute(stmt)
                run = result.scalar_one_or_none()
                
                if run and run.profit_factor and run.profit_factor < 1.05:
                    logger.warning("Deprecating strategy %s (PF dropped to %.2f)", strat.strategy_id, run.profit_factor)
                    strat.status = StrategyVersionStatusEnum.deprecated

            await session.commit()
