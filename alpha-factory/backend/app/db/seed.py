import asyncio
import logging
from sqlalchemy import select
from app.db.models import Asset
from app.db.session import async_session_factory

logger = logging.getLogger(__name__)

INITIAL_ASSETS = [
    {
        "symbol": "BTC/USDT",
        "price_precision": 2,
        "quantity_precision": 3,
        "min_notional": 10.0,
        "max_leverage": 10.0,
        "is_active": True
    },
    {
        "symbol": "ETH/USDT",
        "price_precision": 2,
        "quantity_precision": 3,
        "min_notional": 10.0,
        "max_leverage": 10.0,
        "is_active": True
    },
    {
        "symbol": "SOL/USDT",
        "price_precision": 3,
        "quantity_precision": 2,
        "min_notional": 10.0,
        "max_leverage": 5.0,
        "is_active": True
    },
    {
        "symbol": "BNB/USDT",
        "price_precision": 2,
        "quantity_precision": 2,
        "min_notional": 10.0,
        "max_leverage": 5.0,
        "is_active": True
    }
]

async def seed_assets():
    """Seed initial assets if they don't exist."""
    async with async_session_factory() as session:
        for asset_data in INITIAL_ASSETS:
            stmt = select(Asset).where(Asset.symbol == asset_data["symbol"])
            result = await session.execute(stmt)
            existing = result.scalar_one_or_none()
            
            if not existing:
                logger.info("Seeding asset: %s", asset_data["symbol"])
                asset = Asset(**asset_data)
                session.add(asset)
        
        await session.commit()
    logger.info("Asset seeding complete.")

if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    asyncio.run(seed_assets())
