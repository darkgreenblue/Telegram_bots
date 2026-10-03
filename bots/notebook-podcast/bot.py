"""Private Telegram collector for NotebookLM Audio Overviews."""

import asyncio
import logging
import os
import re
import sys
import uuid
from datetime import datetime, timezone
from pathlib import Path

from dotenv import load_dotenv
from telegram import InlineKeyboardButton, InlineKeyboardMarkup, ReplyKeyboardMarkup, Update
from telegram.request import HTTPXRequest
from telegram.ext import Application, CallbackQueryHandler, CommandHandler, ContextTypes, MessageHandler, filters

from notebook import InputValidationError
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
jobs: dict[str, asyncio.Task] = {}
busy_slots: set[int] = set()
slot_lock = asyncio.Lock()
MAX_REQUESTS = 3


def allowed(update: Update) -> bool:
    return bool(
        update.effective_user
        and update.effective_user.id in OWNER_IDS
        and update.effective_chat
        and update.effective_chat.type == "private"
    )


def buttons(prefix: str, choices: list[tuple[str, str]], batch_id: str | None = None) -> InlineKeyboardMarkup:
    return InlineKeyboardMarkup([
        [InlineKeyboardButton(label, callback_data=f"{prefix}:{batch_id}:{value}" if batch_id else f"{prefix}:{value}")]
        for label, value in choices
    ])


def label(session: dict) -> str:
    return f"#{session['batch_id'][:8]}"


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
    if store.latest_in_state(owner, "collecting"):
        await update.message.reply_text("یک مجموعه در حال دریافت ورودی است؛ اول همان را تمام کن.")
        return
    if store.open_count(owner) >= MAX_REQUESTS:
        await update.message.reply_text("سه درخواست باز داری. پس از پایان یکی از آن‌ها، مجموعهٔ بعدی را شروع کن.")
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
        f"مجموعهٔ {label(session)} باز شد. حالا متن، فایل یا لینک‌ها را بفرست. تا «ورودی‌ها تمام شد» را نزنی، پیامی نمی‌فرستم.",
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
    session = store.latest_in_state(owner, "collecting")
    if not session:
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
    await update.message.reply_text(f"{len(session['inputs'])} ورودی برای {label(session)} ثبت شد. دارم آن‌ها را به نوت‌بوک تازه می‌فرستم.")
    launch_job(owner, session["batch_id"], context.application)


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
    collecting = store.latest_in_state(owner, "collecting")
    waiting = [s for s in store.list(owner) if s["state"] in {"prompt", "language_custom"}]
    replied_to = getattr(getattr(message, "reply_to_message", None), "message_id", None)
    session = next((s for s in waiting if s.get("settings_message_id") == replied_to), None)
    if session is None and not collecting:
        session = waiting[0] if len(waiting) == 1 else None
    if session is None and collecting:
        session = collecting
    if session is None and len(waiting) > 1:
        await message.reply_text("برای مشخص‌شدن درخواست، روی پیام تنظیمات همان مجموعه Reply بزن.")
        return
    if session is None:
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
        await message.reply_text(f"تنظیمات {label(session)} ثبت شد. ساخت پادکست شروع شد و ممکن است چند دقیقه طول بکشد.")
        launch_job(owner, session["batch_id"], context.application)
    elif session["state"] == "language_custom" and message.text:
        code = message.text.strip().lower()
        if not re.fullmatch(r"[a-z]{2}(?:-[a-z]{2})?", code):
            await message.reply_text("کد زبان را مثل fa، en یا tr بفرست.")
            return
        session["language"] = code
        session["state"] = "length"
        save(owner, session)
        await message.reply_text(
            f"طول پادکست {label(session)} را انتخاب کن:",
            reply_markup=buttons("length", [("کوتاه", "short"), ("معمولی", "default"), ("بلند", "long")], session["batch_id"]),
        )


async def on_choice(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    if not allowed(update):
        return
    query = update.callback_query
    await query.answer()
    owner = update.effective_user.id
    parts = query.data.split(":", 2)
    if len(parts) not in {2, 3}:
        return
    if len(parts) == 3:
        kind, batch_id, value = parts
        session = store.get(owner, batch_id)
    else:
        kind, value = parts
        session = store.latest_in_state(owner, kind, "language_custom" if kind == "language" else kind)
    if not session:
        return
    if kind == "retry" and value == "go" and session["state"] in {"error_upload", "error_generate"}:
        await retry_session(owner, session, query.message, context.application)
        return
    if kind == "format" and session["state"] == "format" and value in {"deep-dive", "brief", "critique", "debate"}:
        session["format"] = value
        session["state"] = "language"
        save(owner, session)
        await query.message.reply_text(
            f"زبان پادکست {label(session)} را انتخاب کن:",
            reply_markup=buttons("language", [("فارسی", "fa"), ("انگلیسی", "en"), ("زبان دیگر", "other")], session["batch_id"]),
        )
    elif kind == "language" and session["state"] == "language" and value == "other":
        session["state"] = "language_custom"
        sent = await query.message.reply_text(f"کد زبان دلخواه {label(session)} را در پاسخ به همین پیام بفرست؛ مثلاً tr یا ar.")
        session["settings_message_id"] = sent.message_id
        save(owner, session)
    elif kind == "language" and session["state"] == "language" and value in {"fa", "en"}:
        session["language"] = value
        session["state"] = "length"
        save(owner, session)
        await query.message.reply_text(
            f"طول پادکست {label(session)} را انتخاب کن:",
            reply_markup=buttons("length", [("کوتاه", "short"), ("معمولی", "default"), ("بلند", "long")], session["batch_id"]),
        )
    elif kind == "length" and session["state"] == "length" and value in {"short", "default", "long"}:
        session["length"] = value
        session["state"] = "prompt"
        sent = await query.message.reply_text(
            f"پرامپت راهنمای {label(session)} را در پاسخ به همین پیام بفرست؛ مثلاً موضوع یا سطح توضیح را مشخص کن. اگر پرامپتی نداری، «بدون پرامپت» را بزن.",
            reply_markup=buttons("prompt", [("بدون پرامپت", "skip")], session["batch_id"]),
        )
        session["settings_message_id"] = sent.message_id
        save(owner, session)
    elif kind == "prompt" and session["state"] == "prompt" and value == "skip":
        session["prompt"] = ""
        session["state"] = "generating"
        save(owner, session)
        await query.message.reply_text(f"تنظیمات {label(session)} ثبت شد. ساخت پادکست شروع شد و ممکن است چند دقیقه طول بکشد.")
        launch_job(owner, session["batch_id"], context.application)


async def retry(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    owner = update.effective_user.id
    session = store.latest_in_state(owner, "error_upload", "error_generate")
    if not session:
        return
    await retry_session(owner, session, update.message, context.application)


async def retry_session(owner: int, session: dict, message, app: Application) -> None:
    if store.open_count(owner) >= MAX_REQUESTS:
        await message.reply_text("سه درخواست باز داری. پس از پایان یکی از آن‌ها دوباره تلاش کن.")
        return
    if any(item.get("error") for item in session["inputs"]):
        await message.reply_text("ورودی نامعتبر باید با یک مجموعهٔ تازه جایگزین شود.")
        return
    session["state"] = "uploading" if session["state"] == "error_upload" else "generating"
    save(owner, session)
    await message.reply_text(f"درخواست {label(session)} را دوباره امتحان می‌کنم.")
    launch_job(owner, session["batch_id"], app)


def launch_job(owner: int, batch_id: str, app: Application) -> None:
    old = jobs.get(batch_id)
    if old and not old.done():
        return
    task = app.create_task(run_job(owner, batch_id, app))
    jobs[batch_id] = task


async def run_job(owner: int, batch_id: str, app: Application) -> None:
    session = store.get(owner, batch_id)
    if not session:
        return
    slot = None
    try:
        async with slot_lock:
            slot = next((n for n in range(MAX_REQUESTS) if n not in busy_slots), None)
            if slot is None:
                raise RuntimeError("No free proxy slot")
            busy_slots.add(slot)
        proxy_url = f"http://127.0.0.1:{18770 + slot}"
        env = os.environ.copy()
        env.update({key: proxy_url for key in ("HTTP_PROXY", "HTTPS_PROXY", "http_proxy", "https_proxy")})
        proc = await asyncio.create_subprocess_exec(
            sys.executable, str(ROOT / "job_worker.py"), str(owner), batch_id, session["state"], str(slot),
            env=env, stdout=asyncio.subprocess.DEVNULL, stderr=asyncio.subprocess.DEVNULL,
        )
        code = await proc.wait()
        session = store.get(owner, batch_id) or session
        if code == 2:
            raise InputValidationError(session.get("worker_error", "ورودی نامعتبر است"))
        if code != 0:
            raise RuntimeError(f"Worker exited with code {code}")
        if session["state"] == "uploading":
            session["state"] = "format"
            save(owner, session)
            await app.bot.send_message(
                owner,
                f"همهٔ ورودی‌های {label(session)} وارد نوت‌بوک شدند. قالب پادکست را انتخاب کن:",
                reply_markup=buttons("format", [
                    ("گفت‌وگوی عمیق", "deep-dive"), ("خلاصهٔ کوتاه", "brief"),
                    ("نقد", "critique"), ("مناظره", "debate"),
                ], batch_id),
            )
            return
        if session["state"] in {"generating", "sending"}:
            output = Path(session["work_dir"]) / f"{batch_id}.m4a"
            if session["state"] == "generating":
                session["state"] = "sending"
                save(owner, session)
            if output.stat().st_size > MAX_AUDIO:
                session["state"] = "done"
                save(owner, session)
                output.unlink(missing_ok=True)
                await app.bot.send_message(
                    owner,
                    f"پادکست {label(session)} ساخته شد، اما فایل از سقف ارسال ۵۰ مگابایت تلگرام بزرگ‌تر است. "
                    f"می‌توانی آن را در نوت‌بوک خودت ببینی: https://notebooklm.google.com/notebook/{session['notebook_id']}",
                )
                return
            with output.open("rb") as stream:
                await app.bot.send_audio(owner, stream, filename=f"podcast-{batch_id[:8]}.m4a")
            session["state"] = "done"
            save(owner, session)
            output.unlink(missing_ok=True)
    except Exception as exc:
        LOG.error("Job failed for request %s: %s", batch_id[:8], type(exc).__name__)
        session = store.get(owner, batch_id) or session
        failed_upload = session["state"] == "uploading"
        session["state"] = "error_upload" if failed_upload else "error_generate"
        save(owner, session)
        if isinstance(exc, InputValidationError):
            detail = str(exc)
        elif failed_upload:
            first = next((i + 1 for i, item in enumerate(session["inputs"]) if not item.get("source_id")), "؟")
            detail = f"ارسال ورودی {first} به NotebookLM ناموفق بود"
        else:
            detail = "اتصال یا پردازش NotebookLM ناموفق بود"
        await app.bot.send_message(
            owner, f"{label(session)}: {detail}. ورودی‌ها و نوت‌بوک حفظ شدند.",
            reply_markup=buttons("retry", [("🔁 تلاش دوباره", "go")], batch_id),
        )
    finally:
        if slot is not None:
            busy_slots.discard(slot)


async def post_init(app: Application) -> None:
    for owner, session in store.active():
        launch_job(owner, session["batch_id"], app)
    # Re-show the unanswered settings question if a deployment happened mid-flow.
    for owner in OWNER_IDS:
        for session in store.list(owner):
            state = session["state"]
            batch_id = session["batch_id"]
            if state == "format":
                await app.bot.send_message(owner, f"قالب پادکست {label(session)} را انتخاب کن:", reply_markup=buttons("format", [
                    ("گفت‌وگوی عمیق", "deep-dive"), ("خلاصهٔ کوتاه", "brief"),
                    ("نقد", "critique"), ("مناظره", "debate"),
                ], batch_id))
            elif state == "language":
                await app.bot.send_message(owner, f"زبان پادکست {label(session)} را انتخاب کن:", reply_markup=buttons("language", [
                    ("فارسی", "fa"), ("انگلیسی", "en"), ("زبان دیگر", "other"),
                ], batch_id))
            elif state == "length":
                await app.bot.send_message(owner, f"طول پادکست {label(session)} را انتخاب کن:", reply_markup=buttons("length", [
                    ("کوتاه", "short"), ("معمولی", "default"), ("بلند", "long"),
                ], batch_id))
            elif state == "prompt":
                sent = await app.bot.send_message(owner, f"پرامپت {label(session)} را در پاسخ به همین پیام بفرست یا «بدون پرامپت» را بزن.", reply_markup=buttons("prompt", [
                    ("بدون پرامپت", "skip"),
                ], batch_id))
                session["settings_message_id"] = sent.message_id
                save(owner, session)
            elif state == "language_custom":
                sent = await app.bot.send_message(owner, f"کد زبان {label(session)} را در پاسخ به همین پیام بفرست؛ مثلاً tr یا ar.")
                session["settings_message_id"] = sent.message_id
                save(owner, session)


def main() -> None:
    if not TOKEN or not OWNER_IDS:
        raise SystemExit("BOT_TOKEN یا ADMIN_IDS خالی است")
    # HTTP client INFO logs include the Bot API URL, which contains the bot token.
    logging.basicConfig(level=logging.WARNING, format="%(asctime)s %(levelname)s %(name)s %(message)s")
    request = HTTPXRequest(connect_timeout=30, read_timeout=30, write_timeout=30)
    updates_request = HTTPXRequest(connect_timeout=30, read_timeout=35, write_timeout=30)
    app = (Application.builder().token(TOKEN).request(request)
           .get_updates_request(updates_request).post_init(post_init).build())
    app.add_handler(CommandHandler("start", start))
    app.add_handler(CallbackQueryHandler(on_choice))
    app.add_handler(MessageHandler(filters.ALL & ~filters.COMMAND, on_message))
    app.run_polling(drop_pending_updates=False)


if __name__ == "__main__":
    main()
