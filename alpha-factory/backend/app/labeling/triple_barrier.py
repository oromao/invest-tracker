from __future__ import annotations

import logging
from typing import List, Optional

import numpy as np
import pandas as pd
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.db.models import BarrierEnum, Label, OHLCVBar
from app.db.session import AsyncSessionLocal
from app.shared.time import ensure_timezone

logger = logging.getLogger(__name__)


def triple_barrier_label(
    close: pd.Series,
    pt: float = 0.02,
    sl: float = 0.01,
    t: int = 48,
) -> pd.DataFrame:
    """
    Apply triple barrier labeling to a close price series.

    No lookahead leak: label for bar i is computed using only bars i+1..i+t.

    Parameters
    ----------
    close : pd.Series, sorted ascending index
    pt    : profit-take threshold (fractional return)
    sl    : stop-loss threshold (fractional return, positive number)
    t     : max holding period in bars

    Returns
    -------
    DataFrame with columns: label (-1/0/1), barrier_hit (tp/sl/time), ret
    """
    n = len(close)
    labels = np.zeros(n, dtype=int)
    barrier_hits = np.full(n, "time", dtype=object)
    returns = np.zeros(n, dtype=float)

    close_arr = close.values

    # We can only label bars where we have at least 1 future bar
    # Last t bars cannot be fully labeled — we label them based on available data
    for i in range(n - 1):
        entry = close_arr[i]
        look_ahead = min(t, n - i - 1)
        label = 0
        barrier = "time"
        final_ret = 0.0

        for j in range(1, look_ahead + 1):
            ret = (close_arr[i + j] - entry) / entry
            if ret >= pt:
                label = 1
                barrier = "tp"
                final_ret = ret
                break
            elif ret <= -sl:
                label = -1
                barrier = "sl"
                final_ret = ret
                break
        else:
            # Time barrier
            last_j = look_ahead
            final_ret = (close_arr[i + last_j] - entry) / entry if look_ahead > 0 else 0.0
            label = 0
            barrier = "time"

        labels[i] = label
        barrier_hits[i] = barrier
        returns[i] = final_ret

    result = pd.DataFrame(
        {"label": labels, "barrier_hit": barrier_hits, "ret": returns},
        index=close.index,
    )
    # Drop last row (no future data)
    result = result.iloc[:-1]
    return result


class TripleBarrierLabeler:
    async def run(self, asset: str, timeframe: str) -> int:
        pt = settings.tb_pt
        sl = settings.tb_sl
        t = settings.tb_t

        async with AsyncSessionLocal() as session:
            stmt = (
                select(OHLCVBar)
                .where(OHLCVBar.asset == asset, OHLCVBar.timeframe == timeframe)
                .order_by(OHLCVBar.timestamp.asc())
                .limit(t * 10 + 100)
            )
            result = await session.execute(stmt)
            rows = result.scalars().all()

            if len(rows) < t + 2:
                logger.warning("Not enough bars for labeling %s/%s", asset, timeframe)
                return 0

            close = pd.Series(
                [r.close for r in rows],
                index=pd.DatetimeIndex([r.timestamp for r in rows]),
                name="close",
            )

            labeled = triple_barrier_label(close, pt=pt, sl=sl, t=t)

            db_rows = []
            for ts, row in labeled.iterrows():
                if hasattr(ts, "to_pydatetime"):
                    ts = ts.to_pydatetime()
                ts = ensure_timezone(ts)

                barrier_enum = BarrierEnum(row["barrier_hit"])
                db_rows.append(
                    {
                        "asset": asset,
                        "timeframe": timeframe,
                        "timestamp": ts,
                        "label": int(row["label"]),
                        "barrier_hit": barrier_enum,
                        "ret": float(row["ret"]),
                    }
                )

            if not db_rows:
                return 0

            chunk_size = 500
            total = 0
            for i in range(0, len(db_rows), chunk_size):
                chunk = db_rows[i : i + chunk_size]
                stmt_upsert = (
                    pg_insert(Label)
                    .values(chunk)
                    .on_conflict_do_update(
                        constraint="uq_label_asset_tf_ts",
                        set_={
                            "label": pg_insert(Label).excluded.label,
                            "barrier_hit": pg_insert(Label).excluded.barrier_hit,
                            "ret": pg_insert(Label).excluded.ret,
                        },
                    )
                )
                await session.execute(stmt_upsert)
                total += len(chunk)

            await session.commit()

        logger.info("Labeled %d bars for %s/%s", total, asset, timeframe)
        return total
