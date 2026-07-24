"""لایه‌ی دیتابیس — SQLite با aiosqlite.

هر پلتفرم (بله / تلگرام) DB جداگانه دارد. مسیر فعال با ContextVar
تنظیم می‌شود تا هر polling-loop بدون تغییر signature، DB خودش را داشته باشد.
"""
import json
import datetime
from contextvars import ContextVar
import aiosqlite

import locales
from config import BALE_DB_PATH, DEFAULT_LANGUAGE

_db_path: ContextVar[str] = ContextVar("db_path", default=BALE_DB_PATH)


def set_db_path(path: str) -> None:
    _db_path.set(path)


def _path() -> str:
    return _db_path.get()


_SCHEMA = """
CREATE TABLE IF NOT EXISTS users (
    user_id             INTEGER PRIMARY KEY,
    chat_id             INTEGER,
    username            TEXT,
    first_name          TEXT,
    language            TEXT,
    persona             TEXT,
    profile             TEXT,
    onboarding_step     INTEGER NOT NULL DEFAULT 0,
    referred_by         INTEGER,
    has_paid            INTEGER NOT NULL DEFAULT 0,
    sub_tier            TEXT,
    sub_expires_at      TEXT,
    has_used_free_trial INTEGER NOT NULL DEFAULT 0,
    last_dream_date     TEXT,
    pending_source      TEXT,
    pending_payload     TEXT,
    pending_state       TEXT,
    pending_mode        TEXT,
    created_at          TEXT
);

CREATE TABLE IF NOT EXISTS dreams (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id         INTEGER NOT NULL,
    transcript      TEXT,
    persona         TEXT,
    preview         TEXT,
    depth           TEXT,
    interpretation  TEXT,
    image_prompt    TEXT,
    image_generated INTEGER NOT NULL DEFAULT 0,
    image_url       TEXT,
    image_width     INTEGER,
    image_height    INTEGER,
    image_black_retries INTEGER NOT NULL DEFAULT 0,
    is_free_trial   INTEGER NOT NULL DEFAULT 0,
    full_delivered  INTEGER NOT NULL DEFAULT 0,
    created_at      TEXT
);

CREATE TABLE IF NOT EXISTS transactions (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id         INTEGER NOT NULL,
    tier            TEXT,
    duration_days   INTEGER,
    amount_rial     INTEGER,
    invoice_payload TEXT UNIQUE,
    charge_id       TEXT,
    status          TEXT NOT NULL DEFAULT 'pending',
    created_at      TEXT
);
"""


def _now() -> datetime.datetime:
    return datetime.datetime.now()


def _now_iso() -> str:
    return _now().isoformat(timespec="seconds")


def _today() -> str:
    return datetime.date.today().isoformat()


async def init_db(db_path: str | None = None) -> None:
    if db_path:
        set_db_path(db_path)
    async with aiosqlite.connect(_path()) as db:
        await db.executescript(_SCHEMA)
        await db.commit()
        # آنالیتیکس مشترک مونوریپو: جدول events + ستون‌های first_source/first_payload (analytics.py)
        from analytics import ensure_analytics
        await ensure_analytics(db)
    await _migrate_db()


async def _migrate_db() -> None:
    """اضافه‌کردن ستون‌های جدید به DBهای موجود (idempotent)."""
    migrations = [
        ("users", "pending_state",    "TEXT"),
        ("users", "pending_mode",     "TEXT"),
        ("users", "language",         "TEXT"),
        ("users", "pending_dream_id", "INTEGER"),
        ("dreams", "preview", "TEXT"),
        ("dreams", "depth", "TEXT"),
        ("dreams", "image_width", "INTEGER"),
        ("dreams", "image_height", "INTEGER"),
        ("dreams", "image_black_retries", "INTEGER"),
    ]
    async with aiosqlite.connect(_path()) as db:
        for table, col, col_type in migrations:
            try:
                await db.execute(f"ALTER TABLE {table} ADD COLUMN {col} {col_type}")
                await db.commit()
            except Exception:
                pass  # ستون از قبل وجود دارد — نادیده بگیر


def _row_to_dict(cursor, row):
    if row is None:
        return None
    return {d[0]: row[i] for i, d in enumerate(cursor.description)}


# ===================== کاربر =====================

async def get_user(user_id: int):
    async with aiosqlite.connect(_path()) as db:
        cur = await db.execute("SELECT * FROM users WHERE user_id = ?", (user_id,))
        return _row_to_dict(cur, await cur.fetchone())


async def get_or_create_user(user_id, chat_id, username, first_name, referred_by=None,
                             language=None):
    """(is_new, user) برمی‌گرداند. language=None یعنی هنوز انتخاب نشده (تلگرام →
    انتخابگر زبان نشان داده می‌شود؛ بله → 'fa' پاس می‌دهد)."""
    async with aiosqlite.connect(_path()) as db:
        cur = await db.execute("SELECT * FROM users WHERE user_id = ?", (user_id,))
        row = await cur.fetchone()
        if row is not None:
            return False, _row_to_dict(cur, row)
        await db.execute(
            """INSERT INTO users
               (user_id, chat_id, username, first_name, language, persona, profile,
                onboarding_step, referred_by, has_paid, has_used_free_trial, created_at)
               VALUES (?, ?, ?, ?, ?, NULL, '{}', 0, ?, 0, 0, ?)""",
            (user_id, chat_id, username, first_name, language, referred_by, _now_iso()),
        )
        await db.commit()
        cur = await db.execute("SELECT * FROM users WHERE user_id = ?", (user_id,))
        return True, _row_to_dict(cur, await cur.fetchone())


# ===================== آنبوردینگ =====================

def get_profile(user: dict) -> dict:
    try:
        return json.loads(user.get("profile") or "{}")
    except (json.JSONDecodeError, TypeError):
        return {}


def is_sym_browse(user: dict) -> bool:
    """آیا کاربر داخلِ حالتِ «نمادیاب» است؟ (فلگِ سبکِ UI در profile JSON).
    در این حالت متنِ کوتاه = جستجوی نماد؛ خارج از آن، همه‌ی متن‌ها = ورودی خواب (رفتار قبلی)."""
    return bool(get_profile(user).get("sym_browse"))


async def set_sym_browse(user_id: int, on: bool):
    """ورود/خروجِ حالتِ نمادیاب را در profile JSON ثبت می‌کند (write-merge روی بقیه‌ی پروفایل).
    ephemeral است و با ریست/تغییر زبان طبیعتاً پاک می‌شود؛ روی فلوی خواب اثری ندارد."""
    async with aiosqlite.connect(_path()) as db:
        cur = await db.execute("SELECT profile FROM users WHERE user_id = ?", (user_id,))
        row = await cur.fetchone()
        try:
            profile = json.loads((row[0] if row else "{}") or "{}")
        except (json.JSONDecodeError, TypeError):
            profile = {}
        if on:
            profile["sym_browse"] = True
        else:
            profile.pop("sym_browse", None)
        await db.execute("UPDATE users SET profile = ? WHERE user_id = ?",
                         (json.dumps(profile, ensure_ascii=False), user_id))
        await db.commit()


def menu_revealed(user: dict) -> bool:
    """آیا منوی اصلی (کیبوردِ پایین) برای این کاربر آشکار شده؟ (قاعده‌ی «آنبوردینگِ بدون‌مزاحم»، بند ۹ج ریشه)

    تا لحظه‌ی پی‌وال (نقطه‌ی پول) منو پنهان می‌ماند تا آنبوردینگ تحت‌الشعاع قرار نگیرد.
    کاربری که اشتراک دارد/داشته هم قطعاً از آن نقطه گذشته، پس منویش باز است (گاردِ کاربرانِ قدیمی)."""
    if bool(get_profile(user).get("menu_revealed")):
        return True
    return bool((user or {}).get("sub_expires_at"))


async def set_menu_revealed(user_id: int):
    """فلگِ آشکارشدنِ منو را در profile JSON ثبت می‌کند (write-merge روی بقیه‌ی پروفایل)."""
    async with aiosqlite.connect(_path()) as db:
        cur = await db.execute("SELECT profile FROM users WHERE user_id = ?", (user_id,))
        row = await cur.fetchone()
        try:
            profile = json.loads((row[0] if row else "{}") or "{}")
        except (json.JSONDecodeError, TypeError):
            profile = {}
        profile["menu_revealed"] = True
        await db.execute("UPDATE users SET profile = ? WHERE user_id = ?",
                         (json.dumps(profile, ensure_ascii=False), user_id))
        await db.commit()


def onboarding_done(user: dict) -> bool:
    lang = (user or {}).get("language") or DEFAULT_LANGUAGE
    return (user or {}).get("onboarding_step", 0) >= locales.question_count(lang)


def user_lang(user: dict) -> str:
    return (user or {}).get("language") or DEFAULT_LANGUAGE


async def set_language(user_id: int, lang: str):
    """ست‌کردن زبان + ریست آنبوردینگ (پرسوناها بین زبان‌ها فرق دارند)."""
    async with aiosqlite.connect(_path()) as db:
        await db.execute(
            "UPDATE users SET language = ?, onboarding_step = 0, profile = '{}', persona = NULL "
            "WHERE user_id = ?",
            (lang, user_id),
        )
        await db.commit()


async def save_onboarding_answer(user_id: int, step: int, key: str, value: str,
                                 is_persona: bool = False):
    """پاسخ سؤال را در profile ذخیره و step را جلو می‌برد. اگر سؤال پرسوناست، ستون persona هم ست می‌شود."""
    async with aiosqlite.connect(_path()) as db:
        cur = await db.execute("SELECT profile FROM users WHERE user_id = ?", (user_id,))
        row = await cur.fetchone()
        try:
            profile = json.loads((row[0] if row else "{}") or "{}")
        except (json.JSONDecodeError, TypeError):
            profile = {}
        profile[key] = value
        new_step = step + 1
        if is_persona:
            await db.execute(
                "UPDATE users SET profile = ?, onboarding_step = ?, persona = ? WHERE user_id = ?",
                (json.dumps(profile, ensure_ascii=False), new_step, value, user_id),
            )
        else:
            await db.execute(
                "UPDATE users SET profile = ?, onboarding_step = ? WHERE user_id = ?",
                (json.dumps(profile, ensure_ascii=False), new_step, user_id),
            )
        await db.commit()


async def set_persona(user_id: int, persona: str):
    """فقط تغییر پرسونا (دکمه‌ی «تغییر سبک») بدون دست‌زدن به step/پاسخ‌ها."""
    async with aiosqlite.connect(_path()) as db:
        cur = await db.execute("SELECT profile FROM users WHERE user_id = ?", (user_id,))
        row = await cur.fetchone()
        try:
            profile = json.loads((row[0] if row else "{}") or "{}")
        except (json.JSONDecodeError, TypeError):
            profile = {}
        profile["persona"] = persona
        await db.execute(
            "UPDATE users SET persona = ?, profile = ? WHERE user_id = ?",
            (persona, json.dumps(profile, ensure_ascii=False), user_id),
        )
        await db.commit()


async def restart_onboarding(user_id: int):
    """برای دکمه‌ی «تغییر سبک» — از سؤال اول شروع کن."""
    async with aiosqlite.connect(_path()) as db:
        await db.execute(
            "UPDATE users SET onboarding_step = 0, profile = '{}', persona = NULL WHERE user_id = ?",
            (user_id,),
        )
        await db.commit()


async def reset_user(user_id: int):
    """ریست کامل کاربر برای تست: برمی‌گردد به حالت کاربر تازه.
    زبان را نگه می‌دارد تا ادمین مجبور نباشد هر بار دوباره زبان انتخاب کند."""
    async with aiosqlite.connect(_path()) as db:
        await db.execute(
            """UPDATE users SET
               onboarding_step     = 0,
               profile             = '{}',
               persona             = NULL,
               has_used_free_trial = 0,
               has_paid            = 0,
               sub_tier            = NULL,
               sub_expires_at      = NULL,
               last_dream_date     = NULL,
               pending_source      = NULL,
               pending_payload     = NULL,
               pending_state       = NULL,
               pending_mode        = NULL,
               pending_dream_id    = NULL
               WHERE user_id = ?""",
            (user_id,),
        )
        await db.commit()


async def set_onboarding_step(user_id: int, step: int):
    """نشاندار onboarding_step (برای برگشت/جلو رفتن)."""
    async with aiosqlite.connect(_path()) as db:
        await db.execute(
            "UPDATE users SET onboarding_step = ? WHERE user_id = ?", (step, user_id)
        )
        await db.commit()


# ===================== اشتراک =====================

def _parse_dt(s: str | None):
    if not s:
        return None
    try:
        return datetime.datetime.fromisoformat(s)
    except (ValueError, TypeError):
        return None


async def activate_subscription(user_id: int, tier: str, days: int):
    """اشتراک را فعال/تمدید می‌کند: از max(now, انقضای فعلی) + days."""
    async with aiosqlite.connect(_path()) as db:
        cur = await db.execute("SELECT sub_expires_at FROM users WHERE user_id = ?", (user_id,))
        row = await cur.fetchone()
        now = _now()
        current = _parse_dt(row[0] if row else None)
        base = current if (current and current > now) else now
        new_expiry = base + datetime.timedelta(days=days)
        await db.execute(
            "UPDATE users SET sub_tier = ?, sub_expires_at = ? WHERE user_id = ?",
            (tier, new_expiry.isoformat(timespec="seconds"), user_id),
        )
        await db.commit()
        return new_expiry


async def reverse_subscription(user_id: int, days: int):
    """برگشتِ یک پرداخت: روزهای همان پرداخت را از انقضا کم می‌کند (کاربر به حالتِ قبل برمی‌گردد).
    اگر نتیجه ≤ الان شد، اشتراک کاملاً غیرفعال می‌شود (tier هم پاک). هرچه تا الان مصرف شده اشکال ندارد."""
    async with aiosqlite.connect(_path()) as db:
        cur = await db.execute("SELECT sub_expires_at FROM users WHERE user_id = ?", (user_id,))
        row = await cur.fetchone()
        exp = _parse_dt(row[0] if row else None)
        if not exp:
            return
        new_exp = exp - datetime.timedelta(days=days)
        if new_exp <= _now():
            await db.execute(
                "UPDATE users SET sub_tier = NULL, sub_expires_at = NULL WHERE user_id = ?", (user_id,))
        else:
            await db.execute(
                "UPDATE users SET sub_expires_at = ? WHERE user_id = ?",
                (new_exp.isoformat(timespec="seconds"), user_id))
        await db.commit()


def subscription_status(user: dict) -> dict:
    """{active, tier, remaining_days, expires_at} از روی رکورد کاربر."""
    exp = _parse_dt((user or {}).get("sub_expires_at"))
    now = _now()
    if exp and exp > now:
        remaining = (exp - now).days + (1 if (exp - now).seconds > 0 else 0)
        return {"active": True, "tier": user.get("sub_tier"),
                "remaining_days": max(1, remaining), "expires_at": exp}
    return {"active": False, "tier": None, "remaining_days": 0, "expires_at": None}


async def grant_referral_days(user_id: int, days: int):
    """به معرف چند روز اشتراک هدیه می‌دهد (tier فعلی یا 'gift')."""
    user = await get_user(user_id)
    tier = (user or {}).get("sub_tier") or "gift"
    return await activate_subscription(user_id, tier, days)


async def set_has_paid(user_id: int, value: int = 1):
    async with aiosqlite.connect(_path()) as db:
        await db.execute("UPDATE users SET has_paid = ? WHERE user_id = ?", (value, user_id))
        await db.commit()


# ===================== سهمیه‌ی روزانه =====================

async def can_use_today(user_id: int) -> bool:
    async with aiosqlite.connect(_path()) as db:
        cur = await db.execute("SELECT last_dream_date FROM users WHERE user_id = ?", (user_id,))
        row = await cur.fetchone()
        return (row[0] if row else None) != _today()


async def consume_daily(user_id: int):
    async with aiosqlite.connect(_path()) as db:
        await db.execute("UPDATE users SET last_dream_date = ? WHERE user_id = ?", (_today(), user_id))
        await db.commit()


async def refund_daily(user_id: int):
    """در خطای فنی، سهمیه‌ی امروز بازگردانده می‌شود."""
    async with aiosqlite.connect(_path()) as db:
        await db.execute("UPDATE users SET last_dream_date = NULL WHERE user_id = ?", (user_id,))
        await db.commit()


async def mark_free_trial_used(user_id: int):
    async with aiosqlite.connect(_path()) as db:
        await db.execute("UPDATE users SET has_used_free_trial = 1 WHERE user_id = ?", (user_id,))
        await db.commit()


async def unmark_free_trial(user_id: int):
    async with aiosqlite.connect(_path()) as db:
        await db.execute("UPDATE users SET has_used_free_trial = 0 WHERE user_id = ?", (user_id,))
        await db.commit()


# ===================== ورودی معلق (مرحله‌ی تأیید) =====================

async def set_pending(user_id: int, source: str, payload: str):
    """ورودیِ تازه — هر پیوند/وضعیتِ خوابِ قبلی را هم پاک می‌کند تا اشتباهاً بازاستفاده نشود."""
    async with aiosqlite.connect(_path()) as db:
        await db.execute(
            """UPDATE users
               SET pending_source = ?, pending_payload = ?,
                   pending_state = NULL, pending_mode = NULL, pending_dream_id = NULL
               WHERE user_id = ?""",
            (source, payload, user_id),
        )
        await db.commit()


async def set_pending_dream_id(user_id: int, dream_id: int):
    """پیوندِ ورودیِ معلق به خوابِ از قبل تعبیرشده — تا resume بدون فراخوانی دوباره‌ی LLM انجام شود."""
    async with aiosqlite.connect(_path()) as db:
        await db.execute(
            "UPDATE users SET pending_dream_id = ? WHERE user_id = ?", (dream_id, user_id)
        )
        await db.commit()


async def get_pending(user_id: int):
    async with aiosqlite.connect(_path()) as db:
        cur = await db.execute(
            "SELECT pending_source, pending_payload FROM users WHERE user_id = ?", (user_id,)
        )
        row = await cur.fetchone()
        if not row or not row[0]:
            return None
        return {"source": row[0], "payload": row[1]}


async def set_pending_state(user_id: int, state: str | None, mode: str | None = None):
    """فقط وضعیت و مُد خواب معلق را به‌روز می‌کند (بدون تغییر source/payload)."""
    async with aiosqlite.connect(_path()) as db:
        await db.execute(
            "UPDATE users SET pending_state = ?, pending_mode = ? WHERE user_id = ?",
            (state, mode, user_id),
        )
        await db.commit()


async def clear_pending(user_id: int):
    """پاک‌کردن کامل خواب معلق: source، payload، state و mode."""
    async with aiosqlite.connect(_path()) as db:
        await db.execute(
            """UPDATE users
               SET pending_source = NULL, pending_payload = NULL,
                   pending_state  = NULL, pending_mode   = NULL,
                   pending_dream_id = NULL
               WHERE user_id = ?""",
            (user_id,),
        )
        await db.commit()


# ===================== رویاها =====================

async def create_dream(user_id, transcript, persona, interpretation, image_prompt,
                       is_free_trial=0, preview=None, depth=None) -> int:
    async with aiosqlite.connect(_path()) as db:
        cur = await db.execute(
            """INSERT INTO dreams
               (user_id, transcript, persona, preview, depth, interpretation, image_prompt,
                is_free_trial, created_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (user_id, transcript, persona, preview, depth, interpretation, image_prompt,
             is_free_trial, _now_iso()),
        )
        await db.commit()
        return cur.lastrowid


async def get_dream(dream_id: int):
    async with aiosqlite.connect(_path()) as db:
        cur = await db.execute("SELECT * FROM dreams WHERE id = ?", (dream_id,))
        return _row_to_dict(cur, await cur.fetchone())


async def mark_image(dream_id: int, url: str, width=None, height=None, black_retries=0):
    """ثبتِ تصویرِ تولیدشده + ابعادِ واقعی + تعدادِ ری‌تلاشِ تصویرِ سیاه (برای آمار)."""
    async with aiosqlite.connect(_path()) as db:
        await db.execute(
            """UPDATE dreams
               SET image_generated = 1, image_url = ?,
                   image_width = ?, image_height = ?, image_black_retries = ?
               WHERE id = ?""",
            (url, width, height, black_retries or 0, dream_id),
        )
        await db.commit()


async def mark_full_delivered(dream_id: int):
    async with aiosqlite.connect(_path()) as db:
        await db.execute("UPDATE dreams SET full_delivered = 1 WHERE id = ?", (dream_id,))
        await db.commit()


async def get_pending_trial_dream(user_id: int):
    """آخرین خواب تریالِ تحویل‌نشده — برای ارسال خودکار بعد از خرید."""
    async with aiosqlite.connect(_path()) as db:
        cur = await db.execute(
            """SELECT * FROM dreams
               WHERE user_id = ? AND is_free_trial = 1 AND full_delivered = 0
               ORDER BY id DESC LIMIT 1""",
            (user_id,),
        )
        return _row_to_dict(cur, await cur.fetchone())


# ===================== تراکنش‌ها =====================

async def create_transaction(user_id, tier, duration_days, amount_rial, invoice_payload) -> int:
    async with aiosqlite.connect(_path()) as db:
        cur = await db.execute(
            """INSERT INTO transactions
               (user_id, tier, duration_days, amount_rial, invoice_payload, status, created_at)
               VALUES (?, ?, ?, ?, ?, 'pending', ?)""",
            (user_id, tier, duration_days, amount_rial, invoice_payload, _now_iso()),
        )
        await db.commit()
        return cur.lastrowid


async def get_transaction_by_payload(invoice_payload: str):
    async with aiosqlite.connect(_path()) as db:
        cur = await db.execute(
            "SELECT * FROM transactions WHERE invoice_payload = ?", (invoice_payload,)
        )
        return _row_to_dict(cur, await cur.fetchone())


async def mark_transaction_paid(invoice_payload: str, charge_id: str) -> bool:
    """idempotent — True اگر این بار واقعاً paid شد."""
    async with aiosqlite.connect(_path()) as db:
        cur = await db.execute(
            """UPDATE transactions SET status = 'paid', charge_id = ?
               WHERE invoice_payload = ? AND status != 'paid'""",
            (charge_id, invoice_payload),
        )
        await db.commit()
        return cur.rowcount == 1


async def mark_transaction_reversed(invoice_payload: str) -> bool:
    """برگشتِ یک تراکنشِ paid (رسیدِ فیک) — از درآمدِ گزارش/داشبورد کنار می‌رود."""
    async with aiosqlite.connect(_path()) as db:
        cur = await db.execute(
            "UPDATE transactions SET status = 'reversed' WHERE invoice_payload = ? AND status = 'paid'",
            (invoice_payload,),
        )
        await db.commit()
        return cur.rowcount == 1
