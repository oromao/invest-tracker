"""
INVEST TRACKER ALPHA FACTORY — FastAPI entrypoint
"""
from __future__ import annotations

import asyncio
import logging
import time
from contextlib import asynccontextmanager
from datetime import datetime, timezone

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from prometheus_client import Counter, Gauge, Histogram, make_asgi_app

from app.config import settings
from app.db.models import Base
from app.db.session import engine

# Structured log format — one JSON-ish line per record
logging.basicConfig(
    level=logging.INFO,
    format='{"time":"%(asctime)s","logger":"%(name)s","level":"%(levelname)s","msg":"%(message)s"}',
)
logger = logging.getLogger(__name__)

# ── Prometheus metrics ──────────────────────────────────────────────────────
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
INGEST_BARS = Counter(
    "alpha_factory_ingest_bars_total",
    "Total OHLCV bars ingested",
    ["asset", "timeframe"],
)
FEATURE_ROWS = Counter(
    "alpha_factory_feature_rows_total",
    "Total feature rows upserted",
    ["asset", "timeframe"],
)
REGIME_DETECTIONS = Counter(
    "alpha_factory_regime_detections_total",
    "Total regime detections",
    ["asset", "timeframe", "regime"],
)
BACKTEST_RUNS = Counter(
    "alpha_factory_backtest_runs_total",
    "Total backtest runs",
    ["variant"],
)
VALIDATION_ERRORS = Counter(
    "alpha_factory_validation_errors_total",
    "Total OHLCV validation errors",
    ["asset", "timeframe"],
)
DATA_FRESHNESS = Gauge(
    "alpha_factory_data_age_seconds",
    "Seconds since last OHLCV bar was ingested",
    ["asset"],
)


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Create DB tables (idempotent)
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    logger.info('{"event":"db_tables_ready"}')

    # Ensure Qdrant collection (non-fatal)
    try:
        from app.signals.rag import RagStore
        rag = RagStore()
        await rag.ensure_collection()
        logger.info('{"event":"qdrant_collection_ready"}')
    except Exception as exc:
        logger.warning('{"event":"qdrant_unavailable","error":"%s"}', exc)

    # Start WebSocket ingestor (non-fatal)
    ws_task = None
    try:
        from app.ingestor.ws_ingestor import BinanceWSIngestor
        ws_ingestor = BinanceWSIngestor()
        ws_task = ws_ingestor.start()
        logger.info('{"event":"ws_ingestor_started"}')
    except Exception as exc:
        logger.warning('{"event":"ws_ingestor_failed","error":"%s"}', exc)

    # Start APScheduler
    from app.scheduler.jobs import AlphaScheduler
    scheduler = AlphaScheduler()
    scheduler.start()
    app.state.scheduler = scheduler

    # Fire initial pipeline jobs so the system has fresh data immediately
    asyncio.create_task(scheduler.run_initial_jobs())

    yield

    # Shutdown
    logger.info('{"event":"shutdown_start"}')
    scheduler.stop()

    if ws_task and not ws_task.done():
        ws_task.cancel()
        try:
            await ws_task
        except asyncio.CancelledError:
            pass

    await engine.dispose()
    logger.info('{"event":"shutdown_complete"}')


app = FastAPI(
    title="Alpha Factory",
    version="0.2.0",
    description="Autonomous alpha generation and signal engine for INVEST TRACKER",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


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


# ── Routers ─────────────────────────────────────────────────────────────────
from app.api.routes import backtests, portfolio, regimes, research, signals

app.include_router(signals.router, prefix="/api")
app.include_router(backtests.router, prefix="/api")
app.include_router(research.router, prefix="/api")
app.include_router(regimes.router, prefix="/api")
app.include_router(portfolio.router, prefix="/api")

# Prometheus scrape endpoint
metrics_app = make_asgi_app()
app.mount("/metrics", metrics_app)


# ── Health endpoint ──────────────────────────────────────────────────────────
@app.get("/health")
async def health():
    """
    Deep health check. Returns 200 with per-component status.
    Returns 503 if any critical component is unhealthy.
    """
    from app.db.session import AsyncSessionLocal
    from sqlalchemy import text

    checks: dict = {}
    overall = "ok"

    # 1. Database
    try:
        async with AsyncSessionLocal() as session:
            await session.execute(text("SELECT 1"))
        checks["database"] = "ok"
    except Exception as exc:
        checks["database"] = f"error: {exc}"
        overall = "degraded"

    # 2. Redis
    try:
        import redis.asyncio as aioredis
        r = aioredis.from_url(settings.redis_url)
        await r.ping()
        await r.aclose()
        checks["redis"] = "ok"
    except Exception as exc:
        checks["redis"] = f"error: {exc}"
        overall = "degraded"

    # 3. Data freshness (last OHLCV bar per primary asset)
    try:
        async with AsyncSessionLocal() as session:
            from app.db.models import OHLCVBar
            from sqlalchemy import desc, select as sa_select
            now = datetime.now(tz=timezone.utc)
            freshness = {}
            for asset in settings.assets[:2]:  # check first 2 assets
                stmt = (
                    sa_select(OHLCVBar.timestamp)
                    .where(OHLCVBar.asset == asset, OHLCVBar.timeframe == "1h")
                    .order_by(desc(OHLCVBar.timestamp))
                    .limit(1)
                )
                result = await session.execute(stmt)
                row = result.scalar_one_or_none()
                if row:
                    ts = row
                    if ts.tzinfo is None:
                        ts = ts.replace(tzinfo=timezone.utc)
                    age_seconds = (now - ts).total_seconds()
                    DATA_FRESHNESS.labels(asset=asset).set(age_seconds)
                    freshness[asset] = f"{age_seconds / 3600:.1f}h ago"
                else:
                    freshness[asset] = "no data"
            checks["data_freshness"] = freshness
    except Exception as exc:
        checks["data_freshness"] = f"error: {exc}"

    # 4. Scheduler status
    try:
        scheduler = getattr(app.state, "scheduler", None)
        if scheduler and scheduler.scheduler.running:
            jobs = scheduler.get_jobs_info()
            checks["scheduler"] = {"running": True, "jobs": len(jobs)}
        else:
            checks["scheduler"] = {"running": False}
            overall = "degraded"
    except Exception as exc:
        checks["scheduler"] = f"error: {exc}"

    status_code = 200 if overall == "ok" else 503
    return {
        "status": overall,
        "version": "0.2.0",
        "dry_run": settings.dry_run,
        "timestamp": datetime.now(tz=timezone.utc).isoformat(),
        "checks": checks,
    }


@app.get("/api/status")
async def api_status():
    scheduler = getattr(app.state, "scheduler", None)
    jobs = scheduler.get_jobs_info() if scheduler else []
    return {
        "service": "alpha-factory",
        "version": "0.2.0",
        "dry_run": settings.dry_run,
        "timestamp": datetime.now(tz=timezone.utc).isoformat(),
        "features": [
            "ohlcv_ingestion",
            "ohlcv_validation",
            "feature_engineering",
            "regime_detection",
            "triple_barrier_labeling",
            "walk_forward_backtest",
            "research_lab",
            "signal_generation",
            "rag_context",
            "risk_engine",
            "duplicate_signal_protection",
        ],
        "scheduler_jobs": jobs,
    }


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("app.main:app", host="0.0.0.0", port=8000, reload=False, log_level="info")
