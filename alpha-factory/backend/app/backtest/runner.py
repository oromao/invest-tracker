from __future__ import annotations

import logging
from dataclasses import dataclass, field
from typing import Dict, List, Optional, Tuple

import numpy as np
import pandas as pd

logger = logging.getLogger(__name__)


@dataclass
class BacktestMetrics:
    sharpe: float = 0.0
    profit_factor: float = 0.0
    expectancy: float = 0.0
    max_drawdown: float = 0.0
    win_rate: float = 0.0
    avg_rr: float = 0.0
    total_trades: int = 0
    equity_curve: List[float] = field(default_factory=list)
    trades: List[Dict] = field(default_factory=list)
    # Per-regime / per-asset breakdown
    regime_breakdown: Dict[str, Dict] = field(default_factory=dict)
    # OOS validation fields (populated by walk-forward)
    oos_sharpe: Optional[float] = None
    oos_profit_factor: Optional[float] = None
    oos_total_trades: Optional[int] = None
    is_overfit: bool = False


def _compute_metrics_from_trades(
    trades: List[Dict],
    initial_capital: float = 10000.0,
) -> BacktestMetrics:
    """Compute backtest metrics from trade list with 'pnl', 'rr', 'exit_date', 'regime' fields."""
    if not trades:
        return BacktestMetrics()

    pnls = [t.get("pnl", 0.0) for t in trades]
    wins = [p for p in pnls if p > 0]
    losses = [p for p in pnls if p < 0]

    total = len(pnls)
    win_rate = len(wins) / total if total > 0 else 0.0

    gross_profit = sum(wins)
    gross_loss = abs(sum(losses))
    profit_factor = gross_profit / gross_loss if gross_loss > 0 else (float("inf") if gross_profit > 0 else 0.0)

    expectancy = sum(pnls) / total if total > 0 else 0.0

    rrs = [t.get("rr", 0.0) for t in trades if t.get("rr", 0.0) != 0.0]
    avg_rr = sum(rrs) / len(rrs) if rrs else 0.0

    # Equity curve
    equity = [initial_capital]
    for p in pnls:
        equity.append(equity[-1] + p)

    equity_arr = np.array(equity)
    running_max = np.maximum.accumulate(equity_arr)
    drawdowns = (equity_arr - running_max) / running_max
    max_drawdown = float(abs(drawdowns.min()))

    # Annualized Sharpe — date-indexed daily PnL
    sharpe = 0.0
    exit_dates = [t.get("exit_date") for t in trades if t.get("exit_date") is not None]
    if exit_dates:
        min_date = pd.Timestamp(min(exit_dates)).normalize().tz_localize(None)
        max_date = pd.Timestamp(max(exit_dates)).normalize().tz_localize(None)
        date_range = pd.date_range(start=min_date, end=max_date, freq="D")
        daily_returns = pd.Series(0.0, index=date_range)
        for t in trades:
            ed = t.get("exit_date")
            if ed is not None:
                day = pd.Timestamp(ed).normalize().tz_localize(None)
                if day in daily_returns.index:
                    daily_returns[day] += t.get("pnl", 0.0)
        std = daily_returns.std()
        if std > 0:
            sharpe = float((daily_returns.mean() / std) * np.sqrt(252))
    else:
        pnl_arr = np.array(pnls)
        if pnl_arr.std() > 0:
            sharpe = float((pnl_arr.mean() / pnl_arr.std()) * np.sqrt(252))

    # Per-regime breakdown
    regime_breakdown: Dict[str, Dict] = {}
    for t in trades:
        reg = t.get("regime") or "unknown"
        if reg not in regime_breakdown:
            regime_breakdown[reg] = {"trades": 0, "pnl": 0.0, "wins": 0}
        regime_breakdown[reg]["trades"] += 1
        regime_breakdown[reg]["pnl"] += t.get("pnl", 0.0)
        if t.get("pnl", 0.0) > 0:
            regime_breakdown[reg]["wins"] += 1

    for reg, stats in regime_breakdown.items():
        n = stats["trades"]
        stats["win_rate"] = round(stats["wins"] / n, 4) if n > 0 else 0.0
        stats["avg_pnl"] = round(stats["pnl"] / n, 4) if n > 0 else 0.0

    return BacktestMetrics(
        sharpe=round(sharpe, 4),
        profit_factor=round(profit_factor, 4),
        expectancy=round(expectancy, 4),
        max_drawdown=round(max_drawdown, 4),
        win_rate=round(win_rate, 4),
        avg_rr=round(avg_rr, 4),
        total_trades=total,
        equity_curve=equity,
        trades=trades,
        regime_breakdown=regime_breakdown,
    )


def run_backtest_pandas(
    ohlcv_df: pd.DataFrame,
    signals_series: pd.Series,
    params: Dict,
    initial_capital: float = 10000.0,
    fee_pct: float = 0.001,
    slippage_pct: float = 0.0002,
    regime_series: Optional[pd.Series] = None,
) -> BacktestMetrics:
    """
    Pandas-based vectorized backtest with realistic fee/slippage model.

    Parameters
    ----------
    ohlcv_df       : DataFrame with open/high/low/close/volume columns, DatetimeIndex
    signals_series : pd.Series aligned with ohlcv_df; 1=LONG, -1=SHORT, 0=no trade
    params         : dict with optional keys: tp_pct, sl_pct, position_size_pct
    initial_capital: starting capital
    fee_pct        : round-trip fee fraction (e.g. 0.001 = 0.1% per side)
    slippage_pct   : slippage per side (e.g. 0.0002 = 2bps)
    regime_series  : optional pd.Series with regime label per bar (for breakdown)
    """
    tp_pct = float(params.get("tp_pct", 0.02))
    sl_pct = float(params.get("sl_pct", 0.01))
    pos_pct = float(params.get("position_size_pct", 0.1))

    close = ohlcv_df["close"]
    high = ohlcv_df["high"]
    low = ohlcv_df["low"]

    signals = signals_series.reindex(close.index).fillna(0)
    regimes = (
        regime_series.reindex(close.index).ffill()
        if regime_series is not None
        else pd.Series("unknown", index=close.index)
    )

    trades = []
    capital = initial_capital
    in_trade = False
    entry_price = 0.0
    direction = 0
    entry_idx = 0
    entry_regime = "unknown"

    close_arr = close.values
    high_arr = high.values
    low_arr = low.values
    sig_arr = signals.values
    reg_arr = regimes.values

    for i in range(len(close_arr)):
        if not in_trade:
            if sig_arr[i] != 0:
                in_trade = True
                direction = int(sig_arr[i])
                # Apply slippage on entry
                entry_price = close_arr[i] * (1 + direction * slippage_pct)
                entry_idx = i
                entry_regime = str(reg_arr[i]) if reg_arr[i] is not None else "unknown"
        else:
            tp_price = entry_price * (1 + direction * tp_pct)
            sl_price = entry_price * (1 - direction * sl_pct)

            tp_hit = (direction == 1 and high_arr[i] >= tp_price) or (
                direction == -1 and low_arr[i] <= tp_price
            )
            sl_hit = (direction == 1 and low_arr[i] <= sl_price) or (
                direction == -1 and high_arr[i] >= sl_price
            )

            exit_price = None
            outcome = "time"

            if tp_hit:
                exit_price = tp_price
                outcome = "tp"
            elif sl_hit:
                exit_price = sl_price
                outcome = "sl"
            elif sig_arr[i] != 0 and sig_arr[i] != direction:
                exit_price = close_arr[i]
                outcome = "reversal"

            if exit_price is not None:
                # Apply slippage on exit (adverse)
                actual_exit = exit_price * (1 - direction * slippage_pct)
                raw_ret = (actual_exit - entry_price) / entry_price * direction
                trade_size = capital * pos_pct
                # Deduct round-trip fee (entry + exit)
                fee = trade_size * fee_pct * 2
                pnl = trade_size * raw_ret - fee
                rr = (
                    abs(actual_exit - entry_price) / abs(sl_price - entry_price)
                    if abs(sl_price - entry_price) > 1e-9
                    else 0.0
                )
                if pnl < 0:
                    rr = -rr

                capital += pnl
                exit_ts = close.index[i] if hasattr(close.index[i], "date") else None
                trades.append(
                    {
                        "entry_idx": entry_idx,
                        "exit_idx": i,
                        "direction": direction,
                        "entry_price": float(entry_price),
                        "exit_price": float(actual_exit),
                        "pnl": float(pnl),
                        "rr": float(rr),
                        "outcome": outcome,
                        "exit_date": exit_ts,
                        "regime": entry_regime,
                    }
                )
                in_trade = False
                entry_price = 0.0
                direction = 0

    return _compute_metrics_from_trades(trades, initial_capital)


def run_walk_forward(
    ohlcv_df: pd.DataFrame,
    signals_series: pd.Series,
    params: Dict,
    initial_capital: float = 10000.0,
    fee_pct: float = 0.001,
    slippage_pct: float = 0.0002,
    train_ratio: float = 0.70,
    oos_min_sharpe_ratio: float = 0.5,
) -> Tuple[BacktestMetrics, BacktestMetrics]:
    """
    Single walk-forward split: train on first train_ratio of data, test on remainder.

    Returns (is_metrics, oos_metrics).
    Sets is_metrics.is_overfit=True if OOS Sharpe < oos_min_sharpe_ratio * IS Sharpe.
    """
    n = len(ohlcv_df)
    split = int(n * train_ratio)
    if split < 30 or (n - split) < 10:
        # Not enough data for meaningful split — fall back to full backtest
        full = run_backtest_pandas(ohlcv_df, signals_series, params, initial_capital, fee_pct, slippage_pct)
        return full, BacktestMetrics()

    is_df = ohlcv_df.iloc[:split]
    oos_df = ohlcv_df.iloc[split:]
    is_sig = signals_series.reindex(is_df.index)
    oos_sig = signals_series.reindex(oos_df.index)

    is_metrics = run_backtest_pandas(is_df, is_sig, params, initial_capital, fee_pct, slippage_pct)
    oos_metrics = run_backtest_pandas(oos_df, oos_sig, params, initial_capital, fee_pct, slippage_pct)

    # Attach OOS summary to IS metrics
    is_metrics.oos_sharpe = oos_metrics.sharpe
    is_metrics.oos_profit_factor = oos_metrics.profit_factor
    is_metrics.oos_total_trades = oos_metrics.total_trades

    # Overfitting check
    if is_metrics.sharpe > 0 and oos_metrics.sharpe < oos_min_sharpe_ratio * is_metrics.sharpe:
        is_metrics.is_overfit = True
        logger.warning(
            "Walk-forward overfitting detected: IS_sharpe=%.3f OOS_sharpe=%.3f (threshold=%.1f%%)",
            is_metrics.sharpe,
            oos_metrics.sharpe,
            oos_min_sharpe_ratio * 100,
        )

    return is_metrics, oos_metrics


class BacktestRunner:
    def __init__(
        self,
        fee_pct: float = 0.001,
        slippage_pct: float = 0.0002,
    ) -> None:
        self.fee_pct = fee_pct
        self.slippage_pct = slippage_pct

    def run(
        self,
        ohlcv_df: pd.DataFrame,
        signals_series: pd.Series,
        params: Dict,
        initial_capital: float = 10000.0,
    ) -> BacktestMetrics:
        if ohlcv_df.empty or signals_series.empty:
            return BacktestMetrics()
        try:
            return run_backtest_pandas(
                ohlcv_df, signals_series, params, initial_capital,
                fee_pct=self.fee_pct, slippage_pct=self.slippage_pct,
            )
        except Exception as exc:
            logger.error("Backtest error: %s", exc)
            return BacktestMetrics()

    def run_walk_forward(
        self,
        ohlcv_df: pd.DataFrame,
        signals_series: pd.Series,
        params: Dict,
        initial_capital: float = 10000.0,
        train_ratio: float = 0.70,
        oos_min_sharpe_ratio: float = 0.5,
    ) -> Tuple[BacktestMetrics, BacktestMetrics]:
        if ohlcv_df.empty or signals_series.empty:
            return BacktestMetrics(), BacktestMetrics()
        try:
            return run_walk_forward(
                ohlcv_df, signals_series, params, initial_capital,
                fee_pct=self.fee_pct, slippage_pct=self.slippage_pct,
                train_ratio=train_ratio, oos_min_sharpe_ratio=oos_min_sharpe_ratio,
            )
        except Exception as exc:
            logger.error("Walk-forward error: %s", exc)
            return BacktestMetrics(), BacktestMetrics()
