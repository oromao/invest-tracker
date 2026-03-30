import logging
from typing import Dict, List, Optional

import ccxt.async_support as ccxt
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.db.models import DirectionEnum, Position, Signal, Trade
from app.db.session import async_session_factory
from app.observability.metrics import EXECUTION_ATTEMPTS, EXECUTION_ERRORS, EXECUTION_SLIPPAGE_BPS
from app.shared.time import now_sao_paulo
from app.risk.engine import RiskEngine, SignalInput, PortfolioState

logger = logging.getLogger(__name__)

class ExecutionEngine:
    def __init__(self):
        self.risk_engine = RiskEngine()
        self._exchange: Optional[ccxt.binance] = None

    async def _get_exchange(self) -> ccxt.binance:
        if self._exchange is None:
            self._exchange = ccxt.binance({
                "apiKey": settings.binance_api_key,
                "secret": settings.binance_api_secret,
                "enableRateLimit": True,
                "options": {"defaultType": "future"},
            })
        return self._exchange

    async def _fetch_portfolio_state(self, session: AsyncSession) -> PortfolioState:
        """
        Fetch real account balance and open positions for risk calc.
        """
        if settings.dry_run:
            return PortfolioState(capital=1000.0)
            
        exchange = await self._get_exchange()
        try:
            balance_data = await exchange.fetch_balance()
            # USDT Future balance
            free_usdt = float(balance_data.get('free', {}).get('USDT', 0.0))
            
            # Get local open positions for correlation/exposure checks
            stmt = select(Position).where(Position.status == "open")
            result = await session.execute(stmt)
            positions = result.scalars().all()
            
            open_pos_dicts = [
                {"asset": p.asset, "direction": p.side.value} for p in positions
            ]
            
            return PortfolioState(
                capital=free_usdt,
                open_positions=open_pos_dicts,
                total_exposure=sum(p.size * p.entry_price for p in positions) / max(free_usdt, 1.0)
            )
        except Exception as e:
            logger.error(f"Failed to fetch portfolio state: {e}")
            return PortfolioState(capital=0.0)

    async def run_execution_cycle(self):
        """Check signals and execute trades."""
        logger.info("Starting execution cycle (Dry Run: %s)", settings.dry_run)
        EXECUTION_SLIPPAGE_BPS.set(float(settings.backtest_slippage_pct * 10000))
        
        async with async_session_factory() as session:
            portfolio = await self._fetch_portfolio_state(session)
            
            for asset_symbol in settings.assets:
                # 1. Get latest Signal
                stmt = select(Signal).where(Signal.asset == asset_symbol).order_by(Signal.timestamp.desc()).limit(1)
                result = await session.execute(stmt)
                signal = result.scalar_one_or_none()
                
                if not signal: continue
                
                # Check status: ignore if too old (> 15m)
                now = now_sao_paulo()
                if (now - signal.timestamp).total_seconds() > 900:
                    continue

                # 2. Get current local position
                stmt = select(Position).where(Position.asset == asset_symbol, Position.status == "open")
                result = await session.execute(stmt)
                current_pos = result.scalars().first()
                
                # 3. Decision Logic
                if signal.direction == DirectionEnum.NO_TRADE:
                    if current_pos:
                        await self._close_position(session, current_pos, "Signal flipped to Neutral")
                elif signal.direction == DirectionEnum.LONG:
                    if not current_pos:
                        await self._open_position(session, asset_symbol, DirectionEnum.LONG, signal, portfolio)
                    elif current_pos.side == DirectionEnum.SHORT:
                        await self._close_position(session, current_pos, "Reverse Signal")
                        await self._open_position(session, asset_symbol, DirectionEnum.LONG, signal, portfolio)
                elif signal.direction == DirectionEnum.SHORT:
                    if not current_pos:
                        await self._open_position(session, asset_symbol, DirectionEnum.SHORT, signal, portfolio)
                    elif current_pos.side == DirectionEnum.LONG:
                        await self._close_position(session, current_pos, "Reverse Signal")
                        await self._open_position(session, asset_symbol, DirectionEnum.SHORT, signal, portfolio)
            
            await session.commit()

    async def _open_position(
        self, 
        session: AsyncSession, 
        asset: str, 
        side: DirectionEnum, 
        signal: Signal,
        portfolio: PortfolioState
    ):
        """Open a new position with risk-based sizing and exchange order."""
        logger.info("Opening %s on %s (Confidence: %.2f)", side.value, asset, signal.confidence)

        if not signal.entry_price or not signal.sl:
            logger.error("Signal for %s missing entry/sl. Cannot size.", asset)
            return

        # 1. Risk Check
        sig_input = SignalInput(
            asset=asset,
            direction=side.value,
            entry_price=signal.entry_price,
            tp_price=signal.tp1 or (signal.entry_price * 1.02),
            sl_price=signal.sl,
            confidence=signal.confidence
        )
        
        if not self.risk_engine.check_signal(sig_input, portfolio):
            logger.warning(f"Risk Engine VETO for {asset} {side.value}")
            return

        # 2. Calculate sizing
        # Logic: Risk 1% of capital based on distance to SL
        risk_dist = abs(signal.entry_price - signal.sl)
        size_usd = self.risk_engine.position_size(
            capital=portfolio.capital,
            atr=risk_dist, # Using distance as 'risk unit'
            risk_pct=0.01 
        )
        
        if size_usd < 10.0:
            logger.warning("Calculated size %.2f too small for %s", size_usd, asset)
            return

        qty = size_usd / signal.entry_price
        
        if settings.dry_run:
             new_pos = Position(
                asset=asset,
                side=side,
                entry_price=signal.entry_price,
                size=qty,
                status="open",
                strategy_id=signal.strategy_id
            )
             session.add(new_pos)
             EXECUTION_ATTEMPTS.labels(stage="open", result="dry_run").inc()
             logger.info("[DRY RUN] Opened position %s %s | Size: %.4f", side.value, asset, qty)
             return

        # 3. Real Execution
        exchange = await self._get_exchange()
        try:
            # Create Market Order
            order = await exchange.create_order(
                symbol=asset.replace("/", ""),
                type="market",
                side="buy" if side == DirectionEnum.LONG else "sell",
                amount=qty
            )
            
            # Record Position
            new_pos = Position(
                asset=asset,
                side=side,
                entry_price=float(order.get("price") or signal.entry_price),
                size=float(order.get("amount") or qty),
                status="open",
                strategy_id=signal.strategy_id,
                exchange_ref=str(order.get("id"))
            )
            session.add(new_pos)
            EXECUTION_ATTEMPTS.labels(stage="open", result="live").inc()
            logger.info("LIVE Order executed for %s: %s", asset, order.get("id"))
            
        except Exception as e:
            EXECUTION_ERRORS.labels(stage="open").inc()
            logger.error("Failed to execute live order for %s: %s", asset, e)

    async def _close_position(self, session: AsyncSession, pos: Position, reason: str):
        """Close an existing position."""
        logger.info("Closing position %s for %s. Reason: %s", pos.side.value, pos.asset, reason)
        
        exit_price = 0.0
        if not settings.dry_run:
            exchange = await self._get_exchange()
            try:
                order = await exchange.create_order(
                    symbol=pos.asset.replace("/", ""),
                    type="market",
                    side="sell" if pos.side == DirectionEnum.LONG else "buy",
                    amount=pos.size
                )
                exit_price = float(order.get("price") or 0.0)
                logger.info("LIVE Close Order executed for %s: %s", pos.asset, order.get("id"))
            except Exception as e:
                logger.error("Failed to close live order for %s: %s", pos.asset, e)
                return

        pos.status = "closed"
        trade = Trade(
            asset=pos.asset,
            side=pos.side,
            entry_price=pos.entry_price,
            exit_price=exit_price or pos.entry_price, # fallback
            size=pos.size,
            pnl=pos.unrealized_pnl, 
            entry_time=pos.opened_at,
            exit_time=now_sao_paulo(),
            strategy_id=str(pos.strategy_id or "ensemble")
        )
        session.add(trade)

    def _raw_to_asset(self, raw: str) -> Optional[str]:
        # Simple converter BTCUSDT -> BTC/USDT
        for a in settings.assets:
            if a.replace("/", "") == raw:
                return a
        return None

    async def sync_positions(self):
        """Reconcile local database positions with the actual exchange state."""
        if settings.dry_run:
            logger.debug("Position sync skipped in dry_run mode.")
            return

        logger.info("Synchronizing positions with exchange...")
        async with async_session_factory() as session:
            try:
                # 1. Fetch local open positions
                stmt = select(Position).where(Position.status == "open")
                result = await session.execute(stmt)
                local_positions = {p.asset: p for p in result.scalars().all()}

                # 2. Fetch exchange positions
                exchange = await self._get_exchange()
                balance = await exchange.fetch_balance()
                
                # Binance Futures specific structure: balance['info']['positions']
                positions_info = balance.get('info', {}).get('positions', [])
                
                exchange_assets = set()
                for p_info in positions_info:
                    amt = float(p_info.get('positionAmt', 0.0))
                    if amt == 0:
                        continue
                    
                    raw_symbol = p_info.get('symbol', '')
                    asset = self._raw_to_asset(raw_symbol)
                    if not asset:
                        continue
                    
                    exchange_assets.add(asset)
                    
                    # If position exists on exchange but not in DB, log warning
                    if asset not in local_positions:
                        logger.warning("Untracked position found on exchange: %s (Size: %.4f)", asset, amt)
                
                # 3. Close positions in DB that was closed on exchange
                for asset, local_pos in local_positions.items():
                    if asset not in exchange_assets:
                        logger.warning("Position for %s found in DB but not on exchange. Marking as closed.", asset)
                        local_pos.status = "closed"
                        
                        # Create a trade record for the "missing" close to maintain history
                        trade = Trade(
                            asset=local_pos.asset,
                            side=local_pos.side,
                            entry_price=local_pos.entry_price,
                            exit_price=local_pos.entry_price, # unknown, use entry as fallback
                            size=local_pos.size,
                            pnl=0.0,
                            entry_time=local_pos.opened_at,
                            exit_time=now_sao_paulo(),
                            strategy_id=str(local_pos.strategy_id or "reconciled")
                        )
                        session.add(trade)

                await session.commit()
                logger.info("Position synchronization complete.")
                
            except Exception as e:
                logger.error("Failed to synchronize positions: %s", e)
                await session.rollback()

    async def close(self):
        if self._exchange:
            await self._exchange.close()
