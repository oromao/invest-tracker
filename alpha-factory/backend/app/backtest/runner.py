from __future__ import annotations

import json
import logging
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Dict, List, Optional

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


def _compute_metrics_from_trades(
    trades: List[Dict],
    initial_capital: float = 10000.0,
) -> BacktestMetrics:
    """Compute backtest metrics from a list of trade dicts with 'pnl' and 'rr' fields."""
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

    # Annualized Sharpe ratio using daily returns series.
    # Build a date-indexed series with 0.0 for every calendar day in the backtest range,
    # then add each trade's PnL to its exit date bucket.
    sharpe = 0.0
    exit_dates = [t.get("exit_date") for t in trades if t.get("exit_date") is not None]
    if exit_dates:
        min_date = min(exit_dates)
        max_date = max(exit_dates)
        date_range = pd.date_range(start=min_date, end=max_date, freq="D")
        daily_returns = pd.Series(0.0, index=date_range)
        for t in trades:
            ed = t.get("exit_date")
            if ed is not None:
                day = pd.Timestamp(ed).normalize()
                if day in daily_returns.index:
                    daily_returns[day] += t.get("pnl", 0.0)
        std = daily_returns.std()
        if std > 0:
            sharpe = float((daily_returns.mean() / std) * np.sqrt(252))
    else:
        # Fallback when exit_date is not present: treat each trade PnL as a daily return period
        pnl_arr = np.array(pnls)
        if pnl_arr.std() > 0:
            sharpe = float((pnl_arr.mean() / pnl_arr.std()) * np.sqrt(252))

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
    )


def run_backtest_pandas(
    ohlcv_df: pd.DataFrame,
    signals_series: pd.Series,
    params: Dict,
    initial_capital: float = 10000.0,
) -> BacktestMetrics:
    """
    Pandas-based vectorized backtest.

    Parameters
    ----------
    ohlcv_df       : DataFrame with columns open/high/low/close/volume, DatetimeIndex
    signals_series : pd.Series aligned with ohlcv_df; values 1 (LONG), -1 (SHORT), 0 (no trade)
    params         : dict with optional keys: tp_pct, sl_pct, position_size_pct
    initial_capital: starting capital

    Returns
    -------
    BacktestMetrics
    """
    tp_pct = float(params.get("tp_pct", 0.02))
    sl_pct = float(params.get("sl_pct", 0.01))
    pos_pct = float(params.get("position_size_pct", 0.1))

    close = ohlcv_df["close"]
    high = ohlcv_df["high"]
    low = ohlcv_df["low"]

    # Align signals
    signals = signals_series.reindex(close.index).fillna(0)

    trades = []
    capital = initial_capital
    in_trade = False
    entry_price = 0.0
    direction = 0
    entry_idx = 0

    close_arr = close.values
    high_arr = high.values
    low_arr = low.values
    sig_arr = signals.values

    for i in range(len(close_arr)):
        if not in_trade:
            if sig_arr[i] != 0:
                in_trade = True
                direction = int(sig_arr[i])
                entry_price = close_arr[i]
                entry_idx = i
        else:
            tp_price = entry_price * (1 + direction * tp_pct)
            sl_price = entry_price * (1 - direction * sl_pct)

            # Check TP hit
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
                # Reversal signal
                exit_price = close_arr[i]
                outcome = "reversal"

            if exit_price is not None:
                raw_ret = (exit_price - entry_price) / entry_price * direction
                trade_size = capital * pos_pct
                pnl = trade_size * raw_ret
                rr = (
                    abs(exit_price - entry_price) / abs(sl_price - entry_price)
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
                        "exit_price": float(exit_price),
                        "pnl": float(pnl),
                        "rr": float(rr),
                        "outcome": outcome,
                        "exit_date": exit_ts,
                    }
                )
                in_trade = False
                entry_price = 0.0
                direction = 0

    return _compute_metrics_from_trades(trades, initial_capital)


class BacktestRunner:
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
            return run_backtest_pandas(ohlcv_df, signals_series, params, initial_capital)
        except Exception as exc:
            logger.error("Backtest error: %s", exc)
            return BacktestMetrics()
