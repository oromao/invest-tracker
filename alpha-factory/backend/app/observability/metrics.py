from __future__ import annotations

import asyncio
import json
import time
from collections import defaultdict
from typing import Any, Dict, Iterable, Optional

import redis.asyncio as aioredis
from prometheus_client import Counter, Gauge
from sqlalchemy import desc, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.db.models import (
    BacktestRun,
    EvolutionCycle,
    Feature,
    MarketRegime,
    OHLCVBar,
    PaperStrategyAllocation,
    Signal,
    Strategy,
    StrategyMemory,
    StrategyStatusEnum,
    Trade,
)
from app.shared.time import ensure_timezone, now_sao_paulo

# ── Scheduler / system ──────────────────────────────────────────────────────
JOB_RUNS = Counter("alpha_scheduler_job_runs_total_v2", "Scheduler job runs", ["job_id"])
JOB_FAILURES = Counter("alpha_scheduler_job_failures_total_v2", "Scheduler job failures", ["job_id"])
JOB_LAST_SUCCESS_TS = Gauge("alpha_scheduler_job_last_success_timestamp_seconds", "Last successful scheduler job run", ["job_id"])
JOB_LAST_DURATION = Gauge("alpha_scheduler_job_last_duration_seconds_v2", "Last scheduler job duration", ["job_id"])
JOB_STALE = Gauge("alpha_scheduler_job_stale", "Scheduler job stale state", ["job_id"])

SYSTEM_READY = Gauge("alpha_system_ready", "System readiness gate (1 ready / 0 not ready)")
READINESS_FLAG = Gauge("alpha_readiness_flag", "Readiness checks as 1/0 flags", ["flag"])
STALE_COMPONENT = Gauge("alpha_stale_component", "Stale component flags", ["component"])

# ── Market / data freshness ────────────────────────────────────────────────
MARKET_LAST_UPDATE_TS = Gauge("alpha_market_last_update_timestamp_seconds", "Last market update timestamp", ["asset", "timeframe"])
MARKET_INGESTED_BARS = Counter("alpha_market_ingested_bars_total", "Market bars ingested", ["asset", "timeframe"])
MARKET_STALE = Gauge("alpha_market_stale", "Market freshness stale flag", ["asset", "timeframe"])

FEATURE_LAST_UPDATE_TS = Gauge("alpha_feature_last_update_timestamp_seconds", "Last feature update timestamp", ["asset", "timeframe"])
FEATURE_ROWS = Counter("alpha_feature_rows_total_v2", "Feature rows upserted", ["asset", "timeframe"])
FEATURE_STALE = Gauge("alpha_feature_stale", "Feature freshness stale flag", ["asset", "timeframe"])

SIGNAL_LAST_TS = Gauge("alpha_signal_last_timestamp_seconds", "Last signal timestamp", ["asset", "timeframe"])
SIGNALS_GENERATED = Counter("alpha_signals_generated_total_v2", "Signals generated", ["asset", "timeframe", "direction"])
SIGNALS_PER_CYCLE = Gauge("alpha_signals_per_cycle", "Signals generated in most recent cycle", ["timeframe"])
SIGNAL_STALE = Gauge("alpha_signal_stale", "Signal freshness stale flag", ["asset", "timeframe"])

# ── Research / governance ───────────────────────────────────────────────────
RESEARCH_CYCLES = Counter("alpha_research_cycles_total_v2", "Research cycles executed", ["asset", "timeframe"])
RESEARCH_CANDIDATES = Counter("alpha_research_candidates_total", "Candidate variants generated", ["asset", "timeframe"])
PROMOTION_ATTEMPTS = Counter("alpha_promotion_attempts_total", "Promotion attempts", ["asset", "timeframe"])
PROMOTION_SUCCESSES = Counter("alpha_promotion_success_total", "Successful promotions", ["asset", "timeframe"])
PROMOTION_BLOCKERS = Counter("alpha_promotion_blockers_total", "Promotion blockers", ["asset", "timeframe", "blocker"])
LEADER_CHANGES = Counter("alpha_leader_changes_total", "Leader changes", ["asset", "timeframe"])
BACKTEST_RUNS = Counter("alpha_backtest_runs_total_v2", "Backtest runs persisted", ["asset", "timeframe"])

STRATEGY_LIFECYCLE = Gauge("alpha_strategy_lifecycle_count", "Strategy lifecycle counts", ["status"])
STRATEGY_LEADER = Gauge("alpha_strategy_leader", "Current leader score", ["asset", "timeframe", "metric"])

# ── Paper portfolio / risk ──────────────────────────────────────────────────
PAPER_TOTAL_PNL = Gauge("alpha_paper_total_pnl", "Paper trading total PnL")
PAPER_TOTAL_TRADES = Gauge("alpha_paper_total_trades", "Paper trading total trades")
PAPER_WIN_RATE = Gauge("alpha_paper_win_rate", "Paper trading win rate")
PAPER_MAX_DRAWDOWN = Gauge("alpha_paper_max_drawdown", "Paper trading max drawdown")
PAPER_STRATEGY_PNL = Gauge("alpha_paper_strategy_pnl", "Paper PnL by strategy", ["strategy_id"])
PAPER_STRATEGY_DRAWDOWN = Gauge("alpha_paper_strategy_drawdown", "Paper drawdown by strategy", ["strategy_id"])
PAPER_STRATEGY_TRADES = Gauge("alpha_paper_strategy_trades", "Paper trades by strategy", ["strategy_id"])
PAPER_STRATEGY_WIN_RATE = Gauge("alpha_paper_strategy_win_rate", "Paper win rate by strategy", ["strategy_id"])
PAPER_STRATEGY_ALLOCATION = Gauge(
    "alpha_paper_strategy_allocation_weight",
    "Paper allocation by strategy",
    ["strategy_id", "asset", "timeframe", "lifecycle_state"],
)
PAPER_STRATEGY_BACKTEST_DELTA = Gauge(
    "alpha_paper_strategy_backtest_delta",
    "Paper versus backtest performance delta by strategy",
    ["strategy_id"],
)
PAPER_STRATEGY_BACKTEST_WIN_RATE = Gauge(
    "alpha_paper_strategy_backtest_win_rate",
    "Backtest win rate by strategy for comparison",
    ["strategy_id"],
)

RISK_TOTAL_EXPOSURE = Gauge("alpha_risk_total_exposure", "Total paper exposure as fraction of capital")
RISK_ASSET_EXPOSURE = Gauge("alpha_risk_asset_exposure", "Exposure by asset", ["asset"])
RISK_DAILY_LOSS = Gauge("alpha_risk_daily_loss", "Daily loss fraction")
RISK_KILL_SWITCH = Gauge("alpha_risk_kill_switch", "Risk kill switch state", ["state"])

EXECUTION_ATTEMPTS = Counter("alpha_execution_attempts_total", "Execution attempts", ["stage", "result"])
EXECUTION_ERRORS = Counter("alpha_execution_errors_total_v2", "Execution errors", ["stage"])
EXECUTION_SLIPPAGE_BPS = Gauge("alpha_execution_slippage_bps", "Estimated execution slippage in basis points")

# ── Freshness / readiness ───────────────────────────────────────────────────
DATA_FRESHNESS_SECONDS = Gauge("alpha_data_freshness_seconds_v2", "Freshness by data kind", ["kind", "asset", "timeframe"])


def _ts(value: Optional[Any]) -> Optional[float]:
    if value is None:
        return None
    if hasattr(value, "timestamp"):
        try:
            return float(ensure_timezone(value).timestamp())
        except Exception:
            return None
    try:
        return float(value)
    except Exception:
        return None


def _set_gauge(gauge: Gauge, labels: dict[str, str], value: Optional[float]) -> None:
    if value is None:
        return
    gauge.labels(**labels).set(float(value))


def record_job_run(job_id: str, duration: float, ok: bool) -> None:
    JOB_RUNS.labels(job_id=job_id).inc()
    JOB_LAST_DURATION.labels(job_id=job_id).set(duration)
    JOB_LAST_SUCCESS_TS.labels(job_id=job_id).set(time.time())
    JOB_STALE.labels(job_id=job_id).set(0.0 if ok else 1.0)


def record_job_failure(job_id: str) -> None:
    JOB_FAILURES.labels(job_id=job_id).inc()
    JOB_STALE.labels(job_id=job_id).set(1.0)


def record_market_update(asset: str, timeframe: str, timestamp: Any, bars: int = 0) -> None:
    if bars:
        MARKET_INGESTED_BARS.labels(asset=asset, timeframe=timeframe).inc(bars)
    _set_gauge(MARKET_LAST_UPDATE_TS, {"asset": asset, "timeframe": timeframe}, _ts(timestamp))


def record_feature_update(asset: str, timeframe: str, timestamp: Any, rows: int = 0) -> None:
    if rows:
        FEATURE_ROWS.labels(asset=asset, timeframe=timeframe).inc(rows)
    _set_gauge(FEATURE_LAST_UPDATE_TS, {"asset": asset, "timeframe": timeframe}, _ts(timestamp))


def record_signal_generation(asset: str, timeframe: str, direction: str, timestamp: Any) -> None:
    SIGNALS_GENERATED.labels(asset=asset, timeframe=timeframe, direction=direction).inc()
    _set_gauge(SIGNAL_LAST_TS, {"asset": asset, "timeframe": timeframe}, _ts(timestamp))


def record_signal_cycle(timeframe: str, signals: Iterable[Any]) -> None:
    total = 0
    for signal in signals:
        total += 1
    SIGNALS_PER_CYCLE.labels(timeframe=timeframe).set(total)


def record_backtest_run(asset: str, timeframe: str) -> None:
    BACKTEST_RUNS.labels(asset=asset, timeframe=timeframe).inc()


def record_research_cycle(result: Dict[str, Any]) -> None:
    asset = result.get("asset")
    timeframe = result.get("timeframe")
    if not asset or not timeframe:
        return
    RESEARCH_CYCLES.labels(asset=asset, timeframe=timeframe).inc()
    RESEARCH_CANDIDATES.labels(asset=asset, timeframe=timeframe).inc(len(result.get("results") or []))
    PROMOTION_ATTEMPTS.labels(asset=asset, timeframe=timeframe).inc()
    if result.get("auto_promoted_strategy_id"):
        PROMOTION_SUCCESSES.labels(asset=asset, timeframe=timeframe).inc()
    if result.get("leader_changed"):
        LEADER_CHANGES.labels(asset=asset, timeframe=timeframe).inc()
    diagnostics = result.get("promotion_diagnostics") or {}
    blockers = diagnostics.get("blockers") or []
    for blocker in blockers:
        reason = str(blocker.get("reason") if isinstance(blocker, dict) else blocker).lower()
        if "drawdown" in reason:
            key = "drawdown"
        elif "risk" in reason:
            key = "risk"
        elif "data" in reason or "fresh" in reason or "stale" in reason:
            key = "data"
        else:
            key = "other"
        PROMOTION_BLOCKERS.labels(asset=asset, timeframe=timeframe, blocker=key).inc()


async def sync_snapshot(session: AsyncSession, *, redis_url: str, scheduler_running: bool) -> None:
    """Refresh gauges from real DB / Redis state for Grafana."""
    now = now_sao_paulo()
    redis_client = aioredis.from_url(redis_url, decode_responses=True)
    try:
        # Strategy lifecycle snapshot
        lifecycle_counts: dict[str, int] = defaultdict(int)
        strategies = (await session.execute(select(Strategy))).scalars().all()
        from app.research.memory import StrategyMemoryStore
        memory = StrategyMemoryStore()
        for strat in strategies:
            latest = await memory.latest_state(session, strat.strategy_id)
            status = latest.lifecycle_state if latest and latest.lifecycle_state else (strat.status.value if hasattr(strat.status, "value") else str(strat.status))
            if status == "retired":
                lifecycle_counts["retired"] += 1
            elif status == "candidate":
                lifecycle_counts["candidate"] += 1
            elif status == "deprecated":
                lifecycle_counts["deprecated"] += 1
            elif status in {"paper", "live_limited", "live", "micro_live"}:
                lifecycle_counts["active"] += 1
            else:
                lifecycle_counts[status] += 1
        for key in ("active", "candidate", "deprecated", "retired", "draft", "validated", "degraded"):
            STRATEGY_LIFECYCLE.labels(status=key).set(lifecycle_counts.get(key, 0))

        latest_cycle_stmt = (
            select(EvolutionCycle)
            .order_by(desc(EvolutionCycle.cycle_at), desc(EvolutionCycle.id))
            .limit(1)
        )
        latest_cycle = (await session.execute(latest_cycle_stmt)).scalars().first()
        if latest_cycle:
            if latest_cycle.current_active_strategy_id:
                STRATEGY_LEADER.labels(
                    asset=latest_cycle.asset,
                    timeframe=latest_cycle.timeframe,
                    metric="leader_score",
                ).set(float(latest_cycle.baseline_active_score or 0.0))
            if latest_cycle.top_candidate_strategy_id:
                STRATEGY_LEADER.labels(
                    asset=latest_cycle.asset,
                    timeframe=latest_cycle.timeframe,
                    metric="candidate_score",
                ).set(float(latest_cycle.top_candidate_score or 0.0))
            if latest_cycle.baseline_active_score is not None and latest_cycle.top_candidate_score is not None:
                STRATEGY_LEADER.labels(
                    asset=latest_cycle.asset,
                    timeframe=latest_cycle.timeframe,
                    metric="candidate_gap",
                ).set(float(latest_cycle.top_candidate_score - latest_cycle.baseline_active_score))

        # Freshness
        latest_market_ts: dict[tuple[str, str], Any] = {}
        latest_signal_ts: dict[tuple[str, str], Any] = {}
        latest_research_ts: dict[tuple[str, str], Any] = {}
        latest_feature_ts: dict[tuple[str, str], Any] = {}
        for asset in settings.assets:
            for timeframe in settings.timeframes:
                ohlcv_stmt = (
                    select(OHLCVBar.timestamp)
                    .where(OHLCVBar.asset == asset, OHLCVBar.timeframe == timeframe)
                    .order_by(desc(OHLCVBar.timestamp))
                    .limit(1)
                )
                ohlcv_ts = (await session.execute(ohlcv_stmt)).scalar_one_or_none()
                if ohlcv_ts:
                    latest_market_ts[(asset, timeframe)] = ohlcv_ts
                    _set_gauge(DATA_FRESHNESS_SECONDS, {"kind": "market", "asset": asset, "timeframe": timeframe}, (now - ensure_timezone(ohlcv_ts)).total_seconds())
                signal_stmt = (
                    select(Signal.timestamp)
                    .where(Signal.asset == asset, Signal.timeframe == timeframe)
                    .order_by(desc(Signal.timestamp))
                    .limit(1)
                )
                signal_ts = (await session.execute(signal_stmt)).scalar_one_or_none()
                if signal_ts:
                    latest_signal_ts[(asset, timeframe)] = signal_ts
                    _set_gauge(DATA_FRESHNESS_SECONDS, {"kind": "signal", "asset": asset, "timeframe": timeframe}, (now - ensure_timezone(signal_ts)).total_seconds())
                cycle_stmt = (
                    select(EvolutionCycle.cycle_at)
                    .where(EvolutionCycle.asset == asset, EvolutionCycle.timeframe == timeframe)
                    .order_by(desc(EvolutionCycle.cycle_at))
                    .limit(1)
                )
                cycle_ts = (await session.execute(cycle_stmt)).scalar_one_or_none()
                if cycle_ts:
                    latest_research_ts[(asset, timeframe)] = cycle_ts
                    _set_gauge(DATA_FRESHNESS_SECONDS, {"kind": "research", "asset": asset, "timeframe": timeframe}, (now - ensure_timezone(cycle_ts)).total_seconds())

                feature_stmt = (
                    select(Feature.timestamp)
                    .where(Feature.asset == asset, Feature.timeframe == timeframe)
                    .order_by(desc(Feature.timestamp))
                    .limit(1)
                )
                feature_ts = (await session.execute(feature_stmt)).scalar_one_or_none()
                if feature_ts:
                    latest_feature_ts[(asset, timeframe)] = feature_ts
                    _set_gauge(FEATURE_LAST_UPDATE_TS, {"asset": asset, "timeframe": timeframe}, ensure_timezone(feature_ts).timestamp())

        # Paper trading snapshot from Redis + persistent allocations
        raw_stats = await redis_client.get("alpha:paper:stats")
        stats = json.loads(raw_stats) if raw_stats else {}
        PAPER_TOTAL_TRADES.set(float(stats.get("total_trades", 0.0) or 0.0))
        PAPER_TOTAL_PNL.set(float(stats.get("total_pnl", 0.0) or 0.0))
        PAPER_WIN_RATE.set(float(stats.get("win_rate", 0.0) or 0.0))
        PAPER_MAX_DRAWDOWN.set(float(stats.get("max_drawdown", 0.0) or 0.0))

        alloc_stmt = (
            select(PaperStrategyAllocation)
            .order_by(desc(PaperStrategyAllocation.updated_at), desc(PaperStrategyAllocation.id))
        )
        rows = (await session.execute(alloc_stmt)).scalars().all()
        latest_allocs: dict[tuple[str, str, str], PaperStrategyAllocation] = {}
        for row in rows:
            key = (row.strategy_id, row.asset, row.timeframe)
            if key not in latest_allocs:
                latest_allocs[key] = row
        for row in latest_allocs.values():
            labels = {
                "strategy_id": row.strategy_id,
                "asset": row.asset,
                "timeframe": row.timeframe,
                "lifecycle_state": row.lifecycle_state or "unknown",
            }
            PAPER_STRATEGY_ALLOCATION.labels(**labels).set(float(row.allocation_weight or 0.0))
            PAPER_STRATEGY_PNL.labels(strategy_id=row.strategy_id).set(float(row.net_pnl or 0.0))
            PAPER_STRATEGY_DRAWDOWN.labels(strategy_id=row.strategy_id).set(float(row.max_drawdown or 0.0))
            PAPER_STRATEGY_TRADES.labels(strategy_id=row.strategy_id).set(float(row.trade_count or 0))
            if row.win_rate is not None:
                PAPER_STRATEGY_WIN_RATE.labels(strategy_id=row.strategy_id).set(float(row.win_rate))
            if row.paper_backtest_delta is not None:
                PAPER_STRATEGY_BACKTEST_DELTA.labels(strategy_id=row.strategy_id).set(float(row.paper_backtest_delta))
            if row.backtest_win_rate is not None:
                PAPER_STRATEGY_BACKTEST_WIN_RATE.labels(strategy_id=row.strategy_id).set(float(row.backtest_win_rate))

        # Risk snapshot from Redis positions
        raw_positions = await redis_client.get("alpha:paper:positions")
        positions = json.loads(raw_positions) if raw_positions else []
        capital = float(stats.get("capital", settings.paper_trading_initial_capital) or settings.paper_trading_initial_capital)
        total_exposure = 0.0
        exposure_by_asset: dict[str, float] = defaultdict(float)
        daily_loss = min(float(stats.get("total_pnl", 0.0) or 0.0), 0.0) / max(capital, 1.0)
        for pos in positions:
            if pos.get("status") != "open":
                continue
            size = float(pos.get("size", 0.0) or 0.0)
            entry = float(pos.get("entry_price", 0.0) or 0.0)
            notional = size * entry
            total_exposure += notional
            exposure_by_asset[str(pos.get("asset") or "unknown")] += notional
        RISK_TOTAL_EXPOSURE.set(total_exposure / max(capital, 1.0))
        for asset, exposure in exposure_by_asset.items():
            RISK_ASSET_EXPOSURE.labels(asset=asset).set(exposure / max(capital, 1.0))
        RISK_DAILY_LOSS.set(abs(daily_loss))
        RISK_KILL_SWITCH.labels(state="enabled" if stats.get("instability") else "disabled").set(1.0 if stats.get("instability") else 0.0)

        # Readiness checks
        market_stale = 0
        signal_stale = 0
        research_stale = 0
        market_timeframes = settings.timeframes[:2]
        signal_timeframes = [tf for tf in ("1h", "4h") if tf in settings.timeframes]
        research_timeframes = [tf for tf in ("1h", "4h") if tf in settings.timeframes]
        for asset in settings.assets[:2]:
            for timeframe in market_timeframes:
                market_age = (now - ensure_timezone(latest_market_ts[(asset, timeframe)])).total_seconds() if (asset, timeframe) in latest_market_ts else float("inf")
                MARKET_STALE.labels(asset=asset, timeframe=timeframe).set(1.0 if market_age > 7200 else 0.0)
                FEATURE_STALE.labels(asset=asset, timeframe=timeframe).set(1.0 if (asset, timeframe) not in latest_feature_ts else 0.0)
                market_stale += int(market_age > 7200)
        for asset in settings.assets[:2]:
            for timeframe in signal_timeframes:
                signal_age = (now - ensure_timezone(latest_signal_ts[(asset, timeframe)])).total_seconds() if (asset, timeframe) in latest_signal_ts else float("inf")
                SIGNAL_STALE.labels(asset=asset, timeframe=timeframe).set(1.0 if signal_age > 7200 else 0.0)
                signal_stale += int(signal_age > 7200)
        for asset in settings.assets[:2]:
            for timeframe in research_timeframes:
                research_age = (now - ensure_timezone(latest_research_ts[(asset, timeframe)])).total_seconds() if (asset, timeframe) in latest_research_ts else float("inf")
                research_stale += int(research_age > 6 * 3600)
        READINESS_FLAG.labels(flag="scheduler_running").set(1.0 if scheduler_running else 0.0)
        READINESS_FLAG.labels(flag="market_fresh").set(1.0 if market_stale == 0 else 0.0)
        READINESS_FLAG.labels(flag="signals_fresh").set(1.0 if signal_stale == 0 else 0.0)
        READINESS_FLAG.labels(flag="research_active").set(1.0 if research_stale == 0 else 0.0)
        READINESS_FLAG.labels(flag="allocation_working").set(1.0 if len(latest_allocs) > 0 else 0.0)
        READINESS_FLAG.labels(flag="dry_run_disabled").set(0.0 if settings.dry_run else 1.0)
        system_ready = scheduler_running and market_stale == 0 and signal_stale == 0 and len(latest_allocs) > 0
        SYSTEM_READY.set(1.0 if system_ready else 0.0)
        STALE_COMPONENT.labels(component="market").set(float(market_stale > 0))
        STALE_COMPONENT.labels(component="signal").set(float(signal_stale > 0))
        STALE_COMPONENT.labels(component="research").set(float(research_stale > 0))
        STALE_COMPONENT.labels(component="allocation").set(0.0 if latest_allocs else 1.0)
    finally:
        await redis_client.aclose()
