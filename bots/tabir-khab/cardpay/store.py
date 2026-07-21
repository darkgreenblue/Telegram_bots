"""لایه‌ی دیتابیسِ ماژولِ کارت‌به‌کارت — جدول‌های مستقل و افزایشی.

قابل‌حمل: میزبان یک callable می‌دهد که مسیرِ DBِ فعلی را برمی‌گرداند (configure).
در tabir مسیر per-bot با ContextVar ست می‌شود، پس getter = db._path.

جدول‌ها (namespaced با پیشوندِ card_ تا با جدول‌های میزبان قاطی نشود):
  card_payments        — چرخه‌ی هر پرداخت: pending → waiting_review → approved/rejected
  card_admin_actions   — صفِ تأیید/رد (برای داشبورد؛ sweep درین می‌کند)
"""
import time
import logging
import aiosqlite

log = logging.getLogger("cardpay.store")

_path_getter = None


def configure(path_getter) -> None:
    """میزبان یک callable می‌دهد که مسیرِ DBِ فعلی را برمی‌گرداند."""
    global _path_getter
    _path_getter = path_getter


def _path() -> str:
    if _path_getter is None:
        raise RuntimeError("cardpay.store not configured — call configure(path_getter) first")
    return _path_getter()


def _now() -> int:
    return int(time.time())


_SCHEMA = """
CREATE TABLE IF NOT EXISTS card_payments (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id           INTEGER NOT NULL,
    chat_id           INTEGER,
    tier              TEXT,
    amount_rial       INTEGER NOT NULL,
    status            TEXT NOT NULL DEFAULT 'pending',
    step              TEXT,
    resume            INTEGER NOT NULL DEFAULT 0,
    receipt_file_id   TEXT,
    receipt_text      TEXT,
    admin_message_id  INTEGER,
    ai_verdict        TEXT,
    ai_reason         TEXT,
    reminded_at       INTEGER,
    created_at        INTEGER,
    updated_at        INTEGER
);

CREATE TABLE IF NOT EXISTS card_admin_actions (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    payment_id  INTEGER NOT NULL,
    action      TEXT NOT NULL,
    done_at     INTEGER
);
"""


async def ensure_schema() -> None:
    async with aiosqlite.connect(_path()) as db:
        await db.executescript(_SCHEMA)
        await db.commit()


def _row(cur, row):
    return {d[0]: row[i] for i, d in enumerate(cur.description)} if row else None


# ===================== پرداخت =====================

async def create_payment(user_id, chat_id, tier, amount_rial, resume=False) -> int:
    now = _now()
    async with aiosqlite.connect(_path()) as db:
        cur = await db.execute(
            """INSERT INTO card_payments
               (user_id, chat_id, tier, amount_rial, status, step, resume, created_at, updated_at)
               VALUES (?, ?, ?, ?, 'pending', 'receipt', ?, ?, ?)""",
            (user_id, chat_id, tier, amount_rial, 1 if resume else 0, now, now),
        )
        await db.commit()
        return cur.lastrowid


async def get_payment(payment_id):
    async with aiosqlite.connect(_path()) as db:
        cur = await db.execute("SELECT * FROM card_payments WHERE id = ?", (payment_id,))
        return _row(cur, await cur.fetchone())


async def get_pending_receipt_payment(user_id):
    """آخرین پرداختِ منتظرِ رسیدِ همین کاربر (بازیابی وقتی state حافظه‌ای گم شده) — پنجره‌ی ۳ روز."""
    async with aiosqlite.connect(_path()) as db:
        cur = await db.execute(
            """SELECT * FROM card_payments
               WHERE user_id = ? AND status = 'pending' AND step = 'receipt'
                 AND created_at > ? ORDER BY id DESC LIMIT 1""",
            (user_id, _now() - 259200),
        )
        return _row(cur, await cur.fetchone())


async def set_receipt_media(payment_id, file_id, receipt_text):
    """ذخیره‌ی خودِ رسید (عکس/متن) بدونِ تغییرِ وضعیت."""
    async with aiosqlite.connect(_path()) as db:
        await db.execute(
            "UPDATE card_payments SET receipt_file_id = ?, receipt_text = ?, updated_at = ? WHERE id = ?",
            (file_id, receipt_text, _now(), payment_id),
        )
        await db.commit()


async def mark_waiting_review(payment_id, admin_message_id=None):
    async with aiosqlite.connect(_path()) as db:
        await db.execute(
            """UPDATE card_payments SET status = 'waiting_review', admin_message_id = ?, updated_at = ?
               WHERE id = ? AND status = 'pending'""",
            (admin_message_id, _now(), payment_id),
        )
        await db.commit()


async def set_ai(payment_id, verdict, reason):
    async with aiosqlite.connect(_path()) as db:
        await db.execute(
            "UPDATE card_payments SET ai_verdict = ?, ai_reason = ?, updated_at = ? WHERE id = ?",
            (verdict, reason, _now(), payment_id),
        )
        await db.commit()


async def finalize(payment_id, status) -> bool:
    """گذارِ نهاییِ ایمن به approved/rejected — فقط از pending یا waiting_review (idempotent، ضد دوبار).
    True یعنی همین حالا واقعاً گذار کرد (نه قبلاً)."""
    async with aiosqlite.connect(_path()) as db:
        cur = await db.execute(
            """UPDATE card_payments SET status = ?, updated_at = ?
               WHERE id = ? AND status IN ('pending', 'waiting_review')""",
            (status, _now(), payment_id),
        )
        await db.commit()
        return cur.rowcount == 1


# ===================== صفِ اکشنِ ادمین (داشبورد) + یادآوری =====================

async def enqueue_action(payment_id, action):
    async with aiosqlite.connect(_path()) as db:
        await db.execute(
            "INSERT INTO card_admin_actions (payment_id, action) VALUES (?, ?)",
            (payment_id, action),
        )
        await db.commit()


async def pending_actions():
    async with aiosqlite.connect(_path()) as db:
        cur = await db.execute(
            "SELECT * FROM card_admin_actions WHERE done_at IS NULL ORDER BY id LIMIT 20")
        rows = await cur.fetchall()
        return [_row(cur, r) for r in rows]


async def mark_action_done(action_id):
    async with aiosqlite.connect(_path()) as db:
        await db.execute("UPDATE card_admin_actions SET done_at = ? WHERE id = ?", (_now(), action_id))
        await db.commit()


async def stale_receipts():
    """رسیدهای waiting_review قدیمی‌تر از ۲ ساعت که در ۴ ساعتِ اخیر یادآوری نشده‌اند."""
    async with aiosqlite.connect(_path()) as db:
        cur = await db.execute(
            """SELECT * FROM card_payments
               WHERE status = 'waiting_review' AND updated_at < ?
                 AND (reminded_at IS NULL OR reminded_at < ?) ORDER BY id""",
            (_now() - 7200, _now() - 14400),
        )
        rows = await cur.fetchall()
        return [_row(cur, r) for r in rows]


async def set_reminded(payment_id):
    async with aiosqlite.connect(_path()) as db:
        await db.execute("UPDATE card_payments SET reminded_at = ? WHERE id = ?", (_now(), payment_id))
        await db.commit()
