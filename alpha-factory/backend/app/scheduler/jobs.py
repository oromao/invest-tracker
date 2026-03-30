from __future__ import annotations

import asyncio
import json
import logging
import time
from datetime import datetime
from typing import Optional

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.interval import IntervalTrigger
import redis.asyncio as aioredis
from prometheus_client import Counter, Gauge

from app.config import settings
from app.shared.time import now_sao_paulo

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
    "execution_job": 60,
    "sync_positions_job": 120,
    "audit_job": 180,
    "drift_job": 120,
    "paper_ingest_job": 60,
    "paper_allocation_job": 120,
    "paper_update_job": 60,
    "paper_decay_job": 60,
}

JOB_INTERVAL_MINUTES = {
    "ingest_job": 5,
    "features_job": 15,
    "regime_job": 60,
    "label_job": 60,
    "research_job": 360,
    "signal_job": 15,
    "execution_job": 1,
    "sync_positions_job": 15,
    "audit_job": 60,
    "drift_job": 120,
    "paper_ingest_job": 15,
    "paper_allocation_job": 15,
    "paper_update_job": 5,
    "paper_decay_job": 120,
    "watchdog_job": 10,
}


def _heartbeat_key(job_id: str) -> str:
    return f"alpha:scheduler:heartbeat:{job_id}"


async def _record_heartbeat(job_id: str, status: str, duration: float | None = None, error: str | None = None) -> None:
    try:
        r = aioredis.from_url(settings.redis_url, decode_responses=True)
        payload = {
            "job_id": job_id,
            "status": status,
            "duration": duration,
            "error": error,
            "timestamp": now_sao_paulo().isoformat(),
        }
        await r.set(_heartbeat_key(job_id), json.dumps(payload), ex=24 * 3600)
        await r.aclose()
    except Exception as exc:
        logger.debug("Heartbeat write failed for %s: %s", job_id, exc)


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
        await _record_heartbeat(job_id, "ok", duration=duration)
    except asyncio.TimeoutError:
        _JOB_FAILURES.labels(job_id=job_id).inc()
        logger.error("Job %s TIMED OUT after %ds", job_id, timeout)
        await _record_heartbeat(job_id, "timeout", duration=timeout, error="timeout")
    except Exception as exc:
        _JOB_FAILURES.labels(job_id=job_id).inc()
        logger.error("Job %s FAILED: %s", job_id, exc, exc_info=True)
        await _record_heartbeat(job_id, "error", duration=time.monotonic() - start, error=str(exc))


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


async def _execution_coro() -> None:
    from app.execution.executor import ExecutionEngine
    engine = ExecutionEngine()
    try:
        await engine.run_execution_cycle()
    finally:
        await engine.close()


async def _sync_positions_coro() -> None:
    from app.execution.executor import ExecutionEngine
    engine = ExecutionEngine()
    try:
        await engine.sync_positions()
    finally:
        await engine.close()


async def _audit_coro() -> None:
    from app.risk.auditor import StrategyAuditor
    auditor = StrategyAuditor()
    await auditor.audit_all_strategies()


async def _drift_coro() -> None:
    from app.monitor.drift import DriftMonitor
    monitor = DriftMonitor()
    for asset in settings.assets:
        for tf in ["1h", "4h"]:
            try:
                result = await monitor.run(asset, tf)
                if result.drift_detected or result.regime_unstable:
                    logger.warning(
                        "Drift alert %s/%s: drift=%s regime_unstable=%s",
                        asset, tf, result.drift_detected, result.regime_unstable,
                    )
            except Exception as exc:
                logger.error("Drift monitor error %s/%s: %s", asset, tf, exc)


async def _paper_ingest_coro() -> None:
    from app.execution.paper_trader import PaperTrader
    trader = PaperTrader()
    n = await trader.ingest_new_signals()
    logger.info("Paper trader ingested %d new signals", n)


async def _paper_allocation_coro() -> None:
    from app.execution.paper_allocator import PaperPortfolioAllocator
    allocator = PaperPortfolioAllocator()
    allocations = await allocator.refresh_allocations()
    logger.info("Paper allocation refreshed for %d strategies", len(allocations))


async def _paper_update_coro() -> None:
    from app.execution.paper_trader import PaperTrader
    trader = PaperTrader()
    result = await trader.update_positions()
    logger.info(
        "Paper trader update: closed=%s pnl=%.4f instability=%s",
        result.get("closed", 0),
        result.get("total_pnl", 0.0),
        result.get("instability", False),
    )


async def _paper_decay_coro() -> None:
    from app.execution.paper_trader import PaperTrader
    trader = PaperTrader()
    demoted = await trader.check_and_demote_decayed()
    if demoted:
        logger.warning("Paper trader demoted %d decayed strategies", demoted)


async def _watchdog_coro() -> None:
    r = None
    try:
        r = aioredis.from_url(settings.redis_url, decode_responses=True)
        now = now_sao_paulo()
        stale = []
        for job_id in (
            "ingest_job",
            "features_job",
            "regime_job",
            "label_job",
            "research_job",
            "signal_job",
            "execution_job",
            "sync_positions_job",
            "audit_job",
            "drift_job",
            "paper_ingest_job",
            "paper_allocation_job",
            "paper_update_job",
            "paper_decay_job",
        ):
            raw = await r.get(f"alpha:scheduler:heartbeat:{job_id}")
            if not raw:
                stale.append(job_id)
                continue
            payload = json.loads(raw)
            interval_min = JOB_INTERVAL_MINUTES.get(job_id, 10)
            try:
                hb_ts = datetime.fromisoformat(payload["timestamp"])
            except Exception:
                stale.append(job_id)
                continue
            age_min = (now - hb_ts).total_seconds() / 60.0
            if age_min > interval_min * 3:
                stale.append(job_id)
    except Exception as exc:
        logger.warning("Watchdog heartbeat scan failed: %s", exc)
        stale = ["ingest_job", "features_job", "regime_job", "signal_job", "research_job"]
    finally:
        if r is not None:
            try:
                await r.aclose()
            except Exception:
                pass

    if not stale:
        logger.info("Watchdog healthy: no stale jobs detected")
        return

    logger.warning("Watchdog detected stale jobs: %s", ", ".join(stale))
    if "ingest_job" in stale:
        await _run_ingest_job()
    if "features_job" in stale:
        await _run_features_job()
    if "regime_job" in stale:
        await _run_regime_job()
    if "label_job" in stale:
        await _run_label_job()
    if "signal_job" in stale:
        await _run_signal_job()
    if "execution_job" in stale:
        await _run_execution_job()
    if "sync_positions_job" in stale:
        await _run_sync_positions_job()
    if "audit_job" in stale:
        await _run_audit_job()
    if "drift_job" in stale:
        await _run_drift_job()
    if "paper_ingest_job" in stale:
        await _run_paper_ingest_job()
    if "paper_allocation_job" in stale:
        await _run_paper_allocation_job()
    if "research_job" in stale:
        await _run_research_job()
    if "paper_update_job" in stale:
        await _run_paper_update_job()
    if "paper_decay_job" in stale:
        await _run_paper_decay_job()


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


async def _run_execution_job() -> None:
    await _run_with_instrumentation("execution_job", _execution_coro())


async def _run_sync_positions_job() -> None:
    await _run_with_instrumentation("sync_positions_job", _sync_positions_coro())


async def _run_audit_job() -> None:
    await _run_with_instrumentation("audit_job", _audit_coro())


async def _run_drift_job() -> None:
    await _run_with_instrumentation("drift_job", _drift_coro())


async def _run_paper_ingest_job() -> None:
    await _run_with_instrumentation("paper_ingest_job", _paper_ingest_coro())


async def _run_paper_allocation_job() -> None:
    await _run_with_instrumentation("paper_allocation_job", _paper_allocation_coro())


async def _run_paper_update_job() -> None:
    await _run_with_instrumentation("paper_update_job", _paper_update_coro())


async def _run_paper_decay_job() -> None:
    await _run_with_instrumentation("paper_decay_job", _paper_decay_coro())


async def _run_watchdog_job() -> None:
    await _run_with_instrumentation("watchdog_job", _watchdog_coro())


class AlphaScheduler:
    def __init__(self) -> None:
        self.scheduler = AsyncIOScheduler(timezone="America/Sao_Paulo")
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
        self.scheduler.add_job(
            _run_execution_job,
            trigger=IntervalTrigger(minutes=1),
            id="execution_job",
            name="Execution Engine",
            replace_existing=True,
            max_instances=1,
            coalesce=True,
        )
        self.scheduler.add_job(
            _run_sync_positions_job,
            trigger=IntervalTrigger(minutes=15),
            id="sync_positions_job",
            name="Position Sync",
            replace_existing=True,
            max_instances=1,
            coalesce=True,
        )
        self.scheduler.add_job(
            _run_audit_job,
            trigger=IntervalTrigger(hours=1),
            id="audit_job",
            name="Strategy Auditor",
            replace_existing=True,
            max_instances=1,
            coalesce=True,
        )
        self.scheduler.add_job(
            _run_drift_job,
            trigger=IntervalTrigger(hours=2),
            id="drift_job",
            name="Drift Monitor",
            replace_existing=True,
            max_instances=1,
            coalesce=True,
        )
        self.scheduler.add_job(
            _run_paper_ingest_job,
            trigger=IntervalTrigger(minutes=15),
            id="paper_ingest_job",
            name="Paper Trader Ingest",
            replace_existing=True,
            max_instances=1,
            coalesce=True,
        )
        self.scheduler.add_job(
            _run_paper_allocation_job,
            trigger=IntervalTrigger(minutes=15),
            id="paper_allocation_job",
            name="Paper Allocation Refresh",
            replace_existing=True,
            max_instances=1,
            coalesce=True,
        )
        self.scheduler.add_job(
            _run_paper_update_job,
            trigger=IntervalTrigger(minutes=5),
            id="paper_update_job",
            name="Paper Trader Update",
            replace_existing=True,
            max_instances=1,
            coalesce=True,
        )
        self.scheduler.add_job(
            _run_paper_decay_job,
            trigger=IntervalTrigger(hours=2),
            id="paper_decay_job",
            name="Paper Trader Decay Check",
            replace_existing=True,
            max_instances=1,
            coalesce=True,
        )
        self.scheduler.add_job(
            _run_watchdog_job,
            trigger=IntervalTrigger(minutes=10),
            id="watchdog_job",
            name="Autonomy Watchdog",
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
        Prime the whole autonomous loop at startup so the system has fresh
        state without waiting for the first interval tick.
        """
        logger.info("Running initial pipeline jobs at startup...")
        await _run_ingest_job()
        await _run_features_job()
        await _run_regime_job()
        await _run_label_job()
        await _run_research_job()
        await _run_signal_job()
        await _run_execution_job()
        await _run_sync_positions_job()
        await _run_paper_ingest_job()
        await _run_paper_update_job()
        await _run_paper_decay_job()
        await _run_paper_allocation_job()
        await _run_audit_job()
        await _run_drift_job()
        await _run_watchdog_job()
        logger.info("Initial pipeline jobs complete")
