from __future__ import annotations

import json
import logging
from datetime import datetime, timezone
from typing import Dict, List, Optional, Tuple

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.db.models import DirectionEnum, OHLCVBar, Signal, Strategy, StrategyStatusEnum
from app.db.session import AsyncSessionLocal
from app.features.engine import FeatureEngine
from app.llm.client import generate_signal_narrative
from app.regime.detector import RegimeDetector
from app.registry.strategies import StrategyRegistry
from app.risk.engine import PortfolioState, RiskEngine, SignalInput
from app.signals.rag import RagStore

logger = logging.getLogger(__name__)

feature_engine = FeatureEngine()
regime_detector = RegimeDetector()
strategy_registry = StrategyRegistry()
risk_engine = RiskEngine()
rag_store = RagStore()


def _apply_strategy_logic(
    features: Dict[str, float],
    strategy: Optional[Strategy],
    regime: Optional[str],
) -> Tuple[DirectionEnum, float]:
    """Generate raw direction and confidence from features + strategy params."""
    if strategy is None:
        return DirectionEnum.NO_TRADE, 0.0

    params = {}
    if strategy.params_json:
        try:
            params = json.loads(strategy.params_json)
        except Exception:
            pass

    allowed_regimes = params.get("regime", [])
    if allowed_regimes and regime and regime not in allowed_regimes:
        return DirectionEnum.NO_TRADE, 0.0

    strategy_type = params.get("type", "rsi")
    rsi = features.get("rsi_14", 50.0)
    macd_hist = features.get("macd_hist", 0.0)
    ma_dist_20 = features.get("ma_dist_20", 0.0)
    vol_zscore = features.get("volume_zscore", 0.0)
    funding_delta = features.get("funding_delta", 0.0)
    returns_1 = features.get("returns_1", 0.0)
    vwap = features.get("vwap", 0.0)

    direction = DirectionEnum.NO_TRADE
    confidence = 0.0

    if strategy_type == "rsi":
        rsi_buy = params.get("rsi_buy", 30)
        rsi_sell = params.get("rsi_sell", 70)
        if rsi < rsi_buy:
            direction = DirectionEnum.LONG
            confidence = min(1.0, (rsi_buy - rsi) / rsi_buy)
        elif rsi > rsi_sell:
            direction = DirectionEnum.SHORT
            confidence = min(1.0, (rsi - rsi_sell) / (100 - rsi_sell))

    elif strategy_type == "macd":
        if macd_hist > 0:
            direction = DirectionEnum.LONG
            confidence = min(1.0, abs(macd_hist) / 100)
        elif macd_hist < 0:
            direction = DirectionEnum.SHORT
            confidence = min(1.0, abs(macd_hist) / 100)

    elif strategy_type == "vwap":
        threshold = params.get("vwap_threshold", 0.005)
        if vwap > 0:
            dist = (features.get("close", vwap) - vwap) / vwap
            if dist < -threshold:
                direction = DirectionEnum.LONG
                confidence = min(1.0, abs(dist) / threshold)
            elif dist > threshold:
                direction = DirectionEnum.SHORT
                confidence = min(1.0, dist / threshold)

    elif strategy_type == "vol_breakout":
        threshold = params.get("vol_zscore_threshold", 2.0)
        if vol_zscore > threshold:
            if returns_1 > 0:
                direction = DirectionEnum.LONG
                confidence = min(1.0, vol_zscore / (threshold * 2))
            elif returns_1 < 0:
                direction = DirectionEnum.SHORT
                confidence = min(1.0, vol_zscore / (threshold * 2))

    elif strategy_type == "ma_cross":
        if ma_dist_20 > 0:
            direction = DirectionEnum.LONG
            confidence = min(1.0, abs(ma_dist_20) * 10)
        elif ma_dist_20 < 0:
            direction = DirectionEnum.SHORT
            confidence = min(1.0, abs(ma_dist_20) * 10)

    elif strategy_type == "funding":
        threshold = params.get("funding_threshold", 0.0001)
        if funding_delta > threshold:
            direction = DirectionEnum.LONG
            confidence = min(1.0, funding_delta / (threshold * 5))
        elif funding_delta < -threshold:
            direction = DirectionEnum.SHORT
            confidence = min(1.0, abs(funding_delta) / (threshold * 5))

    return direction, float(confidence)


async def _update_rag_with_realized_outcome(
    asset: str,
    timeframe: str,
    current_price: float,
    session: AsyncSession,
) -> None:
    """
    Look up the most recent previous signal for this asset and compute its
    realized return. Store that outcome in the RAG vector store so future
    retrievals carry real trade outcomes (not zeros).
    """
    try:
        from sqlalchemy import desc as _desc
        stmt = (
            select(Signal)
            .where(
                Signal.asset == asset,
                Signal.timeframe == timeframe,
                Signal.direction != DirectionEnum.NO_TRADE,
                Signal.entry_price.is_not(None),
            )
            .order_by(_desc(Signal.timestamp))
            .limit(1)
        )
        result = await session.execute(stmt)
        prev_signal = result.scalar_one_or_none()

        if prev_signal and prev_signal.entry_price and prev_signal.entry_price > 0:
            dir_int = 1 if prev_signal.direction == DirectionEnum.LONG else -1
            realized_ret = (current_price - prev_signal.entry_price) / prev_signal.entry_price * dir_int
            outcome_str = "win" if realized_ret > 0 else "loss"
            rr = abs(realized_ret) / max(
                abs((prev_signal.sl or prev_signal.entry_price) - prev_signal.entry_price) / prev_signal.entry_price,
                0.001,
            )
            if realized_ret < 0:
                rr = -rr

            await rag_store.store_state(
                asset=asset,
                timeframe=timeframe,
                timestamp=prev_signal.timestamp,
                features={},  # embedding already stored; we update outcome only
                outcome=round(rr, 4),
            )
            logger.debug(
                "Updated RAG outcome for %s prev signal: ret=%.3f%% outcome=%s",
                asset, realized_ret * 100, outcome_str,
            )
    except Exception as exc:
        logger.debug("RAG outcome update failed (non-fatal): %s", exc)


class SignalEngine:
    async def generate_signal(
        self,
        asset: str,
        timeframe: str,
        portfolio_state: Optional[PortfolioState] = None,
    ) -> Signal:
        if portfolio_state is None:
            portfolio_state = PortfolioState()

        async with AsyncSessionLocal() as session:
            # 1. Get latest features
            features = await feature_engine.get_latest_features(session, asset, timeframe)

            # 2. Get current regime
            regime_obj = await regime_detector.get_latest_regime(session, asset, timeframe)
            current_regime = regime_obj.regime.value if regime_obj else None

            # 3. Get active strategy (fallback chain: active → candidate → draft)
            active_strategy = None
            active_strategies = await strategy_registry.get_active_strategies(session)
            active_strategy = active_strategies[0] if active_strategies else None

            if active_strategy is None:
                candidates = await strategy_registry.get_candidates(session)
                active_strategy = candidates[0] if candidates else None

            if active_strategy is None:
                from sqlalchemy import select as sa_select
                draft_stmt = sa_select(Strategy).where(
                    Strategy.status == StrategyStatusEnum.draft
                ).order_by(Strategy.created_at.desc()).limit(5)
                draft_result = await session.execute(draft_stmt)
                drafts = list(draft_result.scalars().all())
                for d in drafts:
                    p = json.loads(d.params_json) if d.params_json else {}
                    allowed = p.get("regime", [])
                    if not allowed or not current_regime or current_regime in allowed:
                        active_strategy = d
                        break
                if active_strategy is None and drafts:
                    active_strategy = drafts[0]

            # 4. Generate raw direction from strategy logic
            direction, confidence = _apply_strategy_logic(features, active_strategy, current_regime)

            # 5. Get entry price from OHLCV (features table doesn't store close)
            entry_price = features.get("close", 0.0)
            if entry_price == 0.0:
                from sqlalchemy import select as _sa_select, desc as _desc
                bar_stmt = _sa_select(OHLCVBar).where(
                    OHLCVBar.asset == asset, OHLCVBar.timeframe == timeframe
                ).order_by(_desc(OHLCVBar.timestamp)).limit(1)
                bar_result = await session.execute(bar_stmt)
                latest_bar = bar_result.scalar_one_or_none()
                if latest_bar:
                    entry_price = latest_bar.close

            # 6. Update RAG with realized outcome of previous signal (best-effort)
            if entry_price > 0:
                await _update_rag_with_realized_outcome(asset, timeframe, entry_price, session)

            # 7. Retrieve similar past setups from RAG
            similar_states = rag_store.retrieve_similar(features, top_k=3, asset_filter=asset)
            rag_context = rag_store.build_rag_context(similar_states)

            # 8. Compute ATR-based TP/SL
            atr = features.get("atr_14", entry_price * 0.01 if entry_price > 0 else 100.0)
            tp1 = tp2 = sl = None
            if direction != DirectionEnum.NO_TRADE and entry_price > 0:
                dir_int = 1 if direction == DirectionEnum.LONG else -1
                tp1, tp2, sl = risk_engine.calculate_tp_sl(
                    entry_price=entry_price,
                    direction=dir_int,
                    atr=atr,
                )

            # 9. Risk filter (veto check)
            if direction != DirectionEnum.NO_TRADE and tp1 is not None and sl is not None:
                sig_input = SignalInput(
                    asset=asset,
                    direction=direction.value,
                    entry_price=entry_price,
                    tp_price=tp1,
                    sl_price=sl,
                    confidence=confidence,
                )
                # Duplicate signal guard
                if risk_engine.is_duplicate(sig_input, settings.signal_cooldown_seconds):
                    logger.info(
                        "Duplicate signal suppressed for %s/%s (%s) — within cooldown",
                        asset, timeframe, direction.value,
                    )
                    direction = DirectionEnum.NO_TRADE
                    confidence = 0.0
                elif not risk_engine.check_signal(sig_input, portfolio_state):
                    direction = DirectionEnum.NO_TRADE
                    confidence = 0.0
                else:
                    risk_engine.record_signal(sig_input)

            # 10. Build LLM narrative (Ollama phi3:mini, fallback to template)
            explanation = await generate_signal_narrative(
                asset=asset,
                timeframe=timeframe,
                direction=direction.value,
                confidence=confidence,
                regime=current_regime,
                features=features,
                similar_past=similar_states or [],
                strategy_name=active_strategy.name if active_strategy else None,
            )

            # 11. Persist signal
            now = datetime.now(tz=timezone.utc)
            signal = Signal(
                asset=asset,
                timeframe=timeframe,
                timestamp=now,
                direction=direction,
                confidence=confidence,
                entry_price=entry_price if entry_price > 0 else None,
                tp1=tp1,
                tp2=tp2,
                sl=sl,
                regime=current_regime,
                rag_context=rag_context,
                explanation=explanation,
                strategy_id=active_strategy.id if active_strategy else None,
            )
            session.add(signal)
            await session.commit()
            await session.refresh(signal)

            # 12. Store current state in RAG for future retrieval (best-effort)
            try:
                await rag_store.store_state(
                    asset=asset,
                    timeframe=timeframe,
                    timestamp=now,
                    features=features,
                    outcome=0.0,
                )
            except Exception as rag_exc:
                logger.warning("RAG store_state failed (non-fatal): %s", rag_exc)

            logger.info(
                "Signal %s/%s: %s conf=%.3f entry=%.4f",
                asset, timeframe, direction.value, confidence, entry_price,
            )
            return signal

    async def generate_all_signals(self, timeframe: str = "1h") -> List[Signal]:
        from app.config import settings as _settings
        from app.execution.paper_trader import load_portfolio_state_from_redis

        signals = []
        # Load real portfolio state from Redis (paper trader) so risk engine
        # enforces live exposure limits rather than always-empty state.
        try:
            portfolio_state = await load_portfolio_state_from_redis()
        except Exception as exc:
            logger.warning("Could not load portfolio state from Redis: %s — using empty", exc)
            portfolio_state = PortfolioState()

        for asset in _settings.assets:
            try:
                sig = await self.generate_signal(asset, timeframe, portfolio_state)
                signals.append(sig)
            except Exception as exc:
                logger.error("Error generating signal %s/%s: %s", asset, timeframe, exc)

        return signals
