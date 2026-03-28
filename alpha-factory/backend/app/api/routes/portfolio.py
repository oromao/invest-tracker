from __future__ import annotations
from fastapi import APIRouter
from app.api.schemas import PortfolioOut, PortfolioPosition

router = APIRouter(prefix="/portfolio", tags=["portfolio"])


@router.get("", response_model=PortfolioOut)
async def get_portfolio():
    """
    Portfolio state. Currently returns mock data.
    Connect to the main invest-tracker portfolio API for real positions.
    """
    return PortfolioOut(
        total_value=0.0,
        open_pnl=0.0,
        daily_pnl=0.0,
        positions=[],
    )
