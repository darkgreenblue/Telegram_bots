"""نقطه‌ی ورود — یک polling loop موازی برای هر ربات (بله‌ی فارسی + یک ربات تلگرام per زبان)."""
import os
import asyncio
import logging
from logging.handlers import RotatingFileHandler

import db
import locales
from bale import Bale
import handlers
from handlers import handle_update
import config
from config import LOG_DIR, LOG_FILE

# --- لاگ‌گیریِ ماندگار: هم کنسول، هم فایلِ چرخشی (برای تشخیصِ بعدیِ مشکلات) ---
os.makedirs(LOG_DIR, exist_ok=True)
_fmt = logging.Formatter("%(asctime)s | %(levelname)s | %(name)s | %(message)s")

_console = logging.StreamHandler()
_console.setFormatter(_fmt)

_file = RotatingFileHandler(
    LOG_FILE, maxBytes=5_000_000, backupCount=10, encoding="utf-8"
)
_file.setFormatter(_fmt)

logging.basicConfig(level=logging.INFO, handlers=[_console, _file])
# httpx پر سر و صداست؛ فقط هشدار/خطا (ریکوئست‌های AI با لاگ‌های خودمان ردیابی می‌شوند)
logging.getLogger("httpx").setLevel(logging.WARNING)
log = logging.getLogger("bot")


async def polling_loop(bot: Bale):
    """حلقه‌ی long-polling برای یک ربات (پلتفرم×زبان)."""
    platform = bot.tag.upper()

    # هر loop مسیر DB خودش را set می‌کند (ContextVar)
    db.set_db_path(bot.db_path)
    await db.init_db(bot.db_path)
    log.info("[%s] database ready → %s", platform, bot.db_path)

    # کارت‌به‌کارت (تلگرامِ فارسی): جدول‌های cardpay + جاروی ۶۰ثانیه‌ایِ صفِ ادمین/یادآوری
    if config.payment_mode(bot.platform, bot.locale) == "card":
        try:
            await handlers.CARDPAY.ensure_schema()
            asyncio.create_task(_cardpay_sweep_loop(bot))
            log.info("[%s] cardpay فعال (کارت‌به‌کارت + ایجنتِ رسید)", platform)
        except Exception as e:
            log.warning("[%s] cardpay init failed: %s", platform, e)

    try:
        me = await bot.get_me()
        bot.bot_username = (me.get("username") or "").lstrip("@")
        log.info("[%s] bot: @%s (id=%s)", platform, bot.bot_username, me.get("id"))
    except Exception as e:
        log.warning("[%s] getMe failed (لینک دعوت ناقص): %s", platform, e)

    log.info("[%s] polling started…", platform)
    offset = None
    while True:
        try:
            updates = await bot.get_updates(offset=offset, timeout=30)
        except Exception as e:
            log.warning("[%s] getUpdates error: %s — retrying in 3s", platform, e)
            await asyncio.sleep(3)
            continue

        for update in updates or []:
            offset = update["update_id"] + 1
            # مطمئن می‌شویم ContextVar قبل از هر handler درست است
            db.set_db_path(bot.db_path)
            try:
                await handle_update(bot, update)
            except Exception as e:
                log.exception("[%s] handler error on update %s: %s",
                              platform, update.get("update_id"), e)


async def _cardpay_sweep_loop(bot: Bale):
    """جاروی ۶۰ثانیه‌ایِ کارت‌به‌کارت (fail-safe): درینِ صفِ ادمین + یادآوریِ رسیدِ معطل.
    ContextVarِ مسیرِ DB در همین تسک ست می‌شود (چون تسکِ جدا کپیِ کانتکست دارد)."""
    while True:
        await asyncio.sleep(60)
        try:
            db.set_db_path(bot.db_path)
            await handlers.CARDPAY.sweep(bot)
        except Exception as e:
            log.warning("[%s] cardpay sweep error: %s", bot.tag.upper(), e)


async def main():
    # اعتبارسنجی هماهنگیِ زبان‌ها (هر زبان باید ساختار locale مرجع را داشته باشد)
    warns = locales.validate()
    if warns:
        for w in warns:
            log.warning("[LOCALE] %s", w)
    else:
        log.info("[LOCALE] همه‌ی %d زبان هماهنگ‌اند: %s",
                 len(locales.LANG_ORDER), ", ".join(locales.LANG_ORDER))

    # هر instance با توکنِ ست‌شده یک polling-loop می‌گیرد؛ بقیه فقط warning (راه‌اندازیِ تدریجی زبان‌ها)
    tasks = []
    for spec in config.bot_instances():
        tag = f"{spec['platform']}:{spec['locale']}"
        if spec["token"]:
            tasks.append(polling_loop(Bale.for_instance(spec)))
            log.info("[%s] فعال — db=%s", tag.upper(), spec["db"])
        else:
            log.warning("[%s] توکن تنظیم نشده — این ربات غیرفعال است", tag.upper())

    if not tasks:
        raise SystemExit("هیچ توکنی تنظیم نشده — حداقل توکنِ یکی از ربات‌ها را در .env پر کن.")

    await asyncio.gather(*tasks)


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        log.info("bye 🌙")
