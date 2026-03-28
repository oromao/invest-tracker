import numpy as np
import pandas as pd
from typing import Dict, Optional

class StrategyVersionComponents:
    """Modular components for generating trading signals."""

    @staticmethod
    def trend_following(df: pd.DataFrame, fast_period: int = 10, slow_period: int = 30) -> pd.Series:
        """EMA Crossover trend signal."""
        ema_fast = df['close'].ewm(span=fast_period, adjust=False).mean()
        ema_slow = df['close'].ewm(span=slow_period, adjust=False).mean()
        signal = np.where(ema_fast > ema_slow, 1, -1)
        return pd.Series(signal, index=df.index)

    @staticmethod
    def mean_reversion(df: pd.DataFrame, rsi_period: int = 14, overbought: int = 70, oversold: int = 30) -> pd.Series:
        """RSI-based mean reversion signal."""
        delta = df['close'].diff()
        gain = (delta.where(delta > 0, 0)).rolling(window=rsi_period).mean()
        loss = (-delta.where(delta < 0, 0)).rolling(window=rsi_period).mean()
        rs = gain / loss
        rsi = 100 - (100 / (1 + rs))
        
        signal = np.zeros(len(df))
        signal[rsi < oversold] = 1   # Oversold -> Buy
        signal[rsi > overbought] = -1 # Overbought -> Sell
        return pd.Series(signal, index=df.index)

    @staticmethod
    def breakout(df: pd.DataFrame, bb_period: int = 20, bb_std: float = 2.0) -> pd.Series:
        """Bollinger Band breakout signal."""
        sma = df['close'].rolling(window=bb_period).mean()
        std = df['close'].rolling(window=bb_period).std()
        upper = sma + (std * bb_std)
        lower = sma - (std * bb_std)
        
        signal = np.zeros(len(df))
        signal[df['close'] > upper] = 1  # Breakout Up
        signal[df['close'] < lower] = -1 # Breakout Down
        return pd.Series(signal, index=df.index)

    @staticmethod
    def volatility_expansion(df: pd.DataFrame, atr_period: int = 14, mult: float = 2.0) -> pd.Series:
        """Volatility expansion relative to ATR."""
        high_low = df['high'] - df['low']
        high_close = np.abs(df['high'] - df['close'].shift())
        low_close = np.abs(df['low'] - df['close'].shift())
        ranges = pd.concat([high_low, high_close, low_close], axis=1)
        tr = ranges.max(axis=1)
        atr = tr.rolling(window=atr_period).mean()
        
        # Signal 1 if current candle range > mult * ATR
        expansion = (df['high'] - df['low']) > (atr * mult)
        signal = np.where(expansion, np.where(df['close'] > df['open'], 1, -1), 0)
        return pd.Series(signal, index=df.index)

    @staticmethod
    def vwap_pullback(df: pd.DataFrame, threshold_pct: float = 0.01) -> pd.Series:
        """Price distance from VWAP."""
        if 'vwap' not in df.columns:
            # Simple VWAP calculation if not provided
            v = df['volume']
            p = (df['high'] + df['low'] + df['close']) / 3
            df['vwap'] = (p * v).cumsum() / v.cumsum()
            
        dist = (df['close'] - df['vwap']) / df['vwap']
        signal = np.zeros(len(df))
        signal[dist < -threshold_pct] = 1 # Pullback to mean (from below)
        signal[dist > threshold_pct] = -1 # Overextended (from up)
        return pd.Series(signal, index=df.index)

    @staticmethod
    def market_filters(df: pd.DataFrame, min_funding: float = 0.0, min_oi_change: float = 0.0) -> pd.Series:
        """Funding and OI filters."""
        signal = np.ones(len(df))
        if 'funding_rate' in df.columns:
            signal = np.where(df['funding_rate'] > min_funding, 1, 0)
        
        if 'open_interest' in df.columns:
            oi_change = df['open_interest'].pct_change()
            signal = np.where((signal == 1) & (oi_change > min_oi_change), 1, 0)
            
        return pd.Series(signal, index=df.index)
