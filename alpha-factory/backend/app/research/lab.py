from __future__ import annotations

import json
import logging
from typing import Any, Dict, List, Optional, Tuple

import numpy as np
import pandas as pd
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.backtest.runner import BacktestMetrics, BacktestRunner
from app.config import settings
from app.db.models import BacktestRun, OHLCVBar, Strategy, StrategyStatusEnum
from app.db.session import AsyncSessionLocal
from app.shared.time import ensure_timezone, now_sao_paulo
from app.registry.strategies import StrategyRegistry
from app.research.memory import StrategyMemoryStore, mutate_variant, score_backtest_metrics, strategy_signature

logger = logging.getLogger(__name__)


def _json_safe(obj: Any) -> Any:
    """Recursively convert non-JSON-serializable objects (Timestamps, ndarrays, etc.)."""
    if isinstance(obj, list):
        return [_json_safe(v) for v in obj]
    if isinstance(obj, dict):
        return {k: _json_safe(v) for k, v in obj.items()}
    if hasattr(obj, "isoformat"):  # datetime / Timestamp
        return obj.isoformat()
    if hasattr(obj, "item"):  # numpy scalar
        return obj.item()
    return obj


registry = StrategyRegistry()
memory_store = StrategyMemoryStore()
backtest_runner = BacktestRunner(
    fee_pct=settings.backtest_fee_pct,
    slippage_pct=settings.backtest_slippage_pct,
)

STRATEGY_VARIANTS = [
    {
        "name": "rsi_trend",
        "type": "rsi",
        "rsi_buy": 30,
        "rsi_sell": 70,
        "regime": ["trend_bull"],
        "tp_pct": 0.02,
        "sl_pct": 0.01,
    },
    {
        "name": "rsi_trend_strict",
        "type": "rsi",
        "rsi_buy": 25,
        "rsi_sell": 75,
        "regime": ["trend_bull"],
        "tp_pct": 0.025,
        "sl_pct": 0.01,
    },
    {
        "name": "rsi_mean_revert",
        "type": "rsi",
        "rsi_buy": 35,
        "rsi_sell": 65,
        "regime": ["range"],
        "tp_pct": 0.015,
        "sl_pct": 0.01,
    },
    {
        "name": "macd_cross",
        "type": "macd",
        "regime": ["trend_bull", "trend_bear"],
        "tp_pct": 0.03,
        "sl_pct": 0.015,
    },
    {
        "name": "macd_cross_tight",
        "type": "macd",
        "regime": ["trend_bull"],
        "tp_pct": 0.02,
        "sl_pct": 0.01,
    },
    {
        "name": "vwap_revert",
        "type": "vwap",
        "vwap_threshold": 0.005,
        "regime": ["range"],
        "tp_pct": 0.015,
        "sl_pct": 0.008,
    },
    {
        "name": "vol_breakout",
        "type": "vol_breakout",
        "vol_zscore_threshold": 2.0,
        "regime": ["high_vol"],
        "tp_pct": 0.04,
        "sl_pct": 0.02,
    },
    {
        "name": "ma_cross",
        "type": "ma_cross",
        "regime": ["trend_bull", "trend_bear"],
        "tp_pct": 0.03,
        "sl_pct": 0.015,
    },
    {
        "name": "funding_momentum",
        "type": "funding",
        "funding_threshold": 0.0001,
        "regime": ["trend_bull", "trend_bear"],
        "tp_pct": 0.025,
        "sl_pct": 0.012,
    },
    {
        "name": "low_vol_accumulate",
        "type": "rsi",
        "rsi_buy": 40,
        "rsi_sell": 60,
        "regime": ["low_vol"],
        "tp_pct": 0.01,
        "sl_pct": 0.008,
    },
]


def _generate_signals(
    ohlcv_df: pd.DataFrame,
    features_df: pd.DataFrame,
    variant: Dict,
    current_regime: Optional[str],
) -> pd.Series:
    """Generate 1=LONG / -1=SHORT / 0=no-trade signals from strategy variant."""
    allowed_regimes = variant.get("regime", [])
    if current_regime and allowed_regimes and current_regime not in allowed_regimes:
        return pd.Series(0, index=ohlcv_df.index)

    close = ohlcv_df["close"]
    signals = pd.Series(0, index=close.index, dtype=int)
    strategy_type = variant.get("type", "rsi")

    if strategy_type == "rsi" and "rsi_14" in features_df.columns:
        rsi = features_df["rsi_14"].reindex(close.index).ffill()
        rsi_buy = variant.get("rsi_buy", 30)
        rsi_sell = variant.get("rsi_sell", 70)
        signals[rsi < rsi_buy] = 1
        signals[rsi > rsi_sell] = -1

    elif strategy_type == "macd" and "macd_hist" in features_df.columns:
        macd = features_df["macd_hist"].reindex(close.index).ffill()
        prev_macd = macd.shift(1)
        signals[(macd > 0) & (prev_macd <= 0)] = 1
        signals[(macd < 0) & (prev_macd >= 0)] = -1

    elif strategy_type == "vwap" and "vwap" in features_df.columns:
        vwap = features_df["vwap"].reindex(close.index).ffill()
        threshold = variant.get("vwap_threshold", 0.005)
        dist = (close - vwap) / vwap.replace(0, np.nan)
        signals[dist < -threshold] = 1
        signals[dist > threshold] = -1

    elif strategy_type == "vol_breakout" and "volume_zscore" in features_df.columns:
        vol_z = features_df["volume_zscore"].reindex(close.index).ffill()
        ret = features_df.get("returns_1", close.pct_change()).reindex(close.index).ffill()
        threshold = variant.get("vol_zscore_threshold", 2.0)
        signals[(vol_z > threshold) & (ret > 0)] = 1
        signals[(vol_z > threshold) & (ret < 0)] = -1

    elif strategy_type == "ma_cross" and "ma_dist_20" in features_df.columns:
        ma_dist = features_df["ma_dist_20"].reindex(close.index).ffill()
        prev_ma_dist = ma_dist.shift(1)
        signals[(ma_dist > 0) & (prev_ma_dist <= 0)] = 1
        signals[(ma_dist < 0) & (prev_ma_dist >= 0)] = -1

    elif strategy_type == "funding" and "funding_delta" in features_df.columns:
        fd = features_df["funding_delta"].reindex(close.index).ffill()
        threshold = variant.get("funding_threshold", 0.0001)
        signals[fd > threshold] = 1
        signals[fd < -threshold] = -1

    return signals


def _legacy_status_for_lifecycle(lifecycle_state: str) -> StrategyStatusEnum:
    if lifecycle_state in {"validated"}:
        return StrategyStatusEnum.candidate
    if lifecycle_state in {"paper", "micro_live", "live_limited"}:
        return StrategyStatusEnum.active
    if lifecycle_state in {"degraded", "retired"}:
        return StrategyStatusEnum.deprecated
    if lifecycle_state in {"draft"}:
        return StrategyStatusEnum.draft
    return StrategyStatusEnum.candidate


def _lifecycle_transition(previous_state: Optional[str], score: float, baseline_score: float, metrics: BacktestMetrics) -> tuple[str, str]:
    if metrics.total_trades <= 0:
        return "draft", "no trades generated"
    if metrics.is_overfit or score <= 0:
        return "rejected", "overfit or non-positive score"
    if score >= max(0.8, baseline_score * 1.25) and metrics.total_trades >= settings.min_trades_for_promotion:
        if previous_state in {"paper", "micro_live"}:
            return "live_limited", "sustained outperformance"
        if previous_state == "validated":
            return "paper", "validated twice with good robustness"
        return "validated", "outperformed baseline with robust metrics"
    if score >= max(0.5, baseline_score * 1.05):
        return "candidate", "meets minimum improvement threshold"
    if score > 0:
        return "candidate", "useful but not strong enough to graduate"
    return "degraded", "weak backtest score"


def _is_strong_enough_for_paper(metrics: BacktestMetrics, baseline_score: float, score: float) -> bool:
    return (
        score >= max(1.0, baseline_score * 1.35)
        and metrics.total_trades >= settings.min_trades_for_promotion
        and not metrics.is_overfit
        and metrics.profit_factor >= 1.2
        and metrics.max_drawdown <= 0.25
    )


class ResearchLab:
    async def _load_ohlcv(
        self,
        session: AsyncSession,
        asset: str,
        timeframe: str,
        limit: int = 1000,
    ) -> pd.DataFrame:
        stmt = (
            select(OHLCVBar)
            .where(OHLCVBar.asset == asset, OHLCVBar.timeframe == timeframe)
            .order_by(OHLCVBar.timestamp.desc())
            .limit(limit)
        )
        result = await session.execute(stmt)
        rows = result.scalars().all()

        if not rows:
            return pd.DataFrame()

        data = [
            {
                "timestamp": r.timestamp,
                "open": r.open,
                "high": r.high,
                "low": r.low,
                "close": r.close,
                "volume": r.volume,
            }
            for r in rows
        ]
        df = pd.DataFrame(data).sort_values("timestamp").set_index("timestamp")
        return df

    async def _load_features_df(
        self,
        session: AsyncSession,
        asset: str,
        timeframe: str,
        limit: int = 1000,
    ) -> pd.DataFrame:
        from sqlalchemy import text

        stmt = text(
            """
            SELECT timestamp, feature_name, value
            FROM features
            WHERE asset = :asset AND timeframe = :timeframe
              AND timestamp IN (
                  SELECT DISTINCT timestamp FROM features
                  WHERE asset = :asset AND timeframe = :timeframe
                  ORDER BY timestamp DESC
                  LIMIT :n
              )
            ORDER BY timestamp ASC
            """
        )
        result = await session.execute(
            stmt, {"asset": asset, "timeframe": timeframe, "n": limit}
        )
        rows = result.fetchall()
        if not rows:
            return pd.DataFrame()

        df = pd.DataFrame(rows, columns=["timestamp", "feature_name", "value"])
        pivot = df.pivot_table(index="timestamp", columns="feature_name", values="value")
        pivot.index = pd.DatetimeIndex(pivot.index)
        return pivot

    async def _get_current_regime(
        self, session: AsyncSession, asset: str, timeframe: str
    ) -> Optional[str]:
        from sqlalchemy import text

        stmt = text(
            """
            SELECT regime FROM market_regimes
            WHERE asset = :asset AND timeframe = :timeframe
            ORDER BY timestamp DESC
            LIMIT 1
            """
        )
        result = await session.execute(stmt, {"asset": asset, "timeframe": timeframe})
        row = result.fetchone()
        return row[0] if row else None

    async def _store_backtest_run(
        self,
        session: AsyncSession,
        strategy: Strategy,
        asset: str,
        timeframe: str,
        metrics: BacktestMetrics,
        params: Dict,
        ohlcv_df: pd.DataFrame,
    ) -> BacktestRun:
        start_date = ohlcv_df.index[0].to_pydatetime() if not ohlcv_df.empty else None
        end_date = ohlcv_df.index[-1].to_pydatetime() if not ohlcv_df.empty else None

        if start_date:
            start_date = ensure_timezone(start_date)
        if end_date:
            end_date = ensure_timezone(end_date)

        # Store regime breakdown alongside regular params
        params_with_meta = dict(params)
        params_with_meta["_regime_breakdown"] = metrics.regime_breakdown
        params_with_meta["_oos_sharpe"] = metrics.oos_sharpe
        params_with_meta["_oos_profit_factor"] = metrics.oos_profit_factor
        params_with_meta["_is_overfit"] = metrics.is_overfit

        run = BacktestRun(
            strategy_id=strategy.id,
            asset=asset,
            timeframe=timeframe,
            start_date=start_date,
            end_date=end_date,
            params_json=json.dumps(_json_safe(params_with_meta)),
            sharpe=metrics.sharpe,
            profit_factor=metrics.profit_factor,
            expectancy=metrics.expectancy,
            max_drawdown=metrics.max_drawdown,
            win_rate=metrics.win_rate,
            avg_rr=metrics.avg_rr,
            total_trades=metrics.total_trades,
            equity_curve_json=json.dumps(_json_safe(metrics.equity_curve[-500:])),
            trades_json=json.dumps(_json_safe(metrics.trades[-200:])),
        )
        session.add(run)
        await session.flush()
        return run

    async def _load_baseline_score(self, session: AsyncSession, asset: str, timeframe: str) -> float:
        leaderboard = await memory_store.leaderboard(session, asset=asset, timeframe=timeframe, limit=1)
        if leaderboard and leaderboard[0].score is not None:
            return float(leaderboard[0].score)
        return 0.0

    async def _build_candidate_pool(
        self,
        session: AsyncSession,
        asset: str,
        timeframe: str,
    ) -> List[Dict]:
        pool: List[Dict] = [dict(v) for v in STRATEGY_VARIANTS]
        winners = await memory_store.load_winners(session, asset=asset, timeframe=timeframe, limit=5)
        seen_signatures = {strategy_signature(v) for v in pool}
        failed = await memory_store.recent_failed_signatures(session, asset=asset, timeframe=timeframe, limit=40)

        for winner in winners[:3]:
            base = dict(winner.get("params") or {})
            if not base:
                continue
            mutated = mutate_variant(base, seed_score=float(winner.get("score", 0.0) or 0.0))
            mutated.setdefault("regime", base.get("regime", []))
            sig = strategy_signature(mutated)
            if sig in seen_signatures or sig in failed:
                continue
            seen_signatures.add(sig)
            pool.append(mutated)

        pool.sort(key=lambda v: (v.get("type", ""), v.get("name", "")))
        return pool[:12]

    async def _record_memory(
        self,
        session: AsyncSession,
        *,
        strategy: Strategy,
        asset: str,
        timeframe: str,
        event_type: str,
        lifecycle_state: Optional[str],
        metrics: BacktestMetrics,
        params: Dict,
        reason: str,
        score: float,
    ) -> None:
        await memory_store.record_event(
            session,
            strategy=strategy,
            asset=asset,
            timeframe=timeframe,
            event_type=event_type,
            lifecycle_state=lifecycle_state,
            score=score,
            metrics={
                "sharpe": metrics.sharpe,
                "profit_factor": metrics.profit_factor,
                "expectancy": metrics.expectancy,
                "max_drawdown": metrics.max_drawdown,
                "win_rate": metrics.win_rate,
                "total_trades": metrics.total_trades,
                "oos_sharpe": metrics.oos_sharpe,
                "oos_profit_factor": metrics.oos_profit_factor,
                "is_overfit": metrics.is_overfit,
            },
            params=params,
            reason=reason,
        )

    async def run_research_cycle(self, asset: str, timeframe: str) -> Dict:
        results: List[Dict] = []
        min_trades = settings.min_trades_for_promotion
        oos_min_ratio = settings.oos_min_sharpe_ratio

        async with AsyncSessionLocal() as session:
            ohlcv_df = await self._load_ohlcv(session, asset, timeframe)
            if ohlcv_df.empty or len(ohlcv_df) < 100:
                logger.warning("Not enough data for research cycle %s/%s", asset, timeframe)
                return {"asset": asset, "timeframe": timeframe, "error": "insufficient data"}

            features_df = await self._load_features_df(session, asset, timeframe)
            current_regime = await self._get_current_regime(session, asset, timeframe)
            baseline_score = await self._load_baseline_score(session, asset, timeframe)
            variants = await self._build_candidate_pool(session, asset, timeframe)

            for variant in variants:
                try:
                    signals = _generate_signals(ohlcv_df, features_df, variant, current_regime)
                    signal_count = int(signals.abs().sum())
                    if signal_count < 5:
                        strat = await registry.get_or_create_draft(session, variant["name"], variant)
                        await self._record_memory(
                            session,
                            strategy=strat,
                            asset=asset,
                            timeframe=timeframe,
                            event_type="rejected",
                            lifecycle_state="draft",
                            metrics=BacktestMetrics(),
                            params=variant,
                            reason=f"too few signals ({signal_count})",
                            score=0.0,
                        )
                        continue

                    is_metrics, oos_metrics = backtest_runner.run_walk_forward(
                        ohlcv_df,
                        signals,
                        variant,
                        oos_min_sharpe_ratio=oos_min_ratio,
                    )

                    score = score_backtest_metrics(
                        {
                            "sharpe": is_metrics.sharpe,
                            "profit_factor": is_metrics.profit_factor,
                            "expectancy": is_metrics.expectancy,
                            "max_drawdown": is_metrics.max_drawdown,
                            "win_rate": is_metrics.win_rate,
                            "total_trades": is_metrics.total_trades,
                            "oos_sharpe": is_metrics.oos_sharpe,
                            "oos_profit_factor": is_metrics.oos_profit_factor,
                            "is_overfit": is_metrics.is_overfit,
                        }
                    )
                    strat = await registry.get_or_create_draft(session, variant["name"], variant)
                    prev_state = await memory_store.latest_state(session, strat.strategy_id)
                    lifecycle_state, reason = _lifecycle_transition(
                        prev_state.lifecycle_state if prev_state else None,
                        score,
                        baseline_score,
                        is_metrics,
                    )

                    await self._store_backtest_run(
                        session, strat, asset, timeframe, is_metrics, variant, ohlcv_df
                    )
                    await self._record_memory(
                        session,
                        strategy=strat,
                        asset=asset,
                        timeframe=timeframe,
                        event_type="backtest_completed",
                        lifecycle_state=lifecycle_state,
                        metrics=is_metrics,
                        params=variant,
                        reason=reason,
                        score=score,
                    )

                    legacy_status = _legacy_status_for_lifecycle(lifecycle_state)
                    if strat.status != legacy_status:
                        await registry.update_status(session, strat.strategy_id, legacy_status)

                    if _is_strong_enough_for_paper(is_metrics, baseline_score, score):
                        await self._record_memory(
                            session,
                            strategy=strat,
                            asset=asset,
                            timeframe=timeframe,
                            event_type="promoted",
                            lifecycle_state="paper",
                            metrics=is_metrics,
                            params=variant,
                            reason="meets paper-grade robustness gates",
                            score=score,
                        )
                        await registry.update_status(session, strat.strategy_id, StrategyStatusEnum.active)
                        lifecycle_state = "paper"
                        reason = "promoted to paper-grade"

                    results.append(
                        {
                            "name": variant["name"],
                            "strategy_id": strat.strategy_id,
                            "params": variant,
                            "sharpe": is_metrics.sharpe,
                            "profit_factor": is_metrics.profit_factor,
                            "win_rate": is_metrics.win_rate,
                            "total_trades": is_metrics.total_trades,
                            "max_drawdown": is_metrics.max_drawdown,
                            "oos_sharpe": is_metrics.oos_sharpe,
                            "oos_profit_factor": is_metrics.oos_profit_factor,
                            "is_overfit": is_metrics.is_overfit,
                            "regime_breakdown": is_metrics.regime_breakdown,
                            "score": score,
                            "baseline_score": baseline_score,
                            "strategy_db_id": strat.id,
                            "lifecycle_state": lifecycle_state,
                            "reason": reason,
                        }
                    )

                    logger.info(
                        "Variant %s: score=%.3f IS sharpe=%.2f PF=%.2f trades=%d OOS sharpe=%.2f lifecycle=%s",
                        variant["name"],
                        score,
                        is_metrics.sharpe,
                        is_metrics.profit_factor,
                        is_metrics.total_trades,
                        is_metrics.oos_sharpe or 0.0,
                        lifecycle_state,
                    )
                except Exception as exc:
                    logger.error("Error running variant %s: %s", variant["name"], exc)
                    continue

            await session.commit()

            if not results:
                return {
                    "asset": asset,
                    "timeframe": timeframe,
                    "results": [],
                    "baseline_score": baseline_score,
                    "leaderboard": [],
                }

            results.sort(key=lambda x: (x["score"], x["profit_factor"], x["sharpe"]), reverse=True)
            top = results[0]

            if top["score"] > max(0.8, baseline_score * 1.05) and not top["is_overfit"]:
                strat = await registry.get_by_strategy_id(session, top["strategy_id"])
                if strat and top["lifecycle_state"] in {"validated", "paper", "micro_live", "live_limited"}:
                    await registry.update_status(session, top["strategy_id"], StrategyStatusEnum.active)
                elif strat and top["lifecycle_state"] == "candidate":
                    await registry.update_status(session, top["strategy_id"], StrategyStatusEnum.candidate)
                if strat:
                    await self._record_memory(
                        session,
                        strategy=strat,
                        asset=asset,
                        timeframe=timeframe,
                        event_type="promoted",
                        lifecycle_state=top["lifecycle_state"],
                        metrics=BacktestMetrics(
                            sharpe=top["sharpe"],
                            profit_factor=top["profit_factor"],
                            max_drawdown=top["max_drawdown"],
                            win_rate=top["win_rate"],
                            total_trades=top["total_trades"],
                            oos_sharpe=top["oos_sharpe"],
                            oos_profit_factor=top["oos_profit_factor"],
                        ),
                        params=top.get("params", {}),
                        reason=f"top score {top['score']:.3f} vs baseline {baseline_score:.3f}",
                        score=top["score"],
                    )

            leaderboard_rows = await memory_store.leaderboard(session, asset=asset, timeframe=timeframe, limit=5)
            leaderboard = []
            for row in leaderboard_rows:
                leaderboard.append(
                    {
                        "strategy_id": row.strategy_id,
                        "asset": row.asset,
                        "timeframe": row.timeframe,
                        "score": row.score,
                        "sharpe": row.sharpe,
                        "profit_factor": row.profit_factor,
                        "win_rate": row.win_rate,
                        "total_trades": row.total_trades,
                        "lifecycle_state": row.lifecycle_state,
                        "reason": row.reason,
                    }
                )

            return {
                "asset": asset,
                "timeframe": timeframe,
                "results": results,
                "top_strategy": top,
                "leaderboard": leaderboard,
                "baseline_score": baseline_score,
                "regime": current_regime,
            }
