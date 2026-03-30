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

    async def run_research_cycle(self, asset: str, timeframe: str) -> Dict:
        results = []
        min_trades = settings.min_trades_for_promotion
        oos_min_ratio = settings.oos_min_sharpe_ratio

        async with AsyncSessionLocal() as session:
            ohlcv_df = await self._load_ohlcv(session, asset, timeframe)
        if ohlcv_df.empty or len(ohlcv_df) < 100:
            logger.warning("Not enough data for research cycle %s/%s", asset, timeframe)
            return {"asset": asset, "timeframe": timeframe, "error": "insufficient data"}

            features_df = await self._load_features_df(session, asset, timeframe)
            current_regime = await self._get_current_regime(session, asset, timeframe)

            for variant in STRATEGY_VARIANTS:
                try:
                    signals = _generate_signals(ohlcv_df, features_df, variant, current_regime)

                    if signals.abs().sum() < 5:
                        logger.debug("Variant %s: too few signals, skipping", variant["name"])
                        continue

                    # Walk-forward: IS backtest + OOS validation
                    is_metrics, oos_metrics = backtest_runner.run_walk_forward(
                        ohlcv_df, signals, variant,
                        oos_min_sharpe_ratio=oos_min_ratio,
                    )

                    # Minimum sample size gate
                    if is_metrics.total_trades < min_trades:
                        logger.debug(
                            "Variant %s: only %d IS trades (need %d), skipping",
                            variant["name"], is_metrics.total_trades, min_trades,
                        )
                        continue

                    # Overfitting penalty: halve the composite score
                    overfit_penalty = 0.5 if is_metrics.is_overfit else 1.0

                    strat = await registry.get_or_create_draft(
                        session, variant["name"], variant
                    )

                    await self._store_backtest_run(
                        session, strat, asset, timeframe, is_metrics, variant, ohlcv_df
                    )

                    raw_score = is_metrics.sharpe * is_metrics.profit_factor
                    score = raw_score * overfit_penalty

                    results.append(
                        {
                            "name": variant["name"],
                            "strategy_id": strat.strategy_id,
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
                            "strategy_db_id": strat.id,
                        }
                    )
                    logger.info(
                        "Variant %s: IS sharpe=%.2f PF=%.2f trades=%d OOS sharpe=%.2f overfit=%s",
                        variant["name"],
                        is_metrics.sharpe,
                        is_metrics.profit_factor,
                        is_metrics.total_trades,
                        is_metrics.oos_sharpe or 0.0,
                        is_metrics.is_overfit,
                    )
                except Exception as exc:
                    logger.error("Error running variant %s: %s", variant["name"], exc)
                    continue

            await session.commit()

        if not results:
            return {"asset": asset, "timeframe": timeframe, "results": []}

        results.sort(key=lambda x: x["score"], reverse=True)
        top = results[0]

        # Promotion logic with hardened thresholds
        async with AsyncSessionLocal() as session:
            min_sharpe = settings.promotion_min_sharpe
            min_pf = settings.promotion_min_pf
            confirmed_runs_needed = settings.promotion_confirmed_runs

            qualifies = (
                top["sharpe"] > min_sharpe
                and top["profit_factor"] > min_pf
                and top["total_trades"] >= min_trades
                and not top["is_overfit"]
            )

            if qualifies:
                strat = await registry.get_by_strategy_id(session, top["strategy_id"])
                if strat and strat.status == StrategyStatusEnum.draft:
                    await registry.update_status(session, top["strategy_id"], StrategyStatusEnum.candidate)
                    logger.info("Promoted %s to candidate", top["strategy_id"])
                elif strat and strat.status == StrategyStatusEnum.candidate:
                    from sqlalchemy import text as sa_text
                    count_stmt = sa_text(
                        """
                        SELECT COUNT(*) FROM backtest_runs
                        WHERE strategy_id = :sid
                          AND sharpe > :min_sharpe
                          AND profit_factor > :min_pf
                        """
                    )
                    cnt_result = await session.execute(
                        count_stmt,
                        {"sid": strat.id, "min_sharpe": min_sharpe, "min_pf": min_pf},
                    )
                    confirmed_count = cnt_result.scalar() or 0
                    if confirmed_count >= confirmed_runs_needed:
                        await registry.promote_to_active(session, top["strategy_id"])
                        logger.info(
                            "Promoted %s to ACTIVE after %d confirmed runs",
                            top["strategy_id"], confirmed_count,
                        )

            await session.commit()

        return {
            "asset": asset,
            "timeframe": timeframe,
            "results": results,
            "top_strategy": top,
            "regime": current_regime,
        }
