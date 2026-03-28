"""
INVEST TRACKER ALPHA FACTORY — FastAPI entrypoint
"""
from __future__ import annotations

import asyncio
import logging
from contextlib import asynccontextmanager
from datetime import datetime, timezone

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from prometheus_client import Counter, Histogram, make_asgi_app

from app.db.models import Base
from app.db.session import engine

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(name)s %(levelname)s %(message)s",
)
logger = logging.getLogger(__name__)

# Prometheus metrics
REQUEST_COUNT = Counter(
    "alpha_factory_requests_total",
    "Total HTTP requests",
    ["method", "endpoint", "status"],
)
REQUEST_LATENCY = Histogram(
    "alpha_factory_request_latency_seconds",
    "HTTP request latency",
    ["method", "endpoint"],
)
SIGNAL_COUNT = Counter(
    "alpha_factory_signals_total",
    "Total signals generated",
    ["asset", "direction"],
)


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Create DB tables (idempotent)
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    logger.info("Database tables ready")

    # Ensure Qdrant collection exists
    try:
        from app.signals.rag import RagStore
        rag = RagStore()
        await rag.ensure_collection()
    except Exception as exc:
        logger.warning("Could not init Qdrant collection: %s", exc)

    # Start WebSocket ingestor as background task
    ws_task = None
    try:
        from app.ingestor.ws_ingestor import BinanceWSIngestor
        ws_ingestor = BinanceWSIngestor()
        ws_task = ws_ingestor.start()
        logger.info("Binance WebSocket ingestor started")
    except Exception as exc:
        logger.warning("WS ingestor failed to start: %s", exc)

    # Start APScheduler
    from app.scheduler.jobs import AlphaScheduler
    scheduler = AlphaScheduler()
    scheduler.start()

    yield

    # Shutdown
    logger.info("Shutting down Alpha Factory...")
    scheduler.stop()

    if ws_task and not ws_task.done():
        ws_task.cancel()
        try:
            await ws_task
        except asyncio.CancelledError:
            pass

    await engine.dispose()
    logger.info("Alpha Factory shutdown complete")


app = FastAPI(
    title="Alpha Factory",
    version="0.1.0",
    description="Autonomous alpha generation and signal engine for INVEST TRACKER",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# Prometheus request instrumentation middleware
from fastapi import Request
from fastapi.responses import Response
import time


@app.middleware("http")
async def prometheus_middleware(request: Request, call_next):
    start = time.perf_counter()
    response = await call_next(request)
    duration = time.perf_counter() - start

    endpoint = request.url.path
    REQUEST_COUNT.labels(
        method=request.method,
        endpoint=endpoint,
        status=str(response.status_code),
    ).inc()
    REQUEST_LATENCY.labels(method=request.method, endpoint=endpoint).observe(duration)

    return response


# Import and include all routers
from app.api.routes import backtests, portfolio, regimes, research, signals

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
    from app.scheduler.jobs import AlphaScheduler
    return {
        "status": "ok",
        "version": "0.1.0",
        "timestamp": datetime.now(tz=timezone.utc).isoformat(),
    }


@app.get("/api/status")
async def api_status():
    return {
        "service": "alpha-factory",
        "version": "0.1.0",
        "timestamp": datetime.now(tz=timezone.utc).isoformat(),
        "features": [
            "ohlcv_ingestion",
            "feature_engineering",
            "regime_detection",
            "triple_barrier_labeling",
            "research_lab",
            "signal_generation",
            "rag_context",
            "risk_engine",
        ],
    }


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        "app.main:app",
        host="0.0.0.0",
        port=8000,
        reload=False,
        log_level="info",
    )
