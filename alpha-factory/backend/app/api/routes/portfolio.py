from __future__ import annotations

from datetime import datetime, timezone
from typing import List

from fastapi import APIRouter

from app.api.schemas import PortfolioPosition, PortfolioResponse

router = APIRouter(prefix="/portfolio", tags=["portfolio"])

# Mock portfolio data — the real positions come from the main Next.js/invest-tracker app
MOCK_POSITIONS: List[PortfolioPosition] = [
    PortfolioPosition(
        asset="BTC/USDT",
        direction="LONG",
        entry_price=62000.0,
        current_price=65000.0,
        size=0.1,
        pnl=300.0,
        pnl_pct=0.0484,
    ),
    PortfolioPosition(
        asset="ETH/USDT",
        direction="LONG",
        entry_price=3200.0,
        current_price=3450.0,
        size=1.5,
        pnl=375.0,
        pnl_pct=0.0781,
    ),
]


@router.get("", response_model=PortfolioResponse)
async def get_portfolio():
    """
    Portfolio overview. Returns mock data in standalone mode.
    Connect to the main invest-tracker portfolio API for real positions.
    """
    total_pnl = sum(p.pnl for p in MOCK_POSITIONS)
    invested = sum(p.entry_price * p.size for p in MOCK_POSITIONS)
    total_value = invested + total_pnl
    cash = 5000.0

    return PortfolioResponse(
        total_value=total_value + cash,
        cash=cash,
        invested=invested,
        daily_pnl=total_pnl * 0.3,  # mock: 30% of total pnl is "today"
        daily_pnl_pct=(total_pnl * 0.3) / (total_value + cash),
        total_pnl=total_pnl,
        total_pnl_pct=total_pnl / invested if invested > 0 else 0.0,
        positions=MOCK_POSITIONS,
        timestamp=datetime.now(tz=timezone.utc),
    )
