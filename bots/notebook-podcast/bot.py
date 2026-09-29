"""Private Telegram collector for NotebookLM Audio Overviews."""

import asyncio
import logging
import os
import re
import uuid
from datetime import datetime, timezone
from pathlib import Path

from dotenv import load_dotenv
from telegram import InlineKeyboardButton, InlineKeyboardMarkup, ReplyKeyboardMarkup, Update
from telegram.ext import Application, CallbackQueryHandler, CommandHandler, ContextTypes, MessageHandler, filters

from notebook import generate, upload
from store import Store

ROOT = Path(__file__).resolve().parent
load_dotenv(ROOT / ".env")
TOKEN = os.getenv("BOT_TOKEN", "")
OWNER_IDS = {int(x) for x in os.getenv("ADMIN_IDS", "").split(",") if x.strip().isdigit()}
PROFILE = os.getenv("NOTEBOOKLM_PROFILE", "notebook-podcast")
DATA = ROOT / "data"
MAX_FILE = 20 * 1024 * 1024
MAX_AUDIO = 50 * 1024 * 1024
MAX_SOURCES = 300
START = "📥 ورود ورودی‌ها"
DONE = "✅ ورودی‌ها تمام شد"
RETRY = "🔁 تلاش دوباره"
MENU = ReplyKeyboardMarkup([[START], [DONE]], resize_keyboard=True, is_persistent=True)
URL = re.compile(r"^https?://\S+$", re.IGNORECASE)
LOG = logging.getLogger("notebook-podcast")
store = Store(DATA / "bot.db")
jobs: dict[int, asyncio.Task] = {}


def allowed(update: Update) -> bool:
    return bool(
        update.effective_user
        and update.effective_user.id in OWNER_IDS
        and update.effective_chat
        and update.effective_chat.type == "private"
    )


def buttons(prefix: str, choices: list[tuple[str, str]]) -> InlineKeyboardMarkup:
    return InlineKeyboardMarkup([
        [InlineKeyboardButton(label, callback_data=f"{prefix}:{value}")]
        for label, value in choices
    ])


def save(owner_id: int, session: dict) -> None:
    store.put(owner_id, session)


async def start(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    if not allowed(update):
        return
    await update.message.reply_text(
        "برای ساخت پادکست، «ورود ورودی‌ها» را بزن.", reply_markup=MENU
    )


async def begin(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    owner = update.effective_user.id
    current = store.get(owner)
    if current and current["state"] not in {"done", "error_upload", "error_generate"}:
        await update.message.reply_text("یک درخواست باز داری. آن را کامل کن یا پس از خطا دوباره تلاش کن.")
        return
    batch_id = uuid.uuid4().hex
    session = {
        "batch_id": batch_id,
        "notebook_title": f"Telegram podcast {datetime.now(timezone.utc):%Y-%m-%d} {batch_id[:8]}",
        "state": "collecting",
        "inputs": [],
        "work_dir": str(DATA / str(owner) / batch_id),
    }
    save(owner, session)
    await update.message.reply_text(
        "حالا متن، فایل یا لینک‌ها را بفرست. تا «ورودی‌ها تمام شد» را نزنی، پیامی نمی‌فرستم.",
        reply_markup=MENU,
    )


def parse_message(message) -> list[dict]:
    document = getattr(message, "document", None)
    video = getattr(message, "video", None)
    audio = getattr(message, "audio", None)
    voice = getattr(message, "voice", None)
    photos = getattr(message, "photo", None)
    media = document or video or audio or voice or (photos[-1] if photos else None)
    if media:
        fallback = (
            "video.mp4" if video else "audio.m4a" if audio else
            "voice.ogg" if voice else "photo.jpg" if photos else "file"
        )
        name = Path(getattr(media, "file_name", None) or fallback).name[:120]
        if media.file_size and media.file_size > MAX_FILE:
            error = "حجم فایل از سقف دریافت ۲۰ مگابایت تلگرام بیشتر است"
        else:
            error = None
        items = [{"kind": "file", "file_id": media.file_id, "filename": name, "error": error}]
        if getattr(message, "caption", None):
            items.append({"kind": "text", "value": message.caption.strip()})
        return items
    if message.text:
        lines = [line.strip() for line in message.text.splitlines() if line.strip()]
        if lines and all(URL.fullmatch(line) for line in lines):
            return [{"kind": "url", "value": line} for line in lines]
        return [{"kind": "text", "value": message.text.strip()}]
    return [{"kind": "unsupported", "error": "این نوع پیام منبع قابل‌ارسال نیست"}]


async def finish(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    owner = update.effective_user.id
    session = store.get(owner)
    if not session or session["state"] != "collecting":
        await update.message.reply_text("ابتدا «ورود ورودی‌ها» را بزن.")
        return
    if not session["inputs"]:
        await update.message.reply_text("هنوز ورودی‌ای نفرستاده‌ای.")
        return
    bad = [str(i + 1) for i, item in enumerate(session["inputs"]) if item.get("error")]
    if bad:
        session["state"] = "error_upload"
        save(owner, session)
        await update.message.reply_text(
            f"ورودی‌های {', '.join(bad)} قابل‌پردازش نیستند. برای اصلاح، «ورود ورودی‌ها» را بزن و مجموعه را دوباره بفرست."
        )
        return
    session["state"] = "uploading"
    save(owner, session)
    await update.message.reply_text(f"{len(session['inputs'])} ورودی ثبت شد. دارم آن‌ها را به نوت‌بوک تازه می‌فرستم.")
    launch_job(owner, context.application)


async def on_message(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    if not allowed(update):
        return
    message = update.effective_message
    if message.text == START:
        await begin(update, context)
        return
    if message.text == DONE:
        await finish(update, context)
        return
    if message.text == RETRY:
        await retry(update, context)
        return
    owner = update.effective_user.id
    session = store.get(owner)
    if not session:
        await message.reply_text("برای شروع «ورود ورودی‌ها» را بزن.", reply_markup=MENU)
        return
    if session["state"] == "collecting":
        incoming = parse_message(message)
        space = max(0, MAX_SOURCES - len(session["inputs"]))
        session["inputs"].extend(incoming[:space])
        if len(incoming) > space and not any(
            item.get("error") == "سقف ۳۰۰ منبع در یک نوت‌بوک پر شده است"
            for item in session["inputs"]
        ):
            session["inputs"].append({"kind": "unsupported", "error": "سقف ۳۰۰ منبع در یک نوت‌بوک پر شده است"})
        save(owner, session)
        return  # Intentionally silent for every input.
    if session["state"] == "prompt" and message.text:
        session["prompt"] = message.text.strip()
        session["state"] = "generating"
        save(owner, session)
        await message.reply_text("تنظیمات ثبت شد. ساخت پادکست شروع شد و ممکن است چند دقیقه طول بکشد.")
        launch_job(owner, context.application)
    elif session["state"] == "language_custom" and message.text:
        code = message.text.strip().lower()
        if not re.fullmatch(r"[a-z]{2}(?:-[a-z]{2})?", code):
            await message.reply_text("کد زبان را مثل fa، en یا tr بفرست.")
            return
        session["language"] = code
        session["state"] = "length"
        save(owner, session)
        await message.reply_text(
            "طول پادکست را انتخاب کن:",
            reply_markup=buttons("length", [("کوتاه", "short"), ("معمولی", "default"), ("بلند", "long")]),
        )


async def on_choice(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    if not allowed(update):
        return
    query = update.callback_query
    await query.answer()
    owner = update.effective_user.id
    session = store.get(owner)
    if not session or ":" not in query.data:
        return
    kind, value = query.data.split(":", 1)
    if kind == "format" and session["state"] == "format" and value in {"deep-dive", "brief", "critique", "debate"}:
        session["format"] = value
        session["state"] = "language"
        save(owner, session)
        await query.message.reply_text(
            "زبان پادکست را انتخاب کن:",
            reply_markup=buttons("language", [("فارسی", "fa"), ("انگلیسی", "en"), ("زبان دیگر", "other")]),
        )
    elif kind == "language" and session["state"] == "language" and value == "other":
        session["state"] = "language_custom"
        save(owner, session)
        await query.message.reply_text("کد زبان دلخواه را بفرست؛ مثلاً tr برای ترکی یا ar برای عربی.")
    elif kind == "language" and session["state"] == "language" and value in {"fa", "en"}:
        session["language"] = value
        session["state"] = "length"
        save(owner, session)
        await query.message.reply_text(
            "طول پادکست را انتخاب کن:",
            reply_markup=buttons("length", [("کوتاه", "short"), ("معمولی", "default"), ("بلند", "long")]),
        )
    elif kind == "length" and session["state"] == "length" and value in {"short", "default", "long"}:
        session["length"] = value
        session["state"] = "prompt"
        save(owner, session)
        await query.message.reply_text(
            "پرامپت راهنما را بفرست؛ مثلاً موضوع یا سطح توضیح را مشخص کن. اگر پرامپتی نداری، «بدون پرامپت» را بزن.",
            reply_markup=buttons("prompt", [("بدون پرامپت", "skip")]),
        )
    elif kind == "prompt" and session["state"] == "prompt" and value == "skip":
        session["prompt"] = ""
        session["state"] = "generating"
        save(owner, session)
        await query.message.reply_text("تنظیمات ثبت شد. ساخت پادکست شروع شد و ممکن است چند دقیقه طول بکشد.")
        launch_job(owner, context.application)


async def retry(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    owner = update.effective_user.id
    session = store.get(owner)
    if not session or session["state"] not in {"error_upload", "error_generate"}:
        return
    if any(item.get("error") for item in session["inputs"]):
        await update.message.reply_text("ورودی نامعتبر باید با یک مجموعهٔ تازه جایگزین شود.")
        return
    session["state"] = "uploading" if session["state"] == "error_upload" else "generating"
    save(owner, session)
    await update.message.reply_text("دوباره تلاش می‌کنم.")
    launch_job(owner, context.application)


def launch_job(owner: int, app: Application) -> None:
    old = jobs.get(owner)
    if old and not old.done():
        return
    task = app.create_task(run_job(owner, app))
    jobs[owner] = task


async def run_job(owner: int, app: Application) -> None:
    session = store.get(owner)
    if not session:
        return
    try:
        if session["state"] == "uploading":
            async def download_file(file_id: str, target: Path) -> None:
                tg_file = await app.bot.get_file(file_id)
                await tg_file.download_to_drive(custom_path=target)

            await upload(session, lambda s: save(owner, s), download_file, PROFILE)
            session["state"] = "format"
            save(owner, session)
            await app.bot.send_message(
                owner,
                "همهٔ ورودی‌ها وارد نوت‌بوک شدند. قالب پادکست را انتخاب کن:",
                reply_markup=buttons("format", [
                    ("گفت‌وگوی عمیق", "deep-dive"), ("خلاصهٔ کوتاه", "brief"),
                    ("نقد", "critique"), ("مناظره", "debate"),
                ]),
            )
            return
        if session["state"] in {"generating", "sending"}:
            if session["state"] == "generating":
                output = await generate(session, lambda s: save(owner, s), PROFILE)
                session["state"] = "sending"
                save(owner, session)
            else:
                output = Path(session["work_dir"]) / f"{session['batch_id']}.m4a"
                if not output.exists():
                    output = await generate(session, lambda s: save(owner, s), PROFILE)
            if output.stat().st_size > MAX_AUDIO:
                session["state"] = "done"
                save(owner, session)
                output.unlink(missing_ok=True)
                await app.bot.send_message(
                    owner,
                    "پادکست ساخته شد، اما فایل از سقف ارسال ۵۰ مگابایت تلگرام بزرگ‌تر است. "
                    f"می‌توانی آن را در نوت‌بوک خودت ببینی: https://notebooklm.google.com/notebook/{session['notebook_id']}",
                )
                return
            with output.open("rb") as stream:
                await app.bot.send_audio(owner, stream, filename="podcast.m4a")
            session["state"] = "done"
            save(owner, session)
            output.unlink(missing_ok=True)
    except Exception as exc:
        LOG.error("Job failed for owner %s: %s", owner, type(exc).__name__)
        session = store.get(owner) or session
        failed_upload = session["state"] == "uploading"
        session["state"] = "error_upload" if failed_upload else "error_generate"
        save(owner, session)
        if isinstance(exc, ValueError):
            detail = str(exc)
        elif failed_upload:
            first = next((i + 1 for i, item in enumerate(session["inputs"]) if not item.get("source_id")), "؟")
            detail = f"ارسال ورودی {first} به NotebookLM ناموفق بود"
        else:
            detail = "اتصال یا پردازش NotebookLM ناموفق بود"
        await app.bot.send_message(
            owner, f"{detail}. ورودی‌ها و نوت‌بوک حفظ شدند. برای تکرار «{RETRY}» را بزن.",
            reply_markup=ReplyKeyboardMarkup([[RETRY], [START]], resize_keyboard=True),
        )


async def post_init(app: Application) -> None:
    for owner, _ in store.active():
        launch_job(owner, app)
    # Re-show the unanswered settings question if a deployment happened mid-flow.
    for owner in OWNER_IDS:
        session = store.get(owner)
        if not session:
            continue
        state = session["state"]
        if state == "format":
            await app.bot.send_message(owner, "قالب پادکست را انتخاب کن:", reply_markup=buttons("format", [
                ("گفت‌وگوی عمیق", "deep-dive"), ("خلاصهٔ کوتاه", "brief"),
                ("نقد", "critique"), ("مناظره", "debate"),
            ]))
        elif state == "language":
            await app.bot.send_message(owner, "زبان پادکست را انتخاب کن:", reply_markup=buttons("language", [
                ("فارسی", "fa"), ("انگلیسی", "en"), ("زبان دیگر", "other"),
            ]))
        elif state == "length":
            await app.bot.send_message(owner, "طول پادکست را انتخاب کن:", reply_markup=buttons("length", [
                ("کوتاه", "short"), ("معمولی", "default"), ("بلند", "long"),
            ]))
        elif state == "prompt":
            await app.bot.send_message(owner, "پرامپت راهنما را بفرست یا «بدون پرامپت» را بزن.", reply_markup=buttons("prompt", [
                ("بدون پرامپت", "skip"),
            ]))
        elif state == "language_custom":
            await app.bot.send_message(owner, "کد زبان دلخواه را بفرست؛ مثلاً tr یا ar.")


def main() -> None:
    if not TOKEN or not OWNER_IDS:
        raise SystemExit("BOT_TOKEN یا ADMIN_IDS خالی است")
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
    app = Application.builder().token(TOKEN).post_init(post_init).build()
    app.add_handler(CommandHandler("start", start))
    app.add_handler(CallbackQueryHandler(on_choice))
    app.add_handler(MessageHandler(filters.ALL & ~filters.COMMAND, on_message))
    app.run_polling(drop_pending_updates=False)


if __name__ == "__main__":
    main()
