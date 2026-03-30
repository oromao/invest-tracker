from __future__ import annotations

import os
import time as time_module
from datetime import datetime, timezone
from zoneinfo import ZoneInfo

SAO_PAULO_TZ = ZoneInfo("America/Sao_Paulo")

os.environ.setdefault("TZ", "America/Sao_Paulo")
if hasattr(time_module, "tzset"):
    time_module.tzset()


def now_sao_paulo() -> datetime:
    return datetime.now(tz=SAO_PAULO_TZ)


def ensure_timezone(value: datetime) -> datetime:
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc).astimezone(SAO_PAULO_TZ)
    return value.astimezone(SAO_PAULO_TZ)


def to_sao_paulo(value: datetime) -> datetime:
    return ensure_timezone(value)
