from __future__ import annotations

import hashlib
import json
import logging
from dataclasses import dataclass
from typing import Any, Dict, Iterable, List, Optional

from sqlalchemy import desc, func, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import Strategy, StrategyMemory, StrategyStatusEnum
from app.db.models import EvolutionCycle
from app.shared.time import now_sao_paulo, to_sao_paulo

logger = logging.getLogger(__name__)


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


def strategy_signature(params: Dict[str, Any]) -> str:
    normalized = dict(params)
    for key in ("name", "strategy_id", "version", "created_at", "updated_at"):
        normalized.pop(key, None)
    payload = json.dumps(_json_safe(normalized), sort_keys=True, separators=(",", ":"))
    return hashlib.sha1(payload.encode("utf-8")).hexdigest()[:12]


def normalize_event_reason(reason: Optional[str]) -> str:
    return (reason or "").strip()


def score_backtest_metrics(metrics: Dict[str, Any]) -> float:
    sharpe = max(0.0, float(metrics.get("sharpe", 0.0) or 0.0))
    pf = max(0.0, float(metrics.get("profit_factor", 0.0) or 0.0))
    expectancy = float(metrics.get("expectancy", 0.0) or 0.0)
    max_dd = max(0.0, float(metrics.get("max_drawdown", 0.0) or 0.0))
    win_rate = float(metrics.get("win_rate", 0.0) or 0.0)
    total_trades = int(metrics.get("total_trades", 0) or 0)
    oos_sharpe = float(metrics.get("oos_sharpe", 0.0) or 0.0)
    oos_pf = float(metrics.get("oos_profit_factor", 0.0) or 0.0)
    is_overfit = bool(metrics.get("is_overfit", False))

    consistency = 0.0
    if sharpe > 0:
        consistency += min(max(oos_sharpe / sharpe, -1.0), 1.0) * 0.35
    if pf > 0:
        consistency += min(max(oos_pf / pf, 0.0), 1.0) * 0.25

    trade_bonus = min(total_trades / 40.0, 1.0) * 0.1
    drawdown_penalty = max(0.0, 1.0 - min(max_dd, 1.0)) * 0.2
    win_quality = max(0.0, min(win_rate, 1.0)) * 0.1
    expectancy_bonus = max(-0.1, min(expectancy / 100.0, 0.2))
    overfit_penalty = 0.45 if is_overfit else 1.0

    base = (
        sharpe * 0.30
        + pf * 0.22
        + drawdown_penalty
        + trade_bonus
        + win_quality
        + expectancy_bonus
        + consistency
    )
    return round(base * overfit_penalty, 4)


class StrategyMemoryStore:
    async def best_proven_score(
        self,
        session: AsyncSession,
        *,
        asset: Optional[str] = None,
        timeframe: Optional[str] = None,
    ) -> float:
        stmt = (
            select(func.max(StrategyMemory.score))
            .where(
                StrategyMemory.event_type == "promoted",
                StrategyMemory.lifecycle_state.in_(["paper", "micro_live", "live_limited", "live"]),
            )
        )
        if asset:
            stmt = stmt.where(StrategyMemory.asset == asset)
        if timeframe:
            stmt = stmt.where(StrategyMemory.timeframe == timeframe)
        result = await session.execute(stmt)
        value = result.scalar_one_or_none()
        return float(value or 0.0)

    async def best_active_score(
        self,
        session: AsyncSession,
        *,
        asset: Optional[str] = None,
        timeframe: Optional[str] = None,
    ) -> float:
        stmt = (
            select(func.max(StrategyMemory.score))
            .join(Strategy, Strategy.strategy_id == StrategyMemory.strategy_id)
            .where(
                Strategy.status == StrategyStatusEnum.active,
                StrategyMemory.event_type == "backtest_completed",
            )
        )
        if asset:
            stmt = stmt.where(StrategyMemory.asset == asset)
        if timeframe:
            stmt = stmt.where(StrategyMemory.timeframe == timeframe)
        result = await session.execute(stmt)
        value = result.scalar_one_or_none()
        return float(value or 0.0)

    async def latest_event(
        self,
        session: AsyncSession,
        strategy_id: str,
        *,
        event_types: Optional[list[str]] = None,
    ) -> Optional[StrategyMemory]:
        stmt = (
            select(StrategyMemory)
            .where(StrategyMemory.strategy_id == strategy_id)
            .order_by(desc(StrategyMemory.created_at), desc(StrategyMemory.id))
        )
        if event_types:
            stmt = stmt.where(StrategyMemory.event_type.in_(event_types))
        stmt = stmt.limit(1)
        result = await session.execute(stmt)
        return result.scalar_one_or_none()

    async def recent_backtest_scores(
        self,
        session: AsyncSession,
        strategy_id: str,
        *,
        limit: int = 3,
    ) -> list[float]:
        stmt = (
            select(StrategyMemory.score)
            .where(
                StrategyMemory.strategy_id == strategy_id,
                StrategyMemory.event_type == "backtest_completed",
                StrategyMemory.score.is_not(None),
            )
            .order_by(desc(StrategyMemory.created_at), desc(StrategyMemory.id))
            .limit(limit)
        )
        result = await session.execute(stmt)
        return [float(v or 0.0) for v in result.scalars().all()]

    async def record_event(
        self,
        session: AsyncSession,
        *,
        strategy: Strategy,
        asset: str,
        timeframe: str,
        event_type: str,
        lifecycle_state: Optional[str] = None,
        score: Optional[float] = None,
        metrics: Optional[Dict[str, Any]] = None,
        params: Optional[Dict[str, Any]] = None,
        reason: Optional[str] = None,
    ) -> StrategyMemory:
        metrics_json = json.dumps(_json_safe(metrics or {})) if metrics else None
        params_json = json.dumps(_json_safe(params or {})) if params else None
        row = StrategyMemory(
            strategy_id=strategy.strategy_id,
            asset=asset,
            timeframe=timeframe,
            event_type=event_type,
            lifecycle_state=lifecycle_state,
            score=score,
            sharpe=(metrics or {}).get("sharpe"),
            profit_factor=(metrics or {}).get("profit_factor"),
            expectancy=(metrics or {}).get("expectancy"),
            max_drawdown=(metrics or {}).get("max_drawdown"),
            win_rate=(metrics or {}).get("win_rate"),
            total_trades=(metrics or {}).get("total_trades"),
            oos_sharpe=(metrics or {}).get("oos_sharpe"),
            oos_profit_factor=(metrics or {}).get("oos_profit_factor"),
            params_json=params_json,
            metrics_json=metrics_json,
            reason=normalize_event_reason(reason),
            created_at=now_sao_paulo(),
        )
        session.add(row)
        await session.flush()
        return row

    async def latest_state(self, session: AsyncSession, strategy_id: str) -> Optional[StrategyMemory]:
        stmt = (
            select(StrategyMemory)
            .where(StrategyMemory.strategy_id == strategy_id)
            .order_by(desc(StrategyMemory.created_at), desc(StrategyMemory.id))
            .limit(1)
        )
        result = await session.execute(stmt)
        return result.scalar_one_or_none()

    async def leaderboard(
        self,
        session: AsyncSession,
        *,
        asset: Optional[str] = None,
        timeframe: Optional[str] = None,
        limit: int = 10,
    ) -> List[StrategyMemory]:
        latest_subq = (
            select(
                StrategyMemory.strategy_id,
                func.max(StrategyMemory.created_at).label("max_created_at"),
            )
            .where(StrategyMemory.event_type == "backtest_completed")
        )
        if asset:
            latest_subq = latest_subq.where(StrategyMemory.asset == asset)
        if timeframe:
            latest_subq = latest_subq.where(StrategyMemory.timeframe == timeframe)
        latest_subq = latest_subq.group_by(StrategyMemory.strategy_id).subquery()

        stmt = (
            select(StrategyMemory)
            .join(
                latest_subq,
                (StrategyMemory.strategy_id == latest_subq.c.strategy_id)
                & (StrategyMemory.created_at == latest_subq.c.max_created_at),
            )
            .order_by(
                desc(StrategyMemory.score),
                desc(StrategyMemory.created_at),
            )
            .limit(limit)
        )
        result = await session.execute(stmt)
        return list(result.scalars().all())

    async def recent_failed_signatures(
        self,
        session: AsyncSession,
        *,
        asset: Optional[str] = None,
        timeframe: Optional[str] = None,
        limit: int = 25,
    ) -> set[str]:
        stmt = (
            select(StrategyMemory.params_json)
            .where(StrategyMemory.event_type.in_(["rejected", "degraded", "retired"]))
            .order_by(desc(StrategyMemory.created_at))
            .limit(limit)
        )
        if asset:
            stmt = stmt.where(StrategyMemory.asset == asset)
        if timeframe:
            stmt = stmt.where(StrategyMemory.timeframe == timeframe)
        result = await session.execute(stmt)
        sigs: set[str] = set()
        for row in result.scalars().all():
            if not row:
                continue
            try:
                params = json.loads(row)
            except Exception:
                continue
            sigs.add(strategy_signature(params))
        return sigs

    async def load_winners(
        self,
        session: AsyncSession,
        *,
        asset: Optional[str] = None,
        timeframe: Optional[str] = None,
        limit: int = 5,
    ) -> List[Dict[str, Any]]:
        leaderboard = await self.leaderboard(session, asset=asset, timeframe=timeframe, limit=limit)
        winners: List[Dict[str, Any]] = []
        for row in leaderboard:
            if row.score is None or row.score <= 0:
                continue
            params = {}
            if row.params_json:
                try:
                    params = json.loads(row.params_json)
                except Exception:
                    params = {}
            winners.append(
                {
                    "strategy_id": row.strategy_id,
                    "asset": row.asset,
                    "timeframe": row.timeframe,
                    "params": params,
                    "score": row.score,
                    "sharpe": row.sharpe or 0.0,
                    "profit_factor": row.profit_factor or 0.0,
                    "win_rate": row.win_rate or 0.0,
                    "total_trades": row.total_trades or 0,
                    "lifecycle_state": row.lifecycle_state,
                    "reason": row.reason or "",
                }
            )
        return winners

    async def promotion_diagnostics(
        self,
        session: AsyncSession,
        *,
        asset: Optional[str] = None,
        timeframe: Optional[str] = None,
        strategy_id: Optional[str] = None,
    ) -> Dict[str, Any]:
        leaderboard = await self.leaderboard(session, asset=asset, timeframe=timeframe, limit=5)
        best_active_score = await self.best_active_score(session, asset=asset, timeframe=timeframe)
        best_proven_score = await self.best_proven_score(session, asset=asset, timeframe=timeframe)
        target = None
        if strategy_id:
            for row in leaderboard:
                if row.strategy_id == strategy_id:
                    target = row
                    break
        if target is None and leaderboard:
            target = leaderboard[0]

        if target is None:
            return {
                "baseline_current_active_score": best_active_score,
                "baseline_proven_score": best_proven_score,
                "target": None,
                "gates": [],
                "blockers": ["no strategy found"],
            }

        from app.backtest.runner import BacktestMetrics
        from app.config import settings
        from app.research.lab import _is_weak_enough_to_deprecate

        metrics = BacktestMetrics(
            sharpe=float(target.sharpe or 0.0),
            profit_factor=float(target.profit_factor or 0.0),
            expectancy=float(target.expectancy or 0.0),
            max_drawdown=float(target.max_drawdown or 0.0),
            win_rate=float(target.win_rate or 0.0),
            total_trades=int(target.total_trades or 0),
            oos_sharpe=float(target.oos_sharpe or 0.0),
            oos_profit_factor=float(target.oos_profit_factor or 0.0),
            is_overfit=False,
        )
        trade_floor = max(1, settings.min_trades_for_promotion - max(0, int(settings.promotion_min_trade_margin)))
        score = float(target.score or 0.0)
        baseline = best_active_score or best_proven_score
        score_floor = max(settings.promotion_min_sharpe, baseline * 1.01 if baseline > 0 else settings.promotion_min_sharpe)
        gates = {
            "score": score >= score_floor,
            "trades": metrics.total_trades >= trade_floor,
            "profit_factor": metrics.profit_factor >= settings.promotion_min_pf,
            "max_drawdown": metrics.max_drawdown <= 0.30,
            "oos_consistency": metrics.oos_sharpe >= (metrics.sharpe * settings.oos_min_sharpe_ratio if metrics.sharpe else 0.0),
            "not_overfit": not metrics.is_overfit,
        }
        blockers = []
        if not gates["score"]:
            blockers.append(f"score {score:.3f} below floor {score_floor:.3f}")
        if not gates["trades"]:
            blockers.append(f"trades {metrics.total_trades} below floor {trade_floor}")
        if not gates["profit_factor"]:
            blockers.append(f"profit factor {metrics.profit_factor:.3f} below floor {settings.promotion_min_pf:.3f}")
        if not gates["max_drawdown"]:
            blockers.append(f"max drawdown {metrics.max_drawdown:.3f} above limit 0.300")
        if not gates["oos_consistency"]:
            blockers.append("OOS consistency below threshold")
        if not gates["not_overfit"]:
            blockers.append("candidate marked overfit")

        return {
            "baseline_current_active_score": best_active_score,
            "baseline_proven_score": baseline,
            "target": {
                "strategy_id": target.strategy_id,
                "asset": target.asset,
                "timeframe": target.timeframe,
                "score": score,
                "sharpe": metrics.sharpe,
                "profit_factor": metrics.profit_factor,
                "max_drawdown": metrics.max_drawdown,
                "win_rate": metrics.win_rate,
                "total_trades": metrics.total_trades,
                "oos_sharpe": metrics.oos_sharpe,
                "oos_profit_factor": metrics.oos_profit_factor,
                "lifecycle_state": target.lifecycle_state,
                "reason": target.reason,
            },
            "gates": gates,
            "blockers": blockers,
            "closest_to_promotion": not blockers,
            "weak_to_deprecate": _is_weak_enough_to_deprecate(metrics, score, baseline),
            "current_active_score": best_active_score,
        }

    async def record_evolution_cycle(
        self,
        session: AsyncSession,
        *,
        asset: str,
        timeframe: str,
        cycle_at,
        baseline_active_strategy_id: Optional[str],
        baseline_active_score: Optional[float],
        top_candidate_strategy_id: Optional[str],
        top_candidate_score: Optional[float],
        promotion_attempted: bool,
        promotion_succeeded: bool,
        promotion_blockers: Optional[list[str]] = None,
        deprecated_strategy_ids: Optional[list[str]] = None,
        competition_mode: Optional[str] = None,
        previous_active_strategy_id: Optional[str] = None,
        current_active_strategy_id: Optional[str] = None,
        leader_changed: bool = False,
        leader_change_reason: Optional[str] = None,
        promotion_diagnostics: Optional[Dict[str, Any]] = None,
    ) -> EvolutionCycle:
        row = EvolutionCycle(
            asset=asset,
            timeframe=timeframe,
            cycle_at=cycle_at,
            baseline_active_strategy_id=baseline_active_strategy_id,
            baseline_active_score=baseline_active_score,
            top_candidate_strategy_id=top_candidate_strategy_id,
            top_candidate_score=top_candidate_score,
            promotion_attempted=promotion_attempted,
            promotion_succeeded=promotion_succeeded,
            promotion_blockers_json=json.dumps(_json_safe(promotion_blockers or [])),
            deprecated_strategy_ids_json=json.dumps(_json_safe(deprecated_strategy_ids or [])),
            competition_mode=competition_mode,
            previous_active_strategy_id=previous_active_strategy_id,
            current_active_strategy_id=current_active_strategy_id,
            leader_changed=leader_changed,
            leader_change_reason=leader_change_reason,
            promotion_diagnostics_json=json.dumps(_json_safe(promotion_diagnostics or {})),
            created_at=now_sao_paulo(),
        )
        session.add(row)
        await session.flush()
        return row

    async def recent_evolution_cycles(
        self,
        session: AsyncSession,
        *,
        asset: Optional[str] = None,
        timeframe: Optional[str] = None,
        limit: int = 20,
    ) -> List[EvolutionCycle]:
        stmt = select(EvolutionCycle).order_by(desc(EvolutionCycle.cycle_at), desc(EvolutionCycle.id)).limit(limit)
        if asset:
            stmt = stmt.where(EvolutionCycle.asset == asset)
        if timeframe:
            stmt = stmt.where(EvolutionCycle.timeframe == timeframe)
        result = await session.execute(stmt)
        return list(result.scalars().all())


def mutate_variant(base: Dict[str, Any], *, seed_score: float = 0.0) -> Dict[str, Any]:
    variant = dict(base)
    variant["name"] = str(base.get("name", "strategy"))
    variant["type"] = base.get("type", "rsi")
    bump = 0.02 if seed_score > 0 else 0.05

    if variant["type"] == "rsi":
        buy = int(base.get("rsi_buy", 30))
        sell = int(base.get("rsi_sell", 70))
        variant["rsi_buy"] = max(10, min(50, buy + (1 if seed_score > 1 else -1)))
        variant["rsi_sell"] = max(50, min(90, sell + (-1 if seed_score > 1 else 1)))
        variant["tp_pct"] = round(float(base.get("tp_pct", 0.02)) * (1 + bump), 4)
        variant["sl_pct"] = round(float(base.get("sl_pct", 0.01)) * (1 - bump / 2), 4)
    elif variant["type"] == "macd":
        variant["tp_pct"] = round(float(base.get("tp_pct", 0.03)) * (1 + bump), 4)
        variant["sl_pct"] = round(float(base.get("sl_pct", 0.015)) * (1 - bump / 2), 4)
    elif variant["type"] == "vwap":
        threshold = float(base.get("vwap_threshold", 0.005))
        variant["vwap_threshold"] = round(max(0.001, threshold * (1 + (bump if seed_score > 0 else -bump))), 5)
        variant["tp_pct"] = round(float(base.get("tp_pct", 0.015)) * (1 + bump), 4)
        variant["sl_pct"] = round(float(base.get("sl_pct", 0.008)) * (1 - bump / 2), 4)
    elif variant["type"] == "vol_breakout":
        threshold = float(base.get("vol_zscore_threshold", 2.0))
        variant["vol_zscore_threshold"] = round(max(1.0, threshold * (1 + (0.1 if seed_score > 0 else -0.1))), 4)
        variant["tp_pct"] = round(float(base.get("tp_pct", 0.04)) * (1 + bump), 4)
        variant["sl_pct"] = round(float(base.get("sl_pct", 0.02)) * (1 - bump / 2), 4)
    elif variant["type"] == "ma_cross":
        variant["tp_pct"] = round(float(base.get("tp_pct", 0.03)) * (1 + bump), 4)
        variant["sl_pct"] = round(float(base.get("sl_pct", 0.015)) * (1 - bump / 2), 4)
        if "fast_period" in base and "slow_period" in base:
            variant["fast_period"] = max(3, int(base["fast_period"]) - 1)
            variant["slow_period"] = max(int(variant["fast_period"]) + 2, int(base["slow_period"]) + 1)
    elif variant["type"] == "funding":
        variant["funding_threshold"] = round(float(base.get("funding_threshold", 0.0001)) * (1 + bump), 6)
        variant["tp_pct"] = round(float(base.get("tp_pct", 0.025)) * (1 + bump), 4)
        variant["sl_pct"] = round(float(base.get("sl_pct", 0.012)) * (1 - bump / 2), 4)

    variant["name"] = f"{variant['name']}_m{strategy_signature(variant)[:4]}"
    return variant
