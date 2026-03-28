"""
INVEST TRACKER ALPHA FACTORY — FastAPI entrypoint
"""
from __future__ import annotations

import asyncio
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from prometheus_client import make_asgi_app

from app.db.session import engine
from app.db.models import Base
from app.scheduler.jobs import build_scheduler
from app.api.routes import signals, backtests, research, regimes, portfolio

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(levelname)s %(message)s")
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Create tables
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    logger.info("Database tables ready")

    # Start WebSocket ingestor in background
    from app.ingestor.ws_ingestor import BinanceWSIngestor
    ws = BinanceWSIngestor()
    ws_task = asyncio.create_task(ws.run())

    # Start scheduler
    scheduler = build_scheduler()
    scheduler.start()
    logger.info("Scheduler started with %d jobs", len(scheduler.get_jobs()))

    yield

    scheduler.shutdown(wait=False)
    ws_task.cancel()
    await engine.dispose()


app = FastAPI(title="Alpha Factory", version="0.1.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# API routes
app.include_router(signals.router, prefix="/api")
app.include_router(backtests.router, prefix="/api")
app.include_router(research.router, prefix="/api")
app.include_router(regimes.router, prefix="/api")
app.include_router(portfolio.router, prefix="/api")

# Prometheus metrics endpoint
metrics_app = make_asgi_app()
app.mount("/metrics", metrics_app)


@app.get("/health")
async def health():
    return {"status": "ok"}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("app.main:app", host="0.0.0.0", port=8000, reload=False)
