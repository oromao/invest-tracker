from __future__ import annotations

import asyncio
import logging
import time
from typing import Optional

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.interval import IntervalTrigger
from prometheus_client import Counter, Gauge

from app.config import settings

logger = logging.getLogger(__name__)

# Per-module scheduler metrics
_JOB_RUNS = Counter(
    "alpha_scheduler_job_runs_total",
    "Scheduler job execution count",
    ["job_id"],
)
_JOB_FAILURES = Counter(
    "alpha_scheduler_job_failures_total",
    "Scheduler job failure count",
    ["job_id"],
)
_JOB_DURATION = Gauge(
    "alpha_scheduler_job_duration_seconds",
    "Last scheduler job duration",
    ["job_id"],
)

# Job timeout budgets (seconds)
_JOB_TIMEOUTS = {
    "ingest_job": 240,
    "features_job": 120,
    "regime_job": 180,
    "label_job": 180,
    "research_job": 600,
    "signal_job": 120,
}


async def _run_with_instrumentation(job_id: str, coro) -> None:
    """Wrap a job coroutine with timeout, metrics, and error isolation."""
    _JOB_RUNS.labels(job_id=job_id).inc()
    start = time.monotonic()
    timeout = _JOB_TIMEOUTS.get(job_id, 300)
    try:
        await asyncio.wait_for(coro, timeout=timeout)
        duration = time.monotonic() - start
        _JOB_DURATION.labels(job_id=job_id).set(duration)
        logger.info("Job %s completed in %.1fs", job_id, duration)
    except asyncio.TimeoutError:
        _JOB_FAILURES.labels(job_id=job_id).inc()
        logger.error("Job %s TIMED OUT after %ds", job_id, timeout)
    except Exception as exc:
        _JOB_FAILURES.labels(job_id=job_id).inc()
        logger.error("Job %s FAILED: %s", job_id, exc, exc_info=True)


async def _ingest_coro() -> None:
    from app.ingestor.ccxt_ingestor import CCXTIngestor
    ingestor = CCXTIngestor()
    try:
        await ingestor.run_full_ingest()
    finally:
        await ingestor.close()


async def _features_coro() -> None:
    from app.features.engine import FeatureEngine
    engine = FeatureEngine()
    for asset in settings.assets:
        for tf in settings.timeframes:
            try:
                await engine.run(asset, tf)
            except Exception as exc:
                logger.error("Features error %s/%s: %s", asset, tf, exc)


async def _regime_coro() -> None:
    from app.regime.detector import RegimeDetector
    detector = RegimeDetector()
    for asset in settings.assets:
        for tf in ["1h", "4h"]:
            try:
                await detector.detect(asset, tf)
            except Exception as exc:
                logger.error("Regime error %s/%s: %s", asset, tf, exc)


async def _label_coro() -> None:
    from app.labeling.triple_barrier import TripleBarrierLabeler
    labeler = TripleBarrierLabeler()
    for asset in settings.assets:
        for tf in ["1h", "4h"]:
            try:
                await labeler.run(asset, tf)
            except Exception as exc:
                logger.error("Label error %s/%s: %s", asset, tf, exc)


async def _research_coro() -> None:
    from app.research.lab import ResearchLab
    lab = ResearchLab()
    for asset in settings.assets:
        for tf in ["1h", "4h"]:
            try:
                result = await lab.run_research_cycle(asset, tf)
                if result.get("top_strategy"):
                    top = result["top_strategy"]
                    logger.info(
                        "Research %s/%s top: %s sharpe=%.2f PF=%.2f overfit=%s",
                        asset, tf,
                        top.get("name"),
                        top.get("sharpe", 0),
                        top.get("profit_factor", 0),
                        top.get("is_overfit", False),
                    )
            except Exception as exc:
                logger.error("Research error %s/%s: %s", asset, tf, exc)


async def _signal_coro() -> None:
    from app.signals.engine import SignalEngine
    engine = SignalEngine()
    for tf in ["1h", "4h"]:
        try:
            signals = await engine.generate_all_signals(timeframe=tf)
            logger.info("Generated %d signals for %s", len(signals), tf)
        except Exception as exc:
            logger.error("Signal job error %s: %s", tf, exc)


async def _run_ingest_job() -> None:
    await _run_with_instrumentation("ingest_job", _ingest_coro())


async def _run_features_job() -> None:
    await _run_with_instrumentation("features_job", _features_coro())


async def _run_regime_job() -> None:
    await _run_with_instrumentation("regime_job", _regime_coro())


async def _run_label_job() -> None:
    await _run_with_instrumentation("label_job", _label_coro())


async def _run_research_job() -> None:
    await _run_with_instrumentation("research_job", _research_coro())


async def _run_signal_job() -> None:
    await _run_with_instrumentation("signal_job", _signal_coro())


class AlphaScheduler:
    def __init__(self) -> None:
        self.scheduler = AsyncIOScheduler(timezone="UTC")
        self._setup_jobs()

    def _setup_jobs(self) -> None:
        self.scheduler.add_job(
            _run_ingest_job,
            trigger=IntervalTrigger(minutes=5),
            id="ingest_job",
            name="CCXT Ingest",
            replace_existing=True,
            max_instances=1,
            coalesce=True,
        )
        self.scheduler.add_job(
            _run_features_job,
            trigger=IntervalTrigger(minutes=15),
            id="features_job",
            name="Feature Engine",
            replace_existing=True,
            max_instances=1,
            coalesce=True,
        )
        self.scheduler.add_job(
            _run_regime_job,
            trigger=IntervalTrigger(hours=1),
            id="regime_job",
            name="Regime Detector",
            replace_existing=True,
            max_instances=1,
            coalesce=True,
        )
        self.scheduler.add_job(
            _run_label_job,
            trigger=IntervalTrigger(hours=1),
            id="label_job",
            name="Triple Barrier Labeler",
            replace_existing=True,
            max_instances=1,
            coalesce=True,
        )
        self.scheduler.add_job(
            _run_research_job,
            trigger=IntervalTrigger(hours=6),
            id="research_job",
            name="Research Lab",
            replace_existing=True,
            max_instances=1,
            coalesce=True,
        )
        self.scheduler.add_job(
            _run_signal_job,
            trigger=IntervalTrigger(minutes=15),
            id="signal_job",
            name="Signal Engine",
            replace_existing=True,
            max_instances=1,
            coalesce=True,
        )

    def start(self) -> None:
        self.scheduler.start()
        logger.info(
            "AlphaScheduler started with %d jobs", len(self.scheduler.get_jobs())
        )

    def stop(self) -> None:
        if self.scheduler.running:
            self.scheduler.shutdown(wait=False)
            logger.info("AlphaScheduler stopped")

    def get_jobs_info(self) -> list:
        return [
            {
                "id": job.id,
                "name": job.name,
                "next_run": str(job.next_run_time) if job.next_run_time else None,
            }
            for job in self.scheduler.get_jobs()
        ]

    async def run_initial_jobs(self) -> None:
        """
        Fire features + regime + signal jobs immediately at startup so the
        system has fresh state without waiting for the first interval tick.
        """
        logger.info("Running initial pipeline jobs at startup...")
        await _run_features_job()
        await _run_regime_job()
        await _run_signal_job()
        logger.info("Initial pipeline jobs complete")
