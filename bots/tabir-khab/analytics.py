"""analytics.py — پورت پایتونیِ هم‌قرارداد shared/analytics.js (مونوریپو).

ANALYTICS_SCHEMA_VERSION = 2

قرارداد (چک CI ریشه: tools/check-analytics-sync.mjs سینک بودن را با shared تضمین می‌کند):
- جدول events (user_id, event, props JSON, created_at یونیکس) + ایندکس‌های idx_events_user / idx_events_event
- ستون‌های write-once روی users: first_source / first_payload / first_version (کوهورت نسخه‌ی ورود)
- payload لینک استارت: c_<code> کمپین / r_<uid> یا ref_<uid> رفرال / خالی = organic
- رویداد start برای «هر» /start ثبت می‌شود؛ first_source/first_version فقط برای کاربر جدید
- همه‌ی توابع fail-safe اند: خطای آنالیتیکس هرگز فلوی محصول را نمی‌شکند (فقط لاگ)

تفاوت پیاده‌سازی با Node: created_at با strftime('%s','now') پر می‌شود چون sqlite سیستمی
سرور ممکن است unixepoch() (نسخه‌ی ۳.۳۸+) را نداشته باشد — مقدار همان عدد ثانیه‌ی یونیکس است.
"""
import json
import logging
import re

import aiosqlite

ANALYTICS_SCHEMA_VERSION = 2

log = logging.getLogger("analytics")

_CAMPAIGN_RE = re.compile(r"^c_([A-Za-z0-9]{1,32})$")
_REFERRAL_RE = re.compile(r"^r(?:ef)?_(\d+)$")

_DDL = """
CREATE TABLE IF NOT EXISTS events (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER,
  event      TEXT    NOT NULL,
  props      TEXT    NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
);
CREATE INDEX IF NOT EXISTS idx_events_user  ON events(user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_events_event ON events(event, created_at);
"""


def _path() -> str:
    # import تنبل برای جلوگیری از import چرخه‌ای db ↔ analytics
    import db as _db
    return _db._path()


async def ensure_analytics(conn: aiosqlite.Connection) -> None:
    """در init_db هر دیتابیس صدا زده می‌شود (روی همان اتصال باز)."""
    await conn.executescript(_DDL)
    for col in ("first_source", "first_payload", "first_version"):
        try:
            await conn.execute(f"ALTER TABLE users ADD COLUMN {col} TEXT NOT NULL DEFAULT ''")
        except Exception:
            pass  # ستون از قبل هست
    await conn.commit()


def parse_start_payload(raw: str) -> dict:
    payload = (raw or "").strip()[:64]
    if not payload:
        return {"payload": "", "kind": "organic", "code": ""}
    m = _CAMPAIGN_RE.match(payload)
    if m:
        return {"payload": payload, "kind": "campaign", "code": m.group(1)}
    m = _REFERRAL_RE.match(payload)
    if m:
        return {"payload": payload, "kind": "referral", "code": m.group(1)}
    return {"payload": payload, "kind": "other", "code": ""}


async def track(user_id, event: str, props: dict | None = None) -> None:
    try:
        async with aiosqlite.connect(_path()) as conn:
            await conn.execute("PRAGMA busy_timeout = 5000")
            await conn.execute(
                "INSERT INTO events (user_id, event, props) VALUES (?, ?, ?)",
                (user_id, event, json.dumps(props or {}, ensure_ascii=False)),
            )
            await conn.commit()
    except Exception as e:  # fail-safe — آنالیتیکس هرگز فلو را نمی‌شکند
        log.warning("analytics track %s: %s", event, e)


async def track_once(user_id, event: str, props: dict | None = None) -> bool:
    try:
        async with aiosqlite.connect(_path()) as conn:
            await conn.execute("PRAGMA busy_timeout = 5000")
            cur = await conn.execute(
                "SELECT 1 FROM events WHERE user_id=? AND event=? LIMIT 1", (user_id, event)
            )
            if await cur.fetchone():
                return False
            await conn.execute(
                "INSERT INTO events (user_id, event, props) VALUES (?, ?, ?)",
                (user_id, event, json.dumps(props or {}, ensure_ascii=False)),
            )
            await conn.commit()
            return True
    except Exception as e:
        log.warning("analytics track_once %s: %s", event, e)
        return False


async def capture_start(user_id, raw_payload: str, is_new: bool, version: str = "") -> dict:
    """در هندلر /start: رویداد start برای همه، همیشه؛ first_source/first_version فقط برای کاربر جدید (write-once).

    version = ثابت PRODUCT_VERSION ربات (کوهورت «کاربر با کدام نسخه شروع کرد»)."""
    parsed = parse_start_payload(raw_payload)
    try:
        if is_new:
            src = (
                f"campaign:{parsed['code']}" if parsed["kind"] == "campaign"
                else f"referral:{parsed['code']}" if parsed["kind"] == "referral"
                else f"other:{parsed['payload']}" if parsed["kind"] == "other"
                else "organic"
            )
            async with aiosqlite.connect(_path()) as conn:
                await conn.execute("PRAGMA busy_timeout = 5000")
                await conn.execute(
                    "UPDATE users SET first_source=?, first_payload=? WHERE user_id=? AND first_source=''",
                    (src, parsed["payload"], user_id),
                )
                if version:
                    await conn.execute(
                        "UPDATE users SET first_version=? WHERE user_id=? AND first_version=''",
                        (str(version), user_id),
                    )
                await conn.commit()
        props = {
            "payload": parsed["payload"], "kind": parsed["kind"], "code": parsed["code"], "new": bool(is_new),
        }
        if version:
            props["v"] = str(version)
        await track(user_id, "start", props)
    except Exception as e:
        log.warning("analytics capture_start: %s", e)
    return parsed
