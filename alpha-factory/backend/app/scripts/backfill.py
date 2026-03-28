import asyncio
import logging
from app.ingestor.ccxt_ingestor import CCXTIngestor

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

async def main():
    logger.info("Starting manual backfill...")
    ingestor = CCXTIngestor()
    try:
        await ingestor.run_full_ingest()
        logger.info("Backfill complete!")
    except Exception as e:
        logger.error(f"Backfill failed: {e}")
    finally:
        await ingestor.close()

if __name__ == "__main__":
    asyncio.run(main())
