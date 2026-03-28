from __future__ import annotations

import logging
from dataclasses import dataclass, field
from typing import Dict, List, Optional

from app.config import settings

logger = logging.getLogger(__name__)


@dataclass
class PortfolioState:
    capital: float = 10000.0
    daily_pnl: float = 0.0
    total_exposure: float = 0.0  # fraction of capital
    open_positions: List[Dict] = field(default_factory=list)


@dataclass
class SignalInput:
    asset: str
    direction: str  # LONG / SHORT
    entry_price: float
    tp_price: float
    sl_price: float
    confidence: float = 0.5


class RiskEngine:
    def __init__(self) -> None:
        self.max_exposure = settings.risk_max_exposure
        self.daily_loss_limit = settings.risk_daily_loss_limit
        self.min_rr = settings.risk_min_rr

    def compute_rr(self, signal: SignalInput) -> float:
        """Risk:Reward ratio — reward / risk."""
        risk = abs(signal.entry_price - signal.sl_price)
        reward = abs(signal.tp_price - signal.entry_price)
        if risk <= 1e-9:
            return 0.0
        return reward / risk

    def check_correlation(
        self,
        signal: SignalInput,
        open_positions: List[Dict],
        threshold: float = 0.7,
    ) -> bool:
        """
        Returns True if it's OK to take the trade (not too correlated).
        Simple heuristic: count same-direction trades in same asset family.
        """
        base_asset = signal.asset.split("/")[0]
        correlated_count = 0
        for pos in open_positions:
            pos_base = pos.get("asset", "").split("/")[0]
            if pos_base == base_asset and pos.get("direction") == signal.direction:
                correlated_count += 1

        return correlated_count < 2  # Allow at most 1 correlated position

    def check_signal(self, signal: SignalInput, portfolio: PortfolioState) -> bool:
        """
        Returns True if the signal passes all risk checks, False (veto) otherwise.
        """
        # 1. Daily loss limit
        daily_loss_pct = abs(min(portfolio.daily_pnl, 0)) / max(portfolio.capital, 1.0)
        if daily_loss_pct >= self.daily_loss_limit:
            logger.warning(
                "Signal VETOED: daily loss %.2f%% >= limit %.2f%%",
                daily_loss_pct * 100,
                self.daily_loss_limit * 100,
            )
            return False

        # 2. Total exposure limit
        if portfolio.total_exposure >= self.max_exposure:
            logger.warning(
                "Signal VETOED: total exposure %.2f%% >= limit %.2f%%",
                portfolio.total_exposure * 100,
                self.max_exposure * 100,
            )
            return False

        # 3. Risk:Reward check
        rr = self.compute_rr(signal)
        if rr < self.min_rr:
            logger.debug(
                "Signal VETOED: RR %.2f < min %.2f for %s", rr, self.min_rr, signal.asset
            )
            return False

        # 4. Correlation filter
        if not self.check_correlation(signal, portfolio.open_positions):
            logger.debug("Signal VETOED: too many correlated positions for %s", signal.asset)
            return False

        return True

    def position_size(
        self,
        capital: float,
        atr: float,
        risk_pct: float = 0.01,
    ) -> float:
        """
        Kelly-lite position sizing: risk_pct * capital / atr.
        Returns dollar amount to risk.
        """
        if atr <= 1e-9:
            return capital * risk_pct * 0.01  # minimal fallback
        size = (risk_pct * capital) / atr
        # Cap at 10% of capital per trade
        max_size = capital * 0.10
        return min(size, max_size)

    def calculate_tp_sl(
        self,
        entry_price: float,
        direction: int,
        atr: float,
        tp_multiplier: float = 2.0,
        sl_multiplier: float = 1.0,
    ) -> tuple[float, float, float]:
        """
        Calculate TP1, TP2, and SL prices from ATR.

        Returns (tp1, tp2, sl)
        """
        atr_adj = atr if atr > 0 else entry_price * 0.01
        tp1 = entry_price + direction * atr_adj * tp_multiplier
        tp2 = entry_price + direction * atr_adj * tp_multiplier * 1.5
        sl = entry_price - direction * atr_adj * sl_multiplier
        return float(tp1), float(tp2), float(sl)
