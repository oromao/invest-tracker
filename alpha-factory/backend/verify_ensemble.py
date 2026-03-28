import asyncio
import logging
import sys
import json
from datetime import datetime, timezone, timedelta
from pathlib import Path

# Add backend to path
sys.path.append(str(Path(__file__).parent))

from app.ensemble.engine import MetaStrategyEnsemble
from app.db.session import engine, AsyncSessionLocal
from app.db.models import (
    Base, 
    Strategy, 
    StrategyStatusEnum, 
    OHLCVBar, 
    Feature, 
    MarketRegime,
    RegimeEnum,
    BacktestRun
)

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("verify_ensemble")

async def seed_test_data():
    async with AsyncSessionLocal() as session:
        now = datetime.now(tz=timezone.utc)
        asset = "BTC"
        tf = "1h"
        
        # 1. Create a dummy active strategy
        strat = Strategy(
            strategy_id="test_ensemble_strat_1",
            name="Test Ensemble Strategy",
            params_json=json.dumps({"type": "rsi", "rsi_buy": 40, "rsi_sell": 60, "regime": ["BULL_TREND"]}),
            status=StrategyStatusEnum.active
        )
        session.add(strat)
        await session.flush()
        
        # 2. Add a backtest run to give it weight
        br = BacktestRun(
            strategy_id=strat.id,
            asset=asset,
            timeframe=tf,
            profit_factor=1.5,
            sharpe=2.0,
            run_at=now - timedelta(hours=1)
        )
        session.add(br)
        
        # 3. Add current OHLCV bar
        bar = OHLCVBar(
            asset=asset,
            timeframe=tf,
            timestamp=now,
            open=50000.0,
            high=51000.0,
            low=49000.0,
            close=50500.0,
            volume=100.0
        )
        session.add(bar)
        
        # 4. Add features (RSI < 40 for LONG signal)
        f1 = Feature(asset=asset, timeframe=tf, timestamp=now, feature_name="rsi_14", value=35.0)
        f2 = Feature(asset=asset, timeframe=tf, timestamp=now, feature_name="atr_14", value=1000.0)
        f3 = Feature(asset=asset, timeframe=tf, timestamp=now, feature_name="close", value=50500.0)
        session.add_all([f1, f2, f3])
        
        # 5. Add market regime (Matching strategy regime)
        reg = MarketRegime(
            asset=asset,
            timeframe=tf,
            timestamp=now,
            regime=RegimeEnum.BULL_TREND,
            confidence=0.9
        )
        session.add(reg)
        
        await session.commit()
        logger.info("Test data seeded successfully.")
        return strat.id

async def verify():
    logger.info("Verifying Meta Strategy Ensemble...")
    
    # 1. Seed data
    strat_id = await seed_test_data()
    
    # 2. Run Ensemble
    ensemble = MetaStrategyEnsemble()
    asset = "BTC"
    tf = "1h"
    
    logger.info("Running ensemble for %s/%s...", asset, tf)
    try:
        snapshot = await ensemble.generate_ensemble_signal(asset, tf)
        if snapshot:
            logger.info("Ensemble Signal: %s", snapshot.signal)
            logger.info("Confidence: %.2f", snapshot.confidence)
            logger.info("Reason: %s", snapshot.reason)
            logger.info("Weights: %s", snapshot.weights_json)
            
            if snapshot.signal != "NO_TRADE":
                logger.info("SUCCESS: Ensemble generated a trade signal.")
            else:
                logger.info("Ensemble returned NO_TRADE (check logic if signal was expected).")
        else:
            logger.error("Ensemble failed to return a snapshot.")
    except Exception as e:
        logger.error("Ensemble Engine failed: %s", e)
    
    await engine.dispose()
    logger.info("Verification complete.")

if __name__ == "__main__":
    asyncio.run(verify())
