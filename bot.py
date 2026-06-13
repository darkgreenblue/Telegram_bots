"""نقطه‌ی ورود — دو polling loop موازی: بله + تلگرام."""
import os
import asyncio
import logging
from logging.handlers import RotatingFileHandler

import db
import locales
from bale import Bale
from handlers import handle_update
import config
from config import BALE_BOT_TOKEN, TELEGRAM_BOT_TOKEN, LOG_DIR, LOG_FILE

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
    """حلقه‌ی long-polling برای یک پلتفرم."""
    platform = bot.platform.upper()

    # هر loop مسیر DB خودش را set می‌کند (ContextVar)
    db.set_db_path(bot.db_path)
    await db.init_db(bot.db_path)
    log.info("[%s] database ready → %s", platform, bot.db_path)

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


async def main():
    # اعتبارسنجی هماهنگیِ زبان‌ها (هر زبان باید ساختار locale مرجع را داشته باشد)
    warns = locales.validate()
    if warns:
        for w in warns:
            log.warning("[LOCALE] %s", w)
    else:
        log.info("[LOCALE] همه‌ی %d زبان هماهنگ‌اند: %s",
                 len(locales.LANG_ORDER), ", ".join(locales.LANG_ORDER))

    tasks = []

    if BALE_BOT_TOKEN:
        tasks.append(polling_loop(Bale.for_bale()))
    else:
        log.warning("BALE_BOT_TOKEN تنظیم نشده — ربات بله غیرفعال")

    if TELEGRAM_BOT_TOKEN:
        tasks.append(polling_loop(Bale.for_telegram()))
    else:
        log.warning("TELEGRAM_BOT_TOKEN تنظیم نشده — ربات تلگرام غیرفعال")

    if not tasks:
        raise SystemExit("هیچ توکنی تنظیم نشده — حداقل یکی از BALE_BOT_TOKEN یا TELEGRAM_BOT_TOKEN را پر کن.")

    await asyncio.gather(*tasks)


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        log.info("bye 🌙")
