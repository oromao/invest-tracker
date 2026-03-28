import asyncio
import logging
import json
from datetime import datetime, timezone
from sqlalchemy import select
from app.db.models import (
    Base, Asset, Strategy, BacktestRun, StrategyStatusEnum, 
    SignalSnapshot, DirectionEnum, Position
)
from app.db.session import async_session_factory, engine
from app.discovery.engine import AlphaDiscoveryEngine
from app.execution.executor import ExecutionEngine

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("Verification")

async def verify_system():
    logger.info("--- Starting System Verification ---")
    
    # 1. Ensure Tables Exist
    async with engine.begin() as conn:
        # This will create any missing tables
        await conn.run_sync(Base.metadata.create_all)
    logger.info("Database tables verified/created.")

    async with async_session_factory() as session:
        # 2. Seed Mock Strategy & Backtest for Promotion Test
        strat = Strategy(
            strategy_id="test_strat_123",
            name="Test Strategy",
            status=StrategyStatusEnum.candidate,
            params_json="{}"
        )
        session.add(strat)
        await session.flush()
        
        run = BacktestRun(
            strategy_id=strat.id,
            asset="BTC/USDT",
            timeframe="1h",
            profit_factor=1.5,
            total_trades=50,
            sharpe=1.2,
            run_at=datetime.now(tz=timezone.utc)
        )
        session.add(run)
        await session.commit()
        logger.info("Mock strategy and backtest seeded.")

        # 3. Test Batch Promotion
        discovery = AlphaDiscoveryEngine()
        await discovery.batch_promote_strategies()
        
        await session.refresh(strat)
        if strat.status == StrategyStatusEnum.active:
            logger.info("SUCCESS: Strategy promoted to ACTIVE automatically.")
        else:
            logger.error(f"FAILURE: Strategy status is {strat.status}")

        # 4. Test Execution Engine (Dry Run)
        # Create a mock SignalSnapshot
        snapshot = SignalSnapshot(
            asset="BTC/USDT",
            timestamp=datetime.now(tz=timezone.utc),
            signal=DirectionEnum.LONG,
            confidence=0.8,
            entry_price=60000.0,
            reason="Verification test"
        )
        session.add(snapshot)
        await session.commit()
        
        executor = ExecutionEngine()
        await executor.run_execution_cycle()
        
        # Verify position created locally
        stmt = select(Position).where(Position.asset == "BTC/USDT", Position.status == "open")
        result = await session.execute(stmt)
        pos = result.scalar_one_or_none()
        
        if pos and pos.side == DirectionEnum.LONG:
            logger.info("SUCCESS: Execution engine created local position from signal.")
        else:
            logger.error("FAILURE: No local position found after execution cycle.")
        
        await executor.close()

    logger.info("--- Verification Complete ---")

if __name__ == "__main__":
    asyncio.run(verify_system())
