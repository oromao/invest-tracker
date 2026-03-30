from __future__ import annotations

import json
import logging
from typing import Dict, List, Optional, Tuple

from sqlalchemy import select, desc
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import (
    BacktestRun, 
    DirectionEnum, 
    Signal, 
    StrategyVersion, 
    StrategyVersionStatusEnum,
    MarketRegime
)
from app.db.session import AsyncSessionLocal
from app.features.engine import MarketFeatureEngine
from app.regime.detector import RegimeDetector
from app.registry.strategies import StrategyVersionRegistry
from app.risk.engine import RiskEngine, SignalInput, PortfolioState
from app.signals.rag import RagStore
from app.signals.engine import _apply_strategy_logic
from app.shared.time import now_sao_paulo

logger = logging.getLogger(__name__)

class MetaStrategyEnsemble:
    def __init__(self):
        self.feature_engine = MarketFeatureEngine()
        self.regime_detector = RegimeDetector()
        self.strategy_registry = StrategyVersionRegistry()
        self.risk_engine = RiskEngine()
        self.rag_store = RagStore()

    async def get_strategy_performance_weights(
        self, session: AsyncSession, strategy_versions: List[StrategyVersion]
    ) -> Dict[int, float]:
        """
        Calculate weights based on profit_factor and sharpe from latest backtest.
        """
        weights = {}
        for strat in strategy_versions:
            # Get latest backtest run for this strategy
            stmt = (
                select(BacktestRun)
                .where(BacktestRun.strategy_id == strat.id)
                .order_by(desc(BacktestRun.run_at))
                .limit(1)
            )
            result = await session.execute(stmt)
            run = result.scalars().first()
            
            if run:
                pf = run.profit_factor or 1.0
                sharpe = run.sharpe or 1.0
                # Simple heuristic: weight = pf * max(0.1, sharpe)
                weight = pf * max(0.1, sharpe)
                weights[strat.id] = weight
            else:
                weights[strat.id] = 1.0 # Default weight
                
        # Normalize weights
        total_weight = sum(weights.values())
        if total_weight > 0:
            for sid in weights:
                weights[sid] /= total_weight
                
        return weights

    def adjust_weights_by_regime(
        self, weights: Dict[int, float], strategy_versions: List[StrategyVersion], regime: Optional[str]
    ) -> Dict[int, float]:
        """
        Scale weights based on regime compatibility defined in strategy params.
        """
        if not regime:
            return weights
            
        adjusted = {}
        for strat in strategy_versions:
            try:
                params = json.loads(strat.params_json) if strat.params_json else {}
            except Exception:
                params = {}
                
            allowed_regimes = params.get("regime", [])
            
            w = weights.get(strat.id, 0.0)
            if allowed_regimes and regime in allowed_regimes:
                # Bonus for being in preferred regime
                adjusted[strat.id] = w * 1.5
            elif allowed_regimes and regime not in allowed_regimes:
                # Penalty for wrong regime
                adjusted[strat.id] = w * 0.2
            else:
                adjusted[strat.id] = w
                
        # Re-normalize
        total = sum(adjusted.values())
        if total > 0:
            for sid in adjusted:
                adjusted[sid] /= total
                
        return adjusted

    async def generate_ensemble_signal(
        self, asset: str, timeframe: str = "1h"
    ) -> Optional[Signal]:
        async with AsyncSessionLocal() as session:
            # 1. Fetch data
            market_features = await self.feature_engine.get_latest_market_features(session, asset, timeframe)
            if not market_features:
                logger.warning("No market_features found for %s/%s", asset, timeframe)
                return None
                
            regime_obj = await self.regime_detector.get_latest_regime(session, asset, timeframe)
            current_regime = regime_obj.regime.value if regime_obj else None
            
            # 2. Get active strategy_versions
            active_strats = await self.strategy_registry.get_active_strategy_versions(session)
            if not active_strats:
                # Fallback to candidates if no active
                active_strats = await self.strategy_registry.get_candidates(session)
                
            if not active_strats:
                logger.warning("No active strategy_versions found for ensemble.")
                return None

            # 3. Calculate weights
            base_weights = await self.get_strategy_performance_weights(session, active_strats)
            final_weights = self.adjust_weights_by_regime(base_weights, active_strats, current_regime)
            
            # 4. Collect individual signals
            votes = {"LONG": 0.0, "SHORT": 0.0, "NO_TRADE": 0.0}
            strategy_details = []
            
            for strat in active_strats:
                direction, confidence = _apply_strategy_logic(market_features, strat, current_regime)
                weight = final_weights.get(strat.id, 0.0)
                votes[direction.value] += weight * confidence
                
                strategy_details.append({
                    "strategy_id": strat.id,
                    "direction": direction.value,
                    "confidence": confidence,
                    "weight": weight
                })

            # 5. Determine final direction
            final_direction = DirectionEnum.NO_TRADE
            final_confidence = 0.0
            
            if votes["LONG"] > votes["SHORT"] and votes["LONG"] > 0.15:
                final_direction = DirectionEnum.LONG
                final_confidence = min(1.0, votes["LONG"])
            elif votes["SHORT"] > votes["LONG"] and votes["SHORT"] > 0.15:
                final_direction = DirectionEnum.SHORT
                final_confidence = min(1.0, votes["SHORT"])

            # 6. RAG Context & Risk Engine
            similar_states = self.rag_store.retrieve_similar(market_features, top_k=3, asset_filter=asset)
            rag_context = self.rag_store.build_rag_context(similar_states)
            
            entry_price = market_features.get("close", 0.0)
            atr = market_features.get("atr_14", entry_price * 0.01 if entry_price > 0 else 100.0)
            
            tp1, tp2, sl = None, None, None
            if final_direction != DirectionEnum.NO_TRADE and entry_price > 0:
                dir_int = 1 if final_direction == DirectionEnum.LONG else -1
                tp1, tp2, sl = self.risk_engine.calculate_tp_sl(entry_price, dir_int, atr)
                
                # Risk check
                sig_input = SignalInput(
                    asset=asset,
                    direction=final_direction.value,
                    entry_price=entry_price,
                    tp_price=tp1,
                    sl_price=sl,
                    confidence=final_confidence
                )
                if not self.risk_engine.check_signal(sig_input, PortfolioState()):
                    final_direction = DirectionEnum.NO_TRADE
                    final_confidence = 0.0

            # 7. Persist Snapshot
            reason = f"Ensemble of {len(active_strats)} strategies. Regime: {current_regime or 'Unknown'}. RAG context included."
            
            signal = Signal(
                asset=asset,
                timeframe=timeframe,
                timestamp=now_sao_paulo(),
                direction=final_direction,
                confidence=final_confidence,
                entry_price=entry_price if entry_price > 0 else None,
                sl=sl,
                tp1=tp1,
                tp2=tp1, # tp2 fallback
                regime=current_regime,
                rag_context=rag_context,
                explanation=reason,
                strategy_id=None # Ensemble doesn't have a single strategy_id
            )
            
            session.add(signal)
            await session.commit()
            await session.refresh(signal)
            
            logger.info("Ensemble Signal for %s: %s (conf=%.2f)", asset, final_direction.value, final_confidence)
            return signal

    async def run_all_assets(self, timeframe: str = "1h") -> List[Signal]:
        from app.config import settings
        results = []
        for asset in settings.assets:
            try:
                res = await self.generate_ensemble_signal(asset, timeframe)
                if res:
                    results.append(res)
            except Exception as e:
                logger.error("Failed ensemble for %s: %s", asset, e)
        return results
