"""
Paper trading engine.

Picks up DB signals → simulates fills → tracks open positions in Redis →
evaluates TP/SL on each new bar → maintains rolling PnL statistics →
detects instability and strategy performance decay.

All mutable state lives in Redis so it survives backend restarts.
"""
from __future__ import annotations

import json
import logging
from typing import Dict, List, Optional

import numpy as np
import redis.asyncio as aioredis
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.db.models import DirectionEnum, OHLCVBar, StrategyStatusEnum
from app.db.session import AsyncSessionLocal
from app.research.memory import StrategyMemoryStore
from app.shared.time import now_sao_paulo

logger = logging.getLogger(__name__)

# Redis keys
_KEY_POSITIONS = "alpha:paper:positions"
_KEY_STATS = "alpha:paper:stats"
_KEY_PORTFOLIO = "alpha:portfolio:state"

_INITIAL_CAPITAL = settings.paper_trading_initial_capital
_POSITION_SIZE_PCT = 0.10  # 10% of capital per trade


def _redis():
    return aioredis.from_url(settings.redis_url, decode_responses=True)


class PaperTrader:
    def __init__(self) -> None:
        self.memory = StrategyMemoryStore()

    # ── Redis helpers ──────────────────────────────────────────────────────
    async def _load_positions(self, r) -> List[Dict]:
        raw = await r.get(_KEY_POSITIONS)
        if raw:
            try:
                return json.loads(raw)
            except Exception:
                pass
        return []

    async def _save_positions(self, r, positions: List[Dict]) -> None:
        await r.set(_KEY_POSITIONS, json.dumps(positions))

    async def _load_stats(self, r) -> Dict:
        raw = await r.get(_KEY_STATS)
        if raw:
            try:
                return json.loads(raw)
            except Exception:
                pass
        return {
            "capital": _INITIAL_CAPITAL,
            "peak_capital": _INITIAL_CAPITAL,
            "total_trades": 0,
            "wins": 0,
            "losses": 0,
            "total_pnl": 0.0,
            "max_drawdown": 0.0,
            "consecutive_losses": 0,
            "daily_pnl_series": [],  # list of floats, one per closed trade day
        }

    async def _save_stats(self, r, stats: Dict) -> None:
        await r.set(_KEY_STATS, json.dumps(stats))

    # ── Portfolio state for signal engine ────────────────────────────────
    async def _write_portfolio_state(
        self, r, positions: List[Dict], stats: Dict
    ) -> None:
        open_pos = [p for p in positions if p.get("status") == "open"]
        cap = stats.get("capital", _INITIAL_CAPITAL)
        exposure = sum(p.get("size", 0) for p in open_pos) / max(cap, 1.0)

        state = {
            "capital": cap,
            "daily_pnl": stats.get("total_pnl", 0.0),
            "total_exposure": round(exposure, 4),
            "open_positions": [
                {
                    "asset": p["asset"],
                    "direction": p["direction"],
                    "size": p.get("size", 0),
                }
                for p in open_pos
            ],
            "last_updated": now_sao_paulo().isoformat(),
        }
        await r.set(_KEY_PORTFOLIO, json.dumps(state), ex=3600)

    # ── Signal ingestion ─────────────────────────────────────────────────
    async def ingest_new_signals(self) -> int:
        """
        Pull recent actionable signals from DB.
        Open a paper position for each asset not already in an open trade.
        """
        async with AsyncSessionLocal() as session:
            stmt = text(
                """
                SELECT id, asset, timeframe, direction, confidence,
                       entry_price, tp1, sl, timestamp, strategy_id
                FROM signals
                WHERE direction != 'NO_TRADE'
                  AND entry_price IS NOT NULL
                  AND tp1 IS NOT NULL
                  AND sl IS NOT NULL
                  AND timestamp > NOW() - INTERVAL '2 hours'
                ORDER BY timestamp DESC
                LIMIT 40
                """
            )
            rows = (await session.execute(stmt)).fetchall()

        if not rows:
            return 0

        r = _redis()
        positions = await self._load_positions(r)
        stats = await self._load_stats(r)
        open_assets = {p["asset"] for p in positions if p.get("status") == "open"}
        new = 0

        for row in rows:
            sig_id, asset, timeframe, direction, confidence, entry_price, tp1, sl, ts, strat_id = row
            if asset in open_assets:
                continue

            dir_int = 1 if direction == "LONG" else -1
            # Apply entry slippage
            actual_entry = float(entry_price) * (1 + dir_int * settings.backtest_slippage_pct)
            trade_size = stats["capital"] * _POSITION_SIZE_PCT

            positions.append(
                {
                    "signal_id": sig_id,
                    "asset": asset,
                    "timeframe": timeframe,
                    "direction": direction,
                    "entry_price": actual_entry,
                    "tp_price": float(tp1),
                    "sl_price": float(sl),
                    "size": trade_size,
                    "strategy_id": strat_id,
                    "status": "open",
                    "open_ts": ts.isoformat() if hasattr(ts, "isoformat") else str(ts),
                    "close_ts": None,
                    "exit_price": None,
                    "pnl": 0.0,
                    "outcome": None,
                }
            )
            open_assets.add(asset)
            new += 1

        await self._save_positions(r, positions)
        await self._write_portfolio_state(r, positions, stats)
        await r.aclose()

        if new:
            logger.info("Paper trader: opened %d new positions", new)
        return new

    # ── Position evaluation ───────────────────────────────────────────────
    async def update_positions(self) -> Dict:
        """
        Check each open position against the latest bar for its asset/timeframe.
        Close position if TP or SL was hit.
        Returns current stats dict.
        """
        r = _redis()
        positions = await self._load_positions(r)
        stats = await self._load_stats(r)

        open_pos = [p for p in positions if p.get("status") == "open"]
        if not open_pos:
            await self._write_portfolio_state(r, positions, stats)
            await r.aclose()
            return stats

        async with AsyncSessionLocal() as session:
            for pos in open_pos:
                asset = pos["asset"]
                timeframe = pos["timeframe"]

                stmt = (
                    select(OHLCVBar)
                    .where(OHLCVBar.asset == asset, OHLCVBar.timeframe == timeframe)
                    .order_by(OHLCVBar.timestamp.desc())
                    .limit(1)
                )
                bar = (await session.execute(stmt)).scalar_one_or_none()
                if bar is None:
                    continue

                dir_int = 1 if pos["direction"] == "LONG" else -1
                tp = pos["tp_price"]
                sl = pos["sl_price"]
                entry = pos["entry_price"]

                tp_hit = (dir_int == 1 and bar.high >= tp) or (
                    dir_int == -1 and bar.low <= tp
                )
                sl_hit = (dir_int == 1 and bar.low <= sl) or (
                    dir_int == -1 and bar.high >= sl
                )

                exit_price: Optional[float] = None
                outcome: Optional[str] = None

                if sl_hit:
                    exit_price, outcome = sl, "sl"
                elif tp_hit:
                    exit_price, outcome = tp, "tp"

                if exit_price is None:
                    continue

                # Apply exit slippage (adverse direction)
                actual_exit = exit_price * (1 - dir_int * settings.backtest_slippage_pct)
                raw_ret = (actual_exit - entry) / entry * dir_int
                fee = pos["size"] * settings.backtest_fee_pct * 2
                pnl = pos["size"] * raw_ret - fee

                pos.update(
                    status="closed",
                    pnl=round(pnl, 4),
                    outcome=outcome,
                    exit_price=actual_exit,
                    close_ts=now_sao_paulo().isoformat(),
                )

                # Update statistics
                stats["capital"] += pnl
                stats["total_pnl"] += pnl
                stats["total_trades"] += 1
                stats["daily_pnl_series"].append(round(pnl, 4))
                # Keep last 200 trades only
                stats["daily_pnl_series"] = stats["daily_pnl_series"][-200:]

                if pnl > 0:
                    stats["wins"] += 1
                    stats["consecutive_losses"] = 0
                else:
                    stats["losses"] += 1
                    stats["consecutive_losses"] = stats.get("consecutive_losses", 0) + 1

                if stats["capital"] > stats["peak_capital"]:
                    stats["peak_capital"] = stats["capital"]

                dd = (stats["peak_capital"] - stats["capital"]) / stats["peak_capital"]
                stats["max_drawdown"] = max(stats.get("max_drawdown", 0.0), dd)

                logger.info(
                    "Paper trade closed %s %s: pnl=%.2f  outcome=%s  capital=%.2f  consec_losses=%d",
                    pos["direction"], asset,
                    pnl, outcome,
                    stats["capital"], stats["consecutive_losses"],
                )

        await self._save_positions(r, positions)
        await self._save_stats(r, stats)
        await self._write_portfolio_state(r, positions, stats)
        await r.aclose()
        return stats

    # ── Analytics ────────────────────────────────────────────────────────
    async def get_stats(self) -> Dict:
        r = _redis()
        stats = await self._load_stats(r)
        positions = await self._load_positions(r)
        await r.aclose()

        total = stats.get("total_trades", 0)
        wins = stats.get("wins", 0)
        stats["win_rate"] = round(wins / total, 4) if total > 0 else 0.0
        stats["rolling_sharpe"] = self._rolling_sharpe(stats.get("daily_pnl_series", []))
        stats["open_positions"] = [p for p in positions if p.get("status") == "open"]
        stats["is_unstable"] = self._check_instability(stats)
        return stats

    def _rolling_sharpe(self, pnl_series: List[float]) -> float:
        if len(pnl_series) < 5:
            return 0.0
        arr = np.array(pnl_series[-60:], dtype=float)
        std = arr.std()
        if std < 1e-9:
            return 0.0
        return round(float(arr.mean() / std * np.sqrt(252)), 4)

    def _check_instability(self, stats: Dict) -> bool:
        consec = stats.get("consecutive_losses", 0)
        dd = stats.get("max_drawdown", 0.0)
        cap = stats.get("capital", _INITIAL_CAPITAL)

        if consec >= settings.max_consecutive_losses:
            logger.warning("Paper trader: %d consecutive losses — INSTABILITY", consec)
            return True
        if dd >= settings.max_portfolio_drawdown:
            logger.warning("Paper trader: drawdown %.1f%% — INSTABILITY", dd * 100)
            return True
        if cap < _INITIAL_CAPITAL * (1 - settings.max_portfolio_drawdown):
            logger.warning(
                "Paper trader: capital %.2f (%.1f%% loss) — INSTABILITY",
                cap, (1 - cap / _INITIAL_CAPITAL) * 100,
            )
            return True
        return False

    # ── Strategy decay detection ─────────────────────────────────────────
    async def check_and_demote_decayed(self) -> int:
        """
        Compare live paper trade stats to backtest expectations.
        Auto-demote active strategy to candidate if decay detected.
        Returns number of strategies demoted.
        """
        stats = await self.get_stats()
        total = stats.get("total_trades", 0)

        if total < settings.decay_min_trades:
            return 0  # not enough live trades to judge

        live_win_rate = stats.get("win_rate", 0.0)
        live_dd = stats.get("max_drawdown", 0.0)
        consec = stats.get("consecutive_losses", 0)

        demoted = 0
        async with AsyncSessionLocal() as session:
            # Fetch active strategy and its best backtest metrics
            stmt = text(
                """
                SELECT s.strategy_id, b.win_rate, b.max_drawdown
                FROM strategies s
                JOIN backtest_runs b ON b.strategy_id = s.id
                WHERE s.status = 'active'
                ORDER BY b.sharpe DESC
                LIMIT 1
                """
            )
            row = (await session.execute(stmt)).fetchone()
            if row is None:
                return 0

            strat_id, bt_win_rate, bt_dd = row
            bt_win_rate = float(bt_win_rate or 0.5)
            bt_dd = float(bt_dd or 0.1)

            decay = False
            reason = ""

            if live_win_rate < bt_win_rate * settings.decay_win_rate_ratio:
                decay = True
                reason = (
                    f"live_wr={live_win_rate:.2f} < {settings.decay_win_rate_ratio:.0%} "
                    f"of backtest_wr={bt_win_rate:.2f}"
                )
            elif live_dd > bt_dd * 2.0 and live_dd > 0.10:
                decay = True
                reason = f"live_dd={live_dd:.2%} > 2× backtest_dd={bt_dd:.2%}"
            elif consec >= settings.max_consecutive_losses:
                decay = True
                reason = f"consecutive_losses={consec}"

            if decay:
                from app.registry.strategies import StrategyRegistry
                registry = StrategyRegistry()
                strat = await registry.update_status(
                    session, strat_id, StrategyStatusEnum.deprecated
                )
                if strat:
                    latest_backtest_stmt = text(
                        """
                        SELECT b.asset, b.timeframe, b.sharpe, b.profit_factor, b.expectancy, b.max_drawdown,
                               b.win_rate, b.total_trades, b.params_json
                        FROM backtest_runs b
                        JOIN strategies s ON s.id = b.strategy_id
                        WHERE s.strategy_id = :strategy_id
                        ORDER BY b.run_at DESC
                        LIMIT 1
                        """
                    )
                    latest_backtest = (await session.execute(latest_backtest_stmt, {"strategy_id": strat_id})).fetchone()
                    metrics = {
                        "sharpe": float(latest_backtest[2] or 0.0) if latest_backtest else 0.0,
                        "profit_factor": float(latest_backtest[3] or 0.0) if latest_backtest else 0.0,
                        "expectancy": float(latest_backtest[4] or 0.0) if latest_backtest else 0.0,
                        "max_drawdown": float(latest_backtest[5] or 0.0) if latest_backtest else 0.0,
                        "win_rate": float(latest_backtest[6] or 0.0) if latest_backtest else 0.0,
                        "total_trades": int(latest_backtest[7] or 0) if latest_backtest else 0,
                    }
                    params = {}
                    if latest_backtest and latest_backtest[6]:
                        try:
                            params = json.loads(latest_backtest[8])
                        except Exception:
                            params = {}
                    asset = latest_backtest[0] if latest_backtest else "unknown"
                    timeframe = latest_backtest[1] if latest_backtest else "paper"
                    await self.memory.record_event(
                        session,
                        strategy=strat,
                        asset=asset,
                        timeframe=timeframe,
                        event_type="retired",
                        lifecycle_state="retired",
                        score=metrics["sharpe"] + metrics["profit_factor"],
                        metrics=metrics,
                        params=params,
                        reason=f"paper decay retirement: {reason}",
                    )
                    await session.commit()
                    demoted += 1
                    logger.warning(
                        "Strategy RETIRED to deprecated: %s  reason=%s",
                        strat_id, reason,
                    )

        return demoted


# ── Portfolio state loader (used by signal engine) ────────────────────────
async def load_portfolio_state_from_redis():
    """
    Load PortfolioState from Redis (written by PaperTrader).
    Returns a fresh PortfolioState if nothing is stored.
    """
    from app.risk.engine import PortfolioState

    try:
        r = _redis()
        raw = await r.get(_KEY_PORTFOLIO)
        await r.aclose()
        if raw:
            data = json.loads(raw)
            return PortfolioState(
                capital=float(data.get("capital", _INITIAL_CAPITAL)),
                daily_pnl=float(data.get("daily_pnl", 0.0)),
                total_exposure=float(data.get("total_exposure", 0.0)),
                open_positions=data.get("open_positions", []),
            )
    except Exception as exc:
        logger.debug("Portfolio state Redis load failed (non-fatal): %s", exc)

    from app.risk.engine import PortfolioState
    return PortfolioState()
