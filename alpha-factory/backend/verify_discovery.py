import asyncio
import logging
import sys
from pathlib import Path

# Add backend to path
sys.path.append(str(Path(__file__).parent))

from app.discovery.engine import AlphaDiscoveryEngine
from app.db.session import engine
from app.db.models import Base

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("verify_discovery")

async def verify():
    logger.info("Verifying Alpha Discovery Engine...")
    
    # Check dependencies
    try:
        import vectorbt as vbt
        logger.info("vectorbt VERSION: %s", vbt.__version__)
    except ImportError:
        logger.error("vectorbt NOT INSTALLED")
        
    try:
        import backtrader as bt
        logger.info("backtrader VERSION: %s", bt.__version__)
    except ImportError:
        logger.error("backtrader NOT INSTALLED")

    # Run engine (limited cycle)
    engine_obj = AlphaDiscoveryEngine()
    
    asset = "BTC"
    tf = "1h"
    
    logger.info("Running test discovery cycle for %s/%s...", asset, tf)
    try:
        # Note: This requires data in the DB. 
        # For a pure smoke test, we check if it fails gracefully if no data.
        await engine_obj.run_discovery_cycle(asset, tf)
        logger.info("Discovery cycle completed (data check passed if no 'No data' warning)")
    except Exception as e:
        logger.error("Discovery Engine failed: %s", e)
    
    await engine.dispose()
    logger.info("Verification complete.")

if __name__ == "__main__":
    asyncio.run(verify())
