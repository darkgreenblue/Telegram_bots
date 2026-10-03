"""Private Telegram collector for NotebookLM Audio Overviews."""

import asyncio
import logging
import os
import re
import sys
import uuid
from pathlib import Path

from dotenv import load_dotenv
from telegram import InlineKeyboardButton, InlineKeyboardMarkup, ReplyKeyboardMarkup, Update
from telegram.request import HTTPXRequest
from telegram.ext import Application, CallbackQueryHandler, CommandHandler, ContextTypes, MessageHandler, filters

from notebook import InputValidationError
from store import Store
from studio import KIND_LABELS, KINDS, STEPS, output_path

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
NOTEBOOKS = "📚 نوت‌بوک‌های من"
RETRY = "🔁 تلاش دوباره"
MENU = ReplyKeyboardMarkup([[START], [NOTEBOOKS], [DONE]], resize_keyboard=True, is_persistent=True)
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


def output_buttons(batch_id: str) -> InlineKeyboardMarkup:
    return buttons("output", [(title, kind) for kind, title in KINDS], batch_id)


def label(session: dict) -> str:
    return f"#{session['batch_id'][:8]}"


def notebook_sources(session: dict) -> list[str]:
    return session.get("source_ids") or [i["source_id"] for i in session.get("inputs", []) if i.get("source_id")]


def saved_notebooks(owner: int) -> list[dict]:
    found = set()
    result = []
    for session in store.list(owner):
        notebook_id = session.get("notebook_id")
        if notebook_id and notebook_id not in found and notebook_sources(session) and session.get("state") not in {"uploading", "error_upload"}:
            found.add(notebook_id)
            result.append(session)
    return result


async def show_notebooks(owner: int, message, page: int = 0) -> None:
    notebooks = saved_notebooks(owner)
    if not notebooks:
        await message.reply_text("هنوز نوت‌بوکی با این ربات نساخته‌ای.")
        return
    page = max(0, min(page, (len(notebooks) - 1) // 8))
    rows = [
        [InlineKeyboardButton(s.get("notebook_title", "بدون نام")[:40], callback_data=f"pick:{s['batch_id']}")]
        for s in notebooks[page * 8:(page + 1) * 8]
    ]
    navigation = []
    if page:
        navigation.append(InlineKeyboardButton("⬅️ قبلی", callback_data=f"npage:{page - 1}"))
    if (page + 1) * 8 < len(notebooks):
        navigation.append(InlineKeyboardButton("بعدی ➡️", callback_data=f"npage:{page + 1}"))
    if navigation:
        rows.append(navigation)
    await message.reply_text("یک نوت‌بوک را برای ساخت خروجی تازه انتخاب کن:", reply_markup=InlineKeyboardMarkup(rows))


async def choose_notebook(owner: int, reference: dict, message) -> None:
    if store.open_count(owner) >= MAX_REQUESTS:
        await message.reply_text("سه درخواست باز داری. پس از پایان یکی از آن‌ها دوباره تلاش کن.")
        return
    batch_id = uuid.uuid4().hex
    session = {
        "batch_id": batch_id,
        "notebook_id": reference["notebook_id"],
        "notebook_title": reference.get("notebook_title", "بدون نام"),
        "source_ids": notebook_sources(reference),
        "state": "output_type",
        "inputs": [],
        "work_dir": str(DATA / str(owner) / batch_id),
    }
    save(owner, session)
    await message.reply_text(
        f"نوت‌بوک «{session['notebook_title']}» انتخاب شد. خروجی تازهٔ {label(session)} را انتخاب کن:\nhttps://notebooklm.google.com/notebook/{session['notebook_id']}",
        reply_markup=output_buttons(batch_id),
    )


async def ask_studio_next(owner: int, session: dict, send) -> None:
    steps = STEPS[session["output_type"]]
    index = session.get("option_index", 0)
    if index < len(steps):
        key, question, choices = steps[index]
        session["state"] = "studio_setting"
        save(owner, session)
        await send(f"{question} برای {KIND_LABELS[session['output_type']]} {label(session)}:", reply_markup=buttons("setting", choices, session["batch_id"]))
    else:
        session["state"] = "studio_prompt"
        sent = await send(
            f"اگر راهنمایی برای {KIND_LABELS[session['output_type']]} {label(session)} داری، در پاسخ به همین پیام بفرست؛ وگرنه «بدون پرامپت» را بزن.",
            reply_markup=buttons("studio_prompt", [("بدون پرامپت", "skip")], session["batch_id"]),
        )
        if getattr(sent, "message_id", None):
            session["settings_message_id"] = sent.message_id
        save(owner, session)


def save(owner_id: int, session: dict) -> None:
    store.put(owner_id, session)


async def start(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    if not allowed(update):
        return
    await update.message.reply_text(
        "برای ساخت نوت‌بوک تازه «ورود ورودی‌ها» را بزن؛ برای خروجی تازه از منابع قبلی «نوت‌بوک‌های من» را انتخاب کن.", reply_markup=MENU
    )


async def begin(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    owner = update.effective_user.id
    empty = store.latest_in_state(owner, "collecting")
    if empty and not empty.get("inputs") and not empty.get("notebook_id"):
        empty["state"] = "title"
        empty["notebook_title"] = ""
        save(owner, empty)
        sent = await update.message.reply_text(f"نام نوت‌بوک تازهٔ {label(empty)} را بفرست؛ همان نام در NotebookLM ثبت می‌شود.", reply_markup=MENU)
        if getattr(sent, "message_id", None):
            empty["settings_message_id"] = sent.message_id
            save(owner, empty)
        return
    if store.latest_in_state(owner, "title", "collecting"):
        await update.message.reply_text("نام‌گذاری یا دریافت ورودیِ یک مجموعه باز است؛ اول همان را تمام کن.")
        return
    if store.open_count(owner) >= MAX_REQUESTS:
        await update.message.reply_text("سه درخواست باز داری. پس از پایان یکی از آن‌ها، مجموعهٔ بعدی را شروع کن.")
        return
    batch_id = uuid.uuid4().hex
    session = {
        "batch_id": batch_id,
        "notebook_title": "",
        "state": "title",
        "inputs": [],
        "work_dir": str(DATA / str(owner) / batch_id),
    }
    save(owner, session)
    sent = await update.message.reply_text(f"نام نوت‌بوک تازهٔ {label(session)} را بفرست؛ همان نام در NotebookLM ثبت می‌شود.", reply_markup=MENU)
    if getattr(sent, "message_id", None):
        session["settings_message_id"] = sent.message_id
        save(owner, session)


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
    if message.text == NOTEBOOKS:
        await show_notebooks(update.effective_user.id, message)
        return
    if message.text == RETRY:
        await retry(update, context)
        return
    owner = update.effective_user.id
    collecting = store.latest_in_state(owner, "collecting")
    waiting = [s for s in store.list(owner) if s["state"] in {"title", "prompt", "language_custom", "studio_prompt", "studio_language_custom"}]
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
    if session["state"] == "title":
        title = (message.text or "").strip()
        if not title or len(title) > 100:
            await message.reply_text("نام نوت‌بوک را به‌صورت متن، بین ۱ تا ۱۰۰ نویسه بفرست.")
            return
        session["notebook_title"] = title
        session["create_title"] = f"Telegram draft {session['batch_id']}"
        session["state"] = "collecting"
        save(owner, session)
        await message.reply_text(f"نوت‌بوک «{title}» ثبت شد. حالا ورودی‌های {label(session)} را بفرست. تا «ورودی‌ها تمام شد» را نزنی، پیامی نمی‌فرستم.", reply_markup=MENU)
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
    elif session["state"] == "studio_language_custom" and message.text:
        code = message.text.strip().lower()
        if not re.fullmatch(r"[a-z]{2}(?:-[a-z]{2})?", code):
            await message.reply_text("کد زبان را مثل fa، en یا tr بفرست.")
            return
        session["language"] = code
        await ask_studio_next(owner, session, message.reply_text)
    elif session["state"] == "studio_prompt" and message.text:
        prompt = message.text.strip()
        if not prompt:
            await message.reply_text("پرامپت را بنویس یا «بدون پرامپت» را انتخاب کن.")
            return
        session["prompt"] = prompt
        session["state"] = "generating"
        save(owner, session)
        await message.reply_text(f"ساخت {KIND_LABELS[session['output_type']]} {label(session)} شروع شد و ممکن است چند دقیقه طول بکشد.")
        launch_job(owner, session["batch_id"], context.application)


async def on_choice(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    if not allowed(update):
        return
    query = update.callback_query
    await query.answer()
    owner = update.effective_user.id
    if query.data.startswith("npage:"):
        try:
            page = int(query.data.split(":", 1)[1])
        except ValueError:
            return
        await show_notebooks(owner, query.message, page)
        return
    if query.data.startswith("pick:"):
        batch_id = query.data.split(":", 1)[1]
        reference = next((s for s in saved_notebooks(owner) if s["batch_id"] == batch_id), None)
        if reference:
            await choose_notebook(owner, reference, query.message)
        return
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
    if kind == "output" and session["state"] == "output_type" and value in KIND_LABELS:
        session["output_type"] = value
        session["settings"] = {}
        session["option_index"] = 0
        session["state"] = "studio_language"
        save(owner, session)
        await query.message.reply_text(
            f"زبان {KIND_LABELS[value]} {label(session)} را انتخاب کن:",
            reply_markup=buttons("studio_lang", [("فارسی", "fa"), ("انگلیسی", "en"), ("زبان دیگر", "other")], session["batch_id"]),
        )
        return
    if kind == "studio_lang" and session["state"] == "studio_language":
        if value == "other":
            session["state"] = "studio_language_custom"
            sent = await query.message.reply_text(f"کد زبان {label(session)} را در پاسخ به همین پیام بفرست؛ مثلاً tr یا ar.")
            if getattr(sent, "message_id", None):
                session["settings_message_id"] = sent.message_id
            save(owner, session)
        elif value in {"fa", "en"}:
            session["language"] = value
            await ask_studio_next(owner, session, query.message.reply_text)
        return
    if kind == "setting" and session["state"] == "studio_setting":
        steps = STEPS[session["output_type"]]
        index = session.get("option_index", 0)
        if index >= len(steps):
            return
        key, _, choices = steps[index]
        if value not in {choice for _, choice in choices}:
            return
        session["settings"][key] = value
        session["option_index"] = index + 1
        await ask_studio_next(owner, session, query.message.reply_text)
        return
    if kind == "studio_prompt" and session["state"] == "studio_prompt" and value == "skip":
        if session["output_type"] == "report" and session.get("settings", {}).get("report_format") == "custom":
            await query.message.reply_text("برای گزارش سفارشی باید پرامپت بنویسی و به پیام قبلی Reply بزنی.")
            return
        session["prompt"] = ""
        session["state"] = "generating"
        save(owner, session)
        await query.message.reply_text(f"ساخت {KIND_LABELS[session['output_type']]} {label(session)} شروع شد و ممکن است چند دقیقه طول بکشد.")
        launch_job(owner, session["batch_id"], context.application)
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
    session["state"] = "uploading" if session["state"] == "error_upload" or (
        not session.get("output_type") and notebook_sources(session)
    ) else "generating"
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
            session["source_ids"] = notebook_sources(session)
            await app.bot.send_message(
                owner,
                f"همهٔ ورودی‌های {label(session)} وارد نوت‌بوک «{session['notebook_title']}» شدند. نوع خروجی را انتخاب کن:\nhttps://notebooklm.google.com/notebook/{session['notebook_id']}",
                reply_markup=output_buttons(batch_id),
            )
            session["state"] = "output_type"
            save(owner, session)
            return
        if session["state"] in {"generating", "sending"}:
            kind = session.get("output_type", "audio")
            output = output_path(session) if session.get("output_type") else Path(session["work_dir"]) / f"{batch_id}.m4a"
            if session["state"] == "generating":
                session["state"] = "sending"
                save(owner, session)
            if output.stat().st_size > MAX_AUDIO:
                session["state"] = "done"
                save(owner, session)
                output.unlink(missing_ok=True)
                await app.bot.send_message(
                    owner,
                    f"{KIND_LABELS[kind]} {label(session)} ساخته شد، اما فایل از سقف ارسال ۵۰ مگابایت تلگرام بزرگ‌تر است. "
                    f"می‌توانی آن را در نوت‌بوک خودت ببینی: https://notebooklm.google.com/notebook/{session['notebook_id']}",
                )
                return
            with output.open("rb") as stream:
                filename = f"{kind}-{batch_id[:8]}{output.suffix}"
                caption = f"{KIND_LABELS[kind]} از «{session['notebook_title']}» {label(session)}"
                if kind == "audio":
                    await app.bot.send_audio(owner, stream, filename=filename, caption=caption)
                elif kind in {"video", "cinematic"}:
                    await app.bot.send_video(owner, stream, filename=filename, caption=caption)
                else:
                    await app.bot.send_document(owner, stream, filename=filename, caption=caption)
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
            if state == "title":
                sent = await app.bot.send_message(owner, f"نام نوت‌بوک تازهٔ {label(session)} را بفرست.")
                session["settings_message_id"] = sent.message_id
                save(owner, session)
            elif state == "output_type":
                await app.bot.send_message(owner, f"نوع خروجی نوت‌بوک «{session['notebook_title']}» {label(session)} را انتخاب کن:", reply_markup=output_buttons(batch_id))
            elif state == "studio_language":
                await app.bot.send_message(owner, f"زبان {KIND_LABELS[session['output_type']]} {label(session)} را انتخاب کن:", reply_markup=buttons("studio_lang", [
                    ("فارسی", "fa"), ("انگلیسی", "en"), ("زبان دیگر", "other"),
                ], batch_id))
            elif state == "studio_setting":
                async def send(text, reply_markup):
                    return await app.bot.send_message(owner, text, reply_markup=reply_markup)
                await ask_studio_next(owner, session, send)
            elif state == "studio_prompt":
                sent = await app.bot.send_message(owner, f"پرامپت {KIND_LABELS[session['output_type']]} {label(session)} را در پاسخ به همین پیام بفرست یا «بدون پرامپت» را بزن.", reply_markup=buttons("studio_prompt", [("بدون پرامپت", "skip")], batch_id))
                session["settings_message_id"] = sent.message_id
                save(owner, session)
            elif state == "studio_language_custom":
                sent = await app.bot.send_message(owner, f"کد زبان {label(session)} را در پاسخ به همین پیام بفرست؛ مثلاً tr یا ar.")
                session["settings_message_id"] = sent.message_id
                save(owner, session)
            elif state == "format":
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
    request = HTTPXRequest(connect_timeout=30, read_timeout=60, write_timeout=300)
    updates_request = HTTPXRequest(connect_timeout=30, read_timeout=35, write_timeout=30)
    app = (Application.builder().token(TOKEN).request(request)
           .get_updates_request(updates_request).post_init(post_init).build())
    app.add_handler(CommandHandler("start", start))
    app.add_handler(CallbackQueryHandler(on_choice))
    app.add_handler(MessageHandler(filters.ALL & ~filters.COMMAND, on_message))
    app.run_polling(drop_pending_updates=False)


if __name__ == "__main__":
    main()
