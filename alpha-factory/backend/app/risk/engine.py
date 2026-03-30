from __future__ import annotations

import logging
import time
from dataclasses import dataclass, field
from typing import Dict, List, Optional

from app.config import settings

logger = logging.getLogger(__name__)


@dataclass
class PortfolioState:
    capital: float = 10000.0
    daily_pnl: float = 0.0
    total_exposure: float = 0.0  # fraction of capital currently deployed
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
        self.position_size_pct = settings.risk_position_size_pct
        # In-process duplicate signal guard: asset → (direction, epoch_ts)
        self._last_signal: Dict[str, tuple] = {}

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
        threshold: int = 2,
    ) -> bool:
        """Reject if too many same-direction positions in same asset family."""
        base_asset = signal.asset.split("/")[0]
        count = sum(
            1
            for pos in open_positions
            if pos.get("asset", "").split("/")[0] == base_asset
            and (pos.get("direction") or pos.get("side")) == signal.direction
        )
        return count < threshold

    def is_duplicate(self, signal: SignalInput, cooldown_seconds: int = 1800) -> bool:
        """
        Return True if we already generated the same direction for this asset
        within cooldown_seconds. Prevents identical signal floods.
        """
        key = signal.asset
        now = time.monotonic()
        if key in self._last_signal:
            prev_direction, prev_ts = self._last_signal[key]
            if prev_direction == signal.direction and (now - prev_ts) < cooldown_seconds:
                return True
        return False

    def record_signal(self, signal: SignalInput) -> None:
        """Record that a signal was accepted, for duplicate-guard purposes."""
        self._last_signal[signal.asset] = (signal.direction, time.monotonic())

    def check_signal(self, signal: SignalInput, portfolio: PortfolioState) -> bool:
        """
        Returns True if the signal passes ALL risk checks.
        Checks (in order): daily loss limit, exposure limit, R:R, correlation.
        Does NOT check for duplicates (call is_duplicate separately).
        """
        # 1. Daily loss limit
        daily_loss_pct = abs(min(portfolio.daily_pnl, 0)) / max(portfolio.capital, 1.0)
        if daily_loss_pct >= self.daily_loss_limit:
            logger.warning(
                "Signal VETOED %s: daily loss %.2f%% >= limit %.2f%%",
                signal.asset, daily_loss_pct * 100, self.daily_loss_limit * 100,
            )
            return False

        # 2. Total exposure limit
        if portfolio.total_exposure >= self.max_exposure:
            logger.warning(
                "Signal VETOED %s: exposure %.2f%% >= limit %.2f%%",
                signal.asset, portfolio.total_exposure * 100, self.max_exposure * 100,
            )
            return False

        # 3. Directional Delta (LONG - SHORT)
        def _position_direction(pos: Dict) -> Optional[str]:
            return pos.get("direction") or pos.get("side")

        longs = sum(float(p.get("size", 0.0) or 0.0) for p in portfolio.open_positions if _position_direction(p) == "LONG")
        shorts = sum(float(p.get("size", 0.0) or 0.0) for p in portfolio.open_positions if _position_direction(p) == "SHORT")
        net_delta = (longs - shorts) / max(portfolio.capital, 1.0)
        
        # If signal is LONG and we are already too LONG, veto
        if signal.direction == "LONG" and net_delta >= settings.risk_max_directional_delta:
             logger.warning("Signal VETOED %s: Too LONG (delta %.2f)", signal.asset, net_delta)
             return False
        # If signal is SHORT and we are already too SHORT, veto
        if signal.direction == "SHORT" and net_delta <= -settings.risk_max_directional_delta:
             logger.warning("Signal VETOED %s: Too SHORT (delta %.2f)", signal.asset, net_delta)
             return False

        # 4. Max positions per asset
        asset_count = sum(1 for p in portfolio.open_positions if p.get("asset") == signal.asset)
        if asset_count >= settings.risk_max_positions_per_asset:
            logger.warning("Signal VETOED %s: Max positions reached (%d)", signal.asset, asset_count)
            return False

        # 5. Risk:Reward
        rr = self.compute_rr(signal)
        if rr < self.min_rr:
            logger.debug(
                "Signal VETOED %s: R:R %.2f < min %.2f", signal.asset, rr, self.min_rr
            )
            return False

        # 6. Correlation filter
        if not self.check_correlation(signal, portfolio.open_positions):
            logger.debug(
                "Signal VETOED %s: too many correlated positions", signal.asset
            )
            return False

        return True

    def position_size(
        self,
        capital: float,
        atr: float,
        risk_pct: Optional[float] = None,
    ) -> float:
        """
        Kelly-lite position sizing: risk_pct * capital / atr.
        Returns dollar amount to risk (capped at 10% of capital).
        """
        if risk_pct is None:
            risk_pct = self.position_size_pct
        if atr <= 1e-9:
            return capital * risk_pct * 0.1  # minimal fallback
        size = (risk_pct * capital) / atr
        return min(size, capital * 0.10)

    def calculate_tp_sl(
        self,
        entry_price: float,
        direction: int,
        atr: float,
        tp_multiplier: float = 2.0,
        sl_multiplier: float = 1.0,
    ) -> tuple[float, float, float]:
        """
        Calculate TP1, TP2, SL from ATR multiples.
        Returns (tp1, tp2, sl).
        """
        atr_adj = atr if atr > 0 else entry_price * 0.01
        tp1 = entry_price + direction * atr_adj * tp_multiplier
        tp2 = entry_price + direction * atr_adj * tp_multiplier * 1.5
        sl = entry_price - direction * atr_adj * sl_multiplier
        return float(tp1), float(tp2), float(sl)
