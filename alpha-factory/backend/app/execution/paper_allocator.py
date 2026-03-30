from __future__ import annotations

import json
import logging
import math
from collections import defaultdict
from typing import Any, Dict, List, Optional

import redis.asyncio as aioredis
from sqlalchemy import desc, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.db.models import BacktestRun, MarketRegime, PaperStrategyAllocation, Strategy, StrategyStatusEnum, Trade
from app.db.session import AsyncSessionLocal
from app.research.memory import StrategyMemoryStore
from app.shared.time import now_sao_paulo

logger = logging.getLogger(__name__)

_KEY_ALLOCATIONS = "alpha:paper:allocations"
_KEY_STATS = "alpha:paper:stats"
_KEY_POSITIONS = "alpha:paper:positions"


def _redis():
    return aioredis.from_url(settings.redis_url, decode_responses=True)


def _safe_float(value: Any, default: float = 0.0) -> float:
    try:
        if value is None:
            return default
        return float(value)
    except Exception:
        return default


def _safe_int(value: Any, default: int = 0) -> int:
    try:
        if value is None:
            return default
        return int(value)
    except Exception:
        return default


def _json_safe(obj: Any) -> Any:
    if isinstance(obj, list):
        return [_json_safe(v) for v in obj]
    if isinstance(obj, dict):
        return {k: _json_safe(v) for k, v in obj.items()}
    if hasattr(obj, "isoformat"):
        return obj.isoformat()
    if hasattr(obj, "item"):
        return obj.item()
    return obj


def _trade_drawdown(pnls: List[float]) -> float:
    equity = 0.0
    peak = 0.0
    max_dd = 0.0
    for pnl in pnls:
        equity += pnl
        peak = max(peak, equity)
        if peak > 0:
            dd = (peak - equity) / peak
            max_dd = max(max_dd, dd)
    return round(max_dd, 6)


def _payoff_ratio(pnls: List[float]) -> float:
    wins = [p for p in pnls if p > 0]
    losses = [abs(p) for p in pnls if p < 0]
    if not wins and not losses:
        return 0.0
    avg_win = sum(wins) / len(wins) if wins else 0.0
    avg_loss = sum(losses) / len(losses) if losses else 0.0
    if avg_loss <= 1e-9:
        return round(avg_win if avg_win > 0 else 0.0, 4)
    return round(avg_win / avg_loss, 4)


def _recent_window(trades: List[Trade], window: int = 5) -> tuple[float, float, int]:
    recent = trades[-window:]
    if not recent:
        return 0.0, 0.0, 0
    pnls = [float(t.pnl or 0.0) for t in recent]
    win_rate = sum(1 for p in pnls if p > 0) / len(pnls)
    return round(sum(pnls), 4), round(win_rate, 4), len(pnls)


def _strategy_status_weight(status: Optional[str], lifecycle_state: Optional[str]) -> float:
    if lifecycle_state in {"retired", "rejected"}:
        return 0.0
    if lifecycle_state in {"live_limited", "live", "micro_live"}:
        return 1.25
    if lifecycle_state == "paper":
        return 1.15
    if lifecycle_state == "validated":
        return 1.0
    if lifecycle_state == "candidate":
        return 0.82
    if lifecycle_state == "degraded":
        return 0.25
    if status == StrategyStatusEnum.active.value:
        return 1.05
    if status == StrategyStatusEnum.candidate.value:
        return 0.85
    if status == StrategyStatusEnum.deprecated.value:
        return 0.15
    return 0.55


def _lifecycle_cap(status: Optional[str], lifecycle_state: Optional[str]) -> float:
    if lifecycle_state in {"retired", "rejected"}:
        return 0.0
    if lifecycle_state in {"live_limited", "live", "micro_live"}:
        return 0.32
    if lifecycle_state == "paper":
        return 0.24
    if lifecycle_state == "validated":
        return 0.18
    if lifecycle_state == "candidate":
        return 0.14
    if lifecycle_state == "degraded":
        return 0.05
    if status == StrategyStatusEnum.active.value:
        return 0.26
    if status == StrategyStatusEnum.candidate.value:
        return 0.12
    if status == StrategyStatusEnum.deprecated.value:
        return 0.03
    return 0.08


class PaperPortfolioAllocator:
    def __init__(self) -> None:
        self.memory = StrategyMemoryStore()

    async def _load_open_positions(self) -> List[Dict[str, Any]]:
        r = _redis()
        try:
            raw = await r.get(_KEY_POSITIONS)
            if not raw:
                return []
            return json.loads(raw)
        except Exception as exc:
            logger.warning("Failed to load paper positions: %s", exc)
            return []
        finally:
            await r.aclose()

    async def _load_stats(self) -> Dict[str, Any]:
        r = _redis()
        try:
            raw = await r.get(_KEY_STATS)
            if not raw:
                return {}
            return json.loads(raw)
        except Exception as exc:
            logger.warning("Failed to load paper stats: %s", exc)
            return {}
        finally:
            await r.aclose()

    async def _current_regime(self, session: AsyncSession, asset: Optional[str], timeframe: Optional[str]) -> Optional[str]:
        if not asset or not timeframe:
            return None
        stmt = (
            select(MarketRegime.regime)
            .where(MarketRegime.asset == asset, MarketRegime.timeframe == timeframe)
            .order_by(desc(MarketRegime.timestamp))
            .limit(1)
        )
        result = await session.execute(stmt)
        regime = result.scalar_one_or_none()
        if regime is None:
            return None
        return regime.value if hasattr(regime, "value") else str(regime)

    async def _latest_backtest(self, session: AsyncSession, strategy_db_id: int, asset: Optional[str] = None, timeframe: Optional[str] = None) -> Optional[BacktestRun]:
        stmt = select(BacktestRun).where(BacktestRun.strategy_id == strategy_db_id)
        if asset:
            stmt = stmt.where(BacktestRun.asset == asset)
        if timeframe:
            stmt = stmt.where(BacktestRun.timeframe == timeframe)
        stmt = stmt.order_by(desc(BacktestRun.run_at)).limit(1)
        result = await session.execute(stmt)
        run = result.scalar_one_or_none()
        if run is not None:
            return run
        stmt = select(BacktestRun).where(BacktestRun.strategy_id == strategy_db_id).order_by(desc(BacktestRun.run_at)).limit(1)
        result = await session.execute(stmt)
        return result.scalar_one_or_none()

    async def _trade_rows(self, session: AsyncSession, strategy_id: str) -> List[Trade]:
        stmt = (
            select(Trade)
            .where(Trade.strategy_id == strategy_id)
            .order_by(Trade.exit_time.asc())
        )
        result = await session.execute(stmt)
        return list(result.scalars().all())

    async def _persist_snapshots(self, session: AsyncSession, rows: List[Dict[str, Any]]) -> None:
        for row in rows:
            session.add(
                PaperStrategyAllocation(
                    strategy_id=row["strategy_id"],
                    asset=row["asset"],
                    timeframe=row["timeframe"],
                    lifecycle_state=row.get("lifecycle_state"),
                    regime=row.get("regime"),
                    allocation_weight=row["allocation_weight"],
                    capital_allocated=row["capital_allocated"],
                    realized_pnl=row["realized_pnl"],
                    unrealized_pnl=row["unrealized_pnl"],
                    net_pnl=row["net_pnl"],
                    trade_count=row["trade_count"],
                    win_rate=row.get("win_rate"),
                    payoff_ratio=row.get("payoff_ratio"),
                    max_drawdown=row.get("max_drawdown"),
                    recent_pnl=row.get("recent_pnl"),
                    recent_win_rate=row.get("recent_win_rate"),
                    recent_trade_count=row.get("recent_trade_count"),
                    backtest_win_rate=row.get("backtest_win_rate"),
                    backtest_profit_factor=row.get("backtest_profit_factor"),
                    backtest_sharpe=row.get("backtest_sharpe"),
                    backtest_max_drawdown=row.get("backtest_max_drawdown"),
                    regime_fit_score=row.get("regime_fit_score"),
                    concentration_penalty=row.get("concentration_penalty"),
                    paper_backtest_delta=row.get("paper_backtest_delta"),
                    reason=row.get("reason"),
                    updated_at=now_sao_paulo(),
                )
            )
        await session.flush()

    async def refresh_allocations(self) -> List[Dict[str, Any]]:
        async with AsyncSessionLocal() as session:
            strategies = await session.execute(select(Strategy))
            strategy_rows = list(strategies.scalars().all())
            stats = await self._load_stats()
            capital = _safe_float(stats.get("capital"), settings.paper_trading_initial_capital)
            open_positions = await self._load_open_positions()
            open_by_strategy: Dict[str, float] = defaultdict(float)
            open_unrealized: Dict[str, float] = defaultdict(float)
            for pos in open_positions:
                sid = str(pos.get("strategy_id") or "")
                if not sid:
                    continue
                open_by_strategy[sid] += _safe_float(pos.get("size"), 0.0)
                open_unrealized[sid] += _safe_float(pos.get("pnl"), 0.0)

            candidate_rows: List[Dict[str, Any]] = []
            for strat in strategy_rows:
                trade_rows = await self._trade_rows(session, strat.strategy_id)
                if not trade_rows and strat.status not in {StrategyStatusEnum.active, StrategyStatusEnum.candidate}:
                    continue

                pnls = [float(t.pnl or 0.0) for t in trade_rows]
                trade_count = len(pnls)
                realized_pnl = round(sum(pnls), 4)
                wins = [p for p in pnls if p > 0]
                losses = [abs(p) for p in pnls if p < 0]
                win_rate = round(len(wins) / trade_count, 4) if trade_count else 0.0
                payoff_ratio = _payoff_ratio(pnls)
                max_drawdown = _trade_drawdown(pnls)
                recent_pnl, recent_win_rate, recent_trade_count = _recent_window(trade_rows, window=5)
                latest_trade = trade_rows[-1] if trade_rows else None
                asset = latest_trade.asset if latest_trade else "unknown"
                timeframe = latest_trade.timeframe if latest_trade and latest_trade.timeframe else "1h"

                latest_state = await self.memory.latest_state(session, strat.strategy_id)
                lifecycle_state = latest_state.lifecycle_state if latest_state else None
                reason = latest_state.reason if latest_state else None
                current_regime = await self._current_regime(session, asset if asset != "unknown" else None, timeframe)
                backtest = await self._latest_backtest(session, strat.id, asset=asset if asset != "unknown" else None, timeframe=timeframe)

                params = {}
                if strat.params_json:
                    try:
                        params = json.loads(strat.params_json)
                    except Exception:
                        params = {}
                allowed_regimes = params.get("regime", []) if isinstance(params, dict) else []
                if allowed_regimes and current_regime in allowed_regimes:
                    regime_fit_score = 1.0
                elif allowed_regimes:
                    regime_fit_score = 0.25
                else:
                    regime_fit_score = 0.65 if current_regime else 0.5

                backtest_win_rate = _safe_float(backtest.win_rate if backtest else None, 0.0)
                backtest_profit_factor = _safe_float(backtest.profit_factor if backtest else None, 0.0)
                backtest_sharpe = _safe_float(backtest.sharpe if backtest else None, 0.0)
                backtest_max_drawdown = _safe_float(backtest.max_drawdown if backtest else None, 0.0)

                unrealized_pnl = round(open_unrealized.get(strat.strategy_id, 0.0), 4)
                net_pnl = round(realized_pnl + unrealized_pnl, 4)
                drawdown_penalty = min(max_drawdown * 2.0, 1.5)
                recent_bonus = 0.0
                if capital > 0:
                    recent_bonus = max(min(recent_pnl / max(capital * 0.05, 1.0), 1.0), -1.0) * 0.8
                paper_vs_backtest = 0.0
                if backtest_win_rate > 0:
                    paper_vs_backtest -= max(0.0, (backtest_win_rate - win_rate) / max(backtest_win_rate, 1e-9)) * 0.6
                if backtest_profit_factor > 0:
                    paper_vs_backtest -= max(0.0, (backtest_profit_factor - payoff_ratio) / max(backtest_profit_factor, 1e-9)) * 0.5
                lifecycle_weight = _strategy_status_weight(strat.status.value if hasattr(strat.status, "value") else str(strat.status), lifecycle_state)
                base_score = (
                    lifecycle_weight
                    + max(min((win_rate - 0.5) * 2.0, 1.0), -1.0) * 0.9
                    + max(min((payoff_ratio - 1.0), 1.0), -1.0) * 0.5
                    + recent_bonus
                    + regime_fit_score * 0.7
                    + max(min(backtest_sharpe / 3.0, 1.0), 0.0) * 0.4
                    + max(min(backtest_profit_factor - 1.0, 1.0), 0.0) * 0.25
                    - drawdown_penalty
                    + paper_vs_backtest
                )
                if strat.status == StrategyStatusEnum.deprecated:
                    base_score *= 0.15
                if lifecycle_state in {"retired", "rejected"}:
                    base_score = 0.0
                if trade_count == 0 and backtest is None and strat.status != StrategyStatusEnum.active:
                    base_score *= 0.5

                candidate_rows.append(
                    {
                        "strategy_id": strat.strategy_id,
                        "strategy_db_id": strat.id,
                        "asset": asset,
                        "timeframe": timeframe,
                        "status": strat.status.value if hasattr(strat.status, "value") else str(strat.status),
                        "lifecycle_state": lifecycle_state,
                        "regime": current_regime,
                        "realized_pnl": realized_pnl,
                        "unrealized_pnl": unrealized_pnl,
                        "net_pnl": net_pnl,
                        "trade_count": trade_count,
                        "win_rate": win_rate,
                        "payoff_ratio": payoff_ratio,
                        "max_drawdown": max_drawdown,
                        "recent_pnl": recent_pnl,
                        "recent_win_rate": recent_win_rate,
                        "recent_trade_count": recent_trade_count,
                        "backtest_win_rate": backtest_win_rate if backtest else None,
                        "backtest_profit_factor": backtest_profit_factor if backtest else None,
                        "backtest_sharpe": backtest_sharpe if backtest else None,
                        "backtest_max_drawdown": backtest_max_drawdown if backtest else None,
                        "regime_fit_score": regime_fit_score,
                        "concentration_penalty": min(open_by_strategy.get(strat.strategy_id, 0.0) / max(capital, 1.0), 0.5),
                        "paper_backtest_delta": round(win_rate - backtest_win_rate, 4) if backtest else None,
                        "reason": reason,
                        "score": max(base_score, 0.0),
                    }
                )

            if not candidate_rows:
                candidate_rows = [
                    {
                        "strategy_id": "flat_book",
                        "strategy_db_id": 0,
                        "asset": "n/a",
                        "timeframe": "1h",
                        "status": "flat",
                        "lifecycle_state": "inactive",
                        "regime": None,
                        "realized_pnl": 0.0,
                        "unrealized_pnl": 0.0,
                        "net_pnl": 0.0,
                        "trade_count": 0,
                        "win_rate": 0.0,
                        "payoff_ratio": 0.0,
                        "max_drawdown": 0.0,
                        "recent_pnl": 0.0,
                        "recent_win_rate": 0.0,
                        "recent_trade_count": 0,
                        "backtest_win_rate": None,
                        "backtest_profit_factor": None,
                        "backtest_sharpe": None,
                        "backtest_max_drawdown": None,
                        "regime_fit_score": 0.0,
                        "concentration_penalty": 0.0,
                        "paper_backtest_delta": None,
                        "reason": "no paper trades yet",
                        "score": 1.0,
                    }
                ]

            scores = [row["score"] for row in candidate_rows]
            total_score = sum(scores)
            if total_score <= 0:
                active_rows = [row for row in candidate_rows if row["status"] == StrategyStatusEnum.active.value]
                if active_rows:
                    for row in candidate_rows:
                        row["score"] = 1.0 if row in active_rows else 0.05
                else:
                    for row in candidate_rows:
                        row["score"] = 1.0
                total_score = sum(row["score"] for row in candidate_rows)

            weights = [row["score"] / total_score if total_score > 0 else 0.0 for row in candidate_rows]
            for idx, row in enumerate(candidate_rows):
                row["allocation_weight"] = weights[idx]

            caps = [_lifecycle_cap(row["status"], row["lifecycle_state"]) for row in candidate_rows]
            for _ in range(4):
                overflow = 0.0
                adjustable = []
                for idx, row in enumerate(candidate_rows):
                    cap = caps[idx]
                    if row["allocation_weight"] > cap:
                        overflow += row["allocation_weight"] - cap
                        row["allocation_weight"] = cap
                    else:
                        adjustable.append(idx)
                if overflow <= 1e-6 or not adjustable:
                    break
                adjustable_total = sum(candidate_rows[idx]["allocation_weight"] for idx in adjustable)
                if adjustable_total <= 0:
                    break
                for idx in adjustable:
                    row = candidate_rows[idx]
                    row["allocation_weight"] += overflow * (row["allocation_weight"] / adjustable_total if adjustable_total > 0 else 0.0)

            total_after_caps = sum(row["allocation_weight"] for row in candidate_rows)
            if total_after_caps <= 0:
                active_rows = [row for row in candidate_rows if row["status"] == StrategyStatusEnum.active.value]
                if active_rows:
                    for row in candidate_rows:
                        row["allocation_weight"] = 1.0 if row in active_rows else 0.0
                else:
                    for row in candidate_rows:
                        row["allocation_weight"] = 1.0 if row == candidate_rows[0] else 0.0

            for idx, row in enumerate(candidate_rows):
                row["allocation_weight"] = round(max(row["allocation_weight"], 0.0), 6)
                row["capital_allocated"] = round(row["allocation_weight"] * capital, 4)
                row["allocation_cap"] = caps[idx]

            candidate_rows.sort(key=lambda row: (row["allocation_weight"], row["net_pnl"], row["realized_pnl"]), reverse=True)

            await self._persist_snapshots(session, candidate_rows)
            await session.commit()

            allocations = [
                {
                    **{k: v for k, v in row.items() if k not in {"score", "strategy_db_id", "allocation_cap"}},
                    "updated_at": now_sao_paulo().isoformat(),
                }
                for row in candidate_rows
            ]

            r = _redis()
            try:
                await r.set(_KEY_ALLOCATIONS, json.dumps(_json_safe(allocations)), ex=3600)
            finally:
                await r.aclose()

            logger.info(
                "Refreshed paper allocations for %d strategies; top=%s weight=%.3f capital=%.2f",
                len(allocations),
                allocations[0]["strategy_id"] if allocations else "n/a",
                allocations[0]["allocation_weight"] if allocations else 0.0,
                allocations[0]["capital_allocated"] if allocations else 0.0,
            )
            return allocations

    async def current_allocations(self) -> List[Dict[str, Any]]:
        r = _redis()
        try:
            raw = await r.get(_KEY_ALLOCATIONS)
            if not raw:
                return []
            return json.loads(raw)
        except Exception as exc:
            logger.warning("Failed to load current allocations: %s", exc)
            return []
        finally:
            await r.aclose()

    async def allocation_for_strategy(self, strategy_id: Optional[str], asset: Optional[str] = None, timeframe: Optional[str] = None) -> float:
        if not strategy_id:
            return 0.10
        allocations = await self.current_allocations()
        if not allocations:
            return 0.10
        if asset or timeframe:
            matches = [
                row for row in allocations
                if row.get("strategy_id") == strategy_id
                and (asset is None or row.get("asset") == asset)
                and (timeframe is None or row.get("timeframe") == timeframe)
            ]
            if matches:
                return _safe_float(matches[0].get("allocation_weight"), 0.10)
        for row in allocations:
            if row.get("strategy_id") == strategy_id:
                return _safe_float(row.get("allocation_weight"), 0.10)
        return 0.10

    async def portfolio_view(self) -> List[Dict[str, Any]]:
        allocations = await self.current_allocations()
        if allocations:
            return allocations
        return await self.refresh_allocations()
