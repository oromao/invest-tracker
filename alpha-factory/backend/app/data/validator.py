"""OHLCV data validation and cleaning layer."""
from __future__ import annotations

import logging
from dataclasses import dataclass, field
from typing import Dict, List, Tuple

import numpy as np

logger = logging.getLogger(__name__)

TIMEFRAME_SECONDS: Dict[str, int] = {
    "1m": 60, "3m": 180, "5m": 300, "15m": 900, "30m": 1800,
    "1h": 3600, "2h": 7200, "4h": 14400, "6h": 21600, "8h": 28800,
    "12h": 43200, "1d": 86400, "3d": 259200, "1w": 604800,
}


@dataclass
class ValidationResult:
    valid: bool = True
    original_count: int = 0
    clean_count: int = 0
    rejected_count: int = 0
    duplicate_count: int = 0
    gap_count: int = 0
    issues: List[str] = field(default_factory=list)


def validate_and_clean_bars(
    bars: List[dict],
    timeframe: str,
    asset: str,
    max_gap_multiplier: float = 3.0,
) -> Tuple[List[dict], ValidationResult]:
    """
    Validate and clean OHLCV bar list.

    Rules enforced:
    - open, high, low, close > 0
    - volume >= 0
    - high >= max(open, close), low <= min(open, close), high >= low
    - no NaN / None numeric fields
    - deduplication: last bar at same timestamp wins
    - gap detection: logs but does NOT reject — gaps are informational

    Returns (clean_bars, ValidationResult).
    """
    result = ValidationResult(original_count=len(bars))

    if not bars:
        result.valid = False
        result.issues.append("empty bar list")
        return [], result

    seen: Dict = {}  # timestamp → bar

    for bar in bars:
        ts = bar.get("timestamp")
        if ts is None:
            result.rejected_count += 1
            result.issues.append("missing timestamp")
            continue

        try:
            o = float(bar["open"])
            h = float(bar["high"])
            l_val = float(bar["low"])
            c = float(bar["close"])
            v = float(bar["volume"])
        except (TypeError, ValueError, KeyError):
            result.rejected_count += 1
            result.issues.append(f"non-numeric OHLCV at ts={ts}")
            continue

        # NaN check
        if any(np.isnan(x) for x in (o, h, l_val, c, v)):
            result.rejected_count += 1
            result.issues.append(f"NaN value at ts={ts}")
            continue

        # Price positivity
        if o <= 0 or h <= 0 or l_val <= 0 or c <= 0:
            result.rejected_count += 1
            result.issues.append(f"non-positive price at ts={ts}: o={o} h={h} l={l_val} c={c}")
            continue

        # Volume
        if v < 0:
            result.rejected_count += 1
            result.issues.append(f"negative volume at ts={ts}: v={v}")
            continue

        # OHLC consistency — allow 0.1% tolerance for float imprecision
        tol = 1.001
        if h < l_val:
            result.rejected_count += 1
            result.issues.append(f"high({h}) < low({l_val}) at ts={ts}")
            continue
        if o > h * tol or o < l_val / tol:
            result.rejected_count += 1
            result.issues.append(f"open({o}) outside [low({l_val}), high({h})] at ts={ts}")
            continue
        if c > h * tol or c < l_val / tol:
            result.rejected_count += 1
            result.issues.append(f"close({c}) outside [low({l_val}), high({h})] at ts={ts}")
            continue

        bar_clean = dict(bar)
        bar_clean["open"] = o
        bar_clean["high"] = h
        bar_clean["low"] = l_val
        bar_clean["close"] = c
        bar_clean["volume"] = v

        if ts in seen:
            result.duplicate_count += 1
        seen[ts] = bar_clean

    clean = list(seen.values())
    result.clean_count = len(clean)

    # Gap detection — informational only
    if timeframe in TIMEFRAME_SECONDS and len(clean) > 1:
        expected_secs = TIMEFRAME_SECONDS[timeframe]
        max_gap_secs = expected_secs * max_gap_multiplier
        sorted_bars = sorted(clean, key=lambda x: x["timestamp"])
        for i in range(1, len(sorted_bars)):
            t1 = sorted_bars[i - 1]["timestamp"]
            t2 = sorted_bars[i]["timestamp"]
            try:
                gap_secs = (t2 - t1).total_seconds()
                if gap_secs > max_gap_secs:
                    result.gap_count += 1
                    result.issues.append(
                        f"data gap {gap_secs / 3600:.1f}h between {t1} and {t2}"
                    )
            except Exception:
                pass

    if result.rejected_count > 0 or result.duplicate_count > 0:
        logger.warning(
            "OHLCV validation %s/%s: in=%d clean=%d rejected=%d dups=%d gaps=%d",
            asset, timeframe,
            result.original_count, result.clean_count,
            result.rejected_count, result.duplicate_count, result.gap_count,
        )
    elif result.gap_count > 0:
        logger.info(
            "OHLCV gaps %s/%s: %d gap(s) detected",
            asset, timeframe, result.gap_count,
        )

    return clean, result
