from __future__ import annotations

import asyncio
import logging
from typing import Optional

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.cron import CronTrigger
from apscheduler.triggers.interval import IntervalTrigger

from app.config import settings

logger = logging.getLogger(__name__)


async def _run_ingest_job() -> None:
    """Fetch OHLCV + funding + OI for all assets/timeframes."""
    from app.ingestor.ccxt_ingestor import CCXTIngestor

    ingestor = CCXTIngestor()
    try:
        await ingestor.run_full_ingest()
    finally:
        await ingestor.close()


async def _run_features_job() -> None:
    """Compute features for all assets/timeframes."""
    from app.features.engine import FeatureEngine

    engine = FeatureEngine()
    for asset in settings.assets:
        for tf in settings.timeframes:
            try:
                await engine.run(asset, tf)
            except Exception as exc:
                logger.error("Features error %s/%s: %s", asset, tf, exc)


async def _run_regime_job() -> None:
    """Detect market regime for all assets/timeframes."""
    from app.regime.detector import RegimeDetector

    detector = RegimeDetector()
    # Run regime detection on primary timeframes only
    primary_timeframes = ["1h", "4h"]
    for asset in settings.assets:
        for tf in primary_timeframes:
            try:
                await detector.detect(asset, tf)
            except Exception as exc:
                logger.error("Regime error %s/%s: %s", asset, tf, exc)


async def _run_label_job() -> None:
    """Apply triple barrier labeling for all assets."""
    from app.labeling.triple_barrier import TripleBarrierLabeler

    labeler = TripleBarrierLabeler()
    primary_timeframes = ["1h", "4h"]
    for asset in settings.assets:
        for tf in primary_timeframes:
            try:
                await labeler.run(asset, tf)
            except Exception as exc:
                logger.error("Label error %s/%s: %s", asset, tf, exc)


async def _run_research_job() -> None:
    """Run auto research cycle — generate + backtest + rank + promote strategies."""
    from app.research.lab import ResearchLab

    lab = ResearchLab()
    primary_timeframes = ["1h", "4h"]
    for asset in settings.assets:
        for tf in primary_timeframes:
            try:
                result = await lab.run_research_cycle(asset, tf)
                if result.get("top_strategy"):
                    top = result["top_strategy"]
                    logger.info(
                        "Research cycle %s/%s top: %s (sharpe=%.2f, PF=%.2f)",
                        asset,
                        tf,
                        top.get("name"),
                        top.get("sharpe", 0),
                        top.get("profit_factor", 0),
                    )
            except Exception as exc:
                logger.error("Research error %s/%s: %s", asset, tf, exc)


async def _run_signal_job() -> None:
    """Generate trading signals for all assets."""
    from app.signals.engine import SignalEngine

    engine = SignalEngine()
    for tf in ["1h", "4h"]:
        try:
            signals = await engine.generate_all_signals(timeframe=tf)
            logger.info("Generated %d signals for timeframe %s", len(signals), tf)
        except Exception as exc:
            logger.error("Signal job error for %s: %s", tf, exc)


class AlphaScheduler:
    def __init__(self) -> None:
        self.scheduler = AsyncIOScheduler(timezone="UTC")
        self._setup_jobs()

    def _setup_jobs(self) -> None:
        # Ingest every 5 minutes
        self.scheduler.add_job(
            _run_ingest_job,
            trigger=IntervalTrigger(minutes=5),
            id="ingest_job",
            name="CCXT Ingest",
            replace_existing=True,
            max_instances=1,
            coalesce=True,
        )

        # Features every 15 minutes
        self.scheduler.add_job(
            _run_features_job,
            trigger=IntervalTrigger(minutes=15),
            id="features_job",
            name="Feature Engine",
            replace_existing=True,
            max_instances=1,
            coalesce=True,
        )

        # Regime detection every hour
        self.scheduler.add_job(
            _run_regime_job,
            trigger=IntervalTrigger(hours=1),
            id="regime_job",
            name="Regime Detector",
            replace_existing=True,
            max_instances=1,
            coalesce=True,
        )

        # Label every hour
        self.scheduler.add_job(
            _run_label_job,
            trigger=IntervalTrigger(hours=1),
            id="label_job",
            name="Triple Barrier Labeler",
            replace_existing=True,
            max_instances=1,
            coalesce=True,
        )

        # Research every 6 hours
        self.scheduler.add_job(
            _run_research_job,
            trigger=IntervalTrigger(hours=6),
            id="research_job",
            name="Research Lab",
            replace_existing=True,
            max_instances=1,
            coalesce=True,
        )

        # Signals every 15 minutes
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
        logger.info("Alpha Factory scheduler started with %d jobs", len(self.scheduler.get_jobs()))

    def stop(self) -> None:
        if self.scheduler.running:
            self.scheduler.shutdown(wait=False)
            logger.info("Alpha Factory scheduler stopped")

    def get_jobs_info(self) -> list:
        jobs = []
        for job in self.scheduler.get_jobs():
            jobs.append(
                {
                    "id": job.id,
                    "name": job.name,
                    "next_run": str(job.next_run_time) if job.next_run_time else None,
                }
            )
        return jobs
