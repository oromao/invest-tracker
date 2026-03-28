import logging
import pandas as pd
from typing import List, Dict, Any, Optional
from datetime import datetime

logger = logging.getLogger(__name__)

try:
    import backtrader as bt
except ImportError:
    logger.warning("backtrader not installed. BTSimulator will fail.")
    bt = None

class GenericStrategy(bt.SignalStrategy):
    """A configurable Backtrader strategy."""
    params = (
        ('fast_period', 10),
        ('slow_period', 30),
        ('rsi_period', 14),
        ('rsi_os', 30),
        ('rsi_ob', 70),
        ('window', 20),
        ('vol_z', 2.0),
        ('strategy_type', 'ema_crossover'),
    )

    def __init__(self):
        if self.params.strategy_type == 'ma_cross':
            self.ema_fast = bt.indicators.EMA(period=self.params.fast_period)
            self.ema_slow = bt.indicators.EMA(period=self.params.slow_period)
            self.signal_add(bt.SIGNAL_LONG, bt.indicators.CrossOver(self.ema_fast, self.ema_slow))
        
        elif self.params.strategy_type == 'rsi':
            self.rsi = bt.indicators.RSI(period=self.params.rsi_period)
            # Signal: 1 when below OS, -1 when above OB
            self.signal_add(bt.SIGNAL_LONG, self.rsi < self.params.rsi_os)
            self.signal_add(bt.SIGNAL_LONGEXIT, self.rsi > self.params.rsi_ob)

        elif self.params.strategy_type == 'vol_breakout':
            self.highest = bt.indicators.Highest(self.data.high(-1), period=self.params.window)
            self.lowest = bt.indicators.Lowest(self.data.low(-1), period=self.params.window)
            
            # Simple Volume Z-score indicator
            vol_mean = bt.indicators.SimpleMovingAverage(self.data.volume, period=self.params.window)
            vol_std = bt.indicators.StandardDeviation(self.data.volume, period=self.params.window)
            self.vol_zscore = (self.data.volume - vol_mean) / vol_std
            
            self.signal_add(bt.SIGNAL_LONG, (self.data.close > self.highest) & (self.vol_zscore > self.params.vol_z))
            self.signal_add(bt.SIGNAL_LONGEXIT, (self.data.close < self.lowest))

class BTSimulator:
    """High-fidelity simulation using Backtrader."""

    def __init__(self, df: pd.DataFrame):
        self.df = df
        self.results = {}

    def run(self, strategy_type: str, params: Dict[str, Any]) -> Dict[str, Any]:
        """Run a single Backtrader simulation."""
        if bt is None:
            return {"error": "backtrader not installed"}

        cerebro = bt.Cerebro()
        
        # Add data
        # We need to map our DataFrame to Backtrader format
        data = bt.feeds.PandasData(dataname=self.df)
        cerebro.adddata(data)
        
        # Add strategy
        cerebro.addstrategy(GenericStrategy, strategy_type=strategy_type, **params)
        
        # Set broker
        cerebro.broker.setcash(10000.0)
        cerebro.broker.setcommission(commission=0.001) # 0.1% fee
        
        # Add analyzers
        cerebro.addanalyzer(bt.analyzers.SharpeRatio, _name='sharpe')
        cerebro.addanalyzer(bt.analyzers.DrawDown, _name='drawdown')
        cerebro.addanalyzer(bt.analyzers.TradeAnalyzer, _name='trades')
        
        # Run
        strats = cerebro.run()
        res = strats[0]
        
        # Extract metrics
        sharpe = res.analyzers.sharpe.get_analysis()
        drawdown = res.analyzers.drawdown.get_analysis()
        trades = res.analyzers.trades.get_analysis()
        
        # Handle trades
        total_trades = trades.total.total if hasattr(trades, 'total') else 0
        pnl = cerebro.broker.getvalue() - 10000.0
        
        metrics = {
            "sharpe": sharpe.get('sharperatio', 0.0) or 0.0,
            "max_drawdown": drawdown.max.drawdown if hasattr(drawdown, 'max') else 0.0,
            "total_trades": total_trades,
            "net_pnl": pnl,
            "profit_factor": 0.0, # Backtrader needs manual calc or custom analyzer for PF
        }
        
        # Simple Profit Factor calculation
        if hasattr(trades, 'won') and hasattr(trades, 'lost'):
            won = trades.won.pnl.total if trades.won.pnl.total else 0.0
            lost = abs(trades.lost.pnl.total) if trades.lost.pnl.total else 0.0
            if lost > 0:
                metrics["profit_factor"] = won / lost
            elif won > 0:
                metrics["profit_factor"] = 100.0 # Arbitrary high
                
        return metrics
