import logging
import asyncio
import pandas as pd
import numpy as np
from typing import List, Dict, Any, Optional
from datetime import datetime
from sqlalchemy import select
from app.db.session import async_session_factory
from app.db.models import Candle
from app.discovery.strategy_components import StrategyVersionComponents

logger = logging.getLogger(__name__)

try:
    import vectorbt as vbt
except ImportError:
    logger.warning("vectorbt not installed. VectorResearcher will fail.")
    vbt = None

class VectorResearcher:
    """Uses vectorbt for high-speed parameter sweeps and research."""

    def __init__(self, asset: str, timeframe: str):
        self.asset = asset
        self.timeframe = timeframe
        self.df: Optional[pd.DataFrame] = None

    async def load_data(self, limit: int = 2000):
        """Load data from database into pandas DataFrame."""
        async with async_session_factory() as session:
            stmt = (
                select(Candle)
                .where(Candle.asset == self.asset, Candle.timeframe == self.timeframe)
                .order_by(Candle.timestamp.asc())
                .limit(limit)
            )
            result = await session.execute(stmt)
            bars = result.scalars().all()
            
            if not bars:
                logger.warning("No data found for %s/%s", self.asset, self.timeframe)
                return False
                
            data = [
                {
                    "timestamp": b.timestamp,
                    "open": b.open,
                    "high": b.high,
                    "low": b.low,
                    "close": b.close,
                    "volume": b.volume,
                    "funding_rate": b.funding_rate,
                    "open_interest": b.open_interest
                }
                for b in bars
            ]
            self.df = pd.DataFrame(data).set_index("timestamp")
            return True

    def run_ema_sweep(self, fast_range: range, slow_range: range) -> pd.DataFrame:
        """Run EMA crossover sweep."""
        if self.df is None or vbt is None:
            return pd.DataFrame()

        close = self.df['close']
        
        # Use vectorbt's MA crossover indicator
        fast_ma = vbt.MA.run(close, window=list(fast_range), ewm=True)
        slow_ma = vbt.MA.run(close, window=list(slow_range), ewm=True)
        
        entries = fast_ma.ma_crossed_above(slow_ma)
        exits = fast_ma.ma_crossed_below(slow_ma)
        
        # Performance
        pf = vbt.Portfolio.from_signals(close, entries, exits, freq='1h') # Adjust freq as needed
        
        # Portfolio metrics for all combinations
        stats = pf.stats([
            'total_return', 'annual_return', 'sharpe_ratio', 'max_drawdown', 'profit_factor'
        ], agg_func=None)
        
        # Return a sorted DataFrame of results
        return stats.sort_values(by="Sharpe Ratio", ascending=False)

    def run_rsi_sweep(self, period_range: range, ob_range: range, os_range: range) -> pd.DataFrame:
        """Run RSI mean reversion sweep using vectorbt indicators."""
        if self.df is None or vbt is None:
            return pd.DataFrame()
            
        close = self.df['close']
        
        # Vectorized RSI with broadcasting
        rsi = vbt.RSI.run(close, window=list(period_range))
        
        # We broadcast across OS/OB levels
        results = []
        for p in period_range:
            rsi_vals = rsi.rsi[:, period_range.index(p)]
            for ob in ob_range:
                for os in os_range:
                    entries = (rsi_vals < os)
                    exits = (rsi_vals > ob)
                    pf = vbt.Portfolio.from_signals(close, entries, exits)
                    sharpe = pf.sharpe_ratio().mean()
                    pf_val = pf.profit_factor().mean()
                    
                    results.append({
                        "name": f"RSI_{p}_{os}_{ob}",
                        "type": "mean_reversion",
                        "params": {"rsi_period": p, "rsi_os": os, "rsi_ob": ob},
                        "Sharpe Ratio": sharpe,
                        "Profit Factor": pf_val
                    })
                    
        return pd.DataFrame(results).sort_values(by="Sharpe Ratio", ascending=False)

    def run_breakout_sweep(self, window_range: range, vol_z_range: List[float]) -> pd.DataFrame:
        """Run Volatility Breakout sweep."""
        if self.df is None or vbt is None:
            return pd.DataFrame()

        close = self.df['close']
        volume = self.df['volume']
        
        results = []
        for w in window_range:
            # Simple breakout: High of last N bars
            rolling_high = close.rolling(w).high().shift(1)
            rolling_low = close.rolling(w).low().shift(1)
            
            # Volume filter
            vol_mean = volume.rolling(w).mean()
            vol_std = volume.rolling(w).std().replace(0, np.nan)
            vol_z = (volume - vol_mean) / vol_std
            
            for vz in vol_z_range:
                entries = (close > rolling_high) & (vol_z > vz)
                exits = (close < rolling_low)
                
                pf = vbt.Portfolio.from_signals(close, entries, exits)
                results.append({
                    "name": f"Breakout_{w}_{vz}",
                    "type": "breakout",
                    "params": {"window": w, "vol_z": vz},
                    "Sharpe Ratio": pf.sharpe_ratio().mean(),
                    "Profit Factor": pf.profit_factor().mean()
                })
        
        return pd.DataFrame(results).sort_values(by="Sharpe Ratio", ascending=False)

    async def get_top_candidates(self, top_n: int = 5) -> List[Dict[str, Any]]:
        """Run multiple sweeps and return combined top candidates."""
        if self.df is None:
            if not await self.load_data():
                return []

        all_candidates = []

        # 1. EMA Crossover
        ema_res = self.run_ema_sweep(range(5, 25, 5), range(30, 100, 10))
        for i in range(min(2, len(ema_res))):
            row = ema_res.iloc[i]
            params = {"fast_period": int(row.name[0]), "slow_period": int(row.name[1]), "type": "ma_cross"}
            all_candidates.append({
                "name": f"EMA_{params['fast_period']}_{params['slow_period']}",
                "type": "trend_following",
                "params": params,
                "sharpe": float(row["Sharpe Ratio"]),
                "profit_factor": float(row["Profit Factor"])
            })

        # 2. RSI Mean Reversion
        rsi_res = self.run_rsi_sweep(range(10, 20, 4), range(70, 85, 5), range(20, 35, 5))
        for i in range(min(2, len(rsi_res))):
            row = rsi_res.iloc[i]
            p = row["params"]
            p["type"] = "rsi"
            all_candidates.append({
                "name": f"RSI_{p['rsi_period']}_{p['rsi_os']}",
                "type": "mean_reversion",
                "params": p,
                "sharpe": float(row["Sharpe Ratio"]),
                "profit_factor": float(row["Profit Factor"])
            })

        # 3. Breakout
        breakout_res = self.run_breakout_sweep(range(10, 30, 10), [2.0, 3.0])
        for i in range(min(2, len(breakout_res))):
            row = breakout_res.iloc[i]
            p = row["params"]
            p["type"] = "vol_breakout"
            all_candidates.append({
                "name": f"Breakout_{p['window']}_{p['vol_z']}",
                "type": "breakout",
                "params": p,
                "sharpe": float(row["Sharpe Ratio"]),
                "profit_factor": float(row["Profit Factor"])
            })

        # Sort all and return top N
        all_candidates.sort(key=lambda x: x["sharpe"], reverse=True)
        return all_candidates[:top_n]
