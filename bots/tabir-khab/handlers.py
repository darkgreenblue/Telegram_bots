"""روتینگ آپدیت‌ها و کل منطق تعامل (بله + تلگرام) — چندزبانه در کد، تک‌زبانه در هر ربات.

هر رباتِ در حالِ اجرا زبانِ ثابت دارد (bale.locale) — مرحله‌ی انتخاب زبان حذف شده؛
هر زبان رباتِ تلگرامِ خودش را دارد (برای مارکتینگِ جدا). متن‌ها همچنان از locales
می‌آیند تا هر تغییرِ کد یک‌جا برای همه‌ی زبان‌ها اعمال شود.

جریان: آنبوردینگ ۵سؤالی → دریافت خواب → کارت تأیید → gate همسفری →
خروجی «اول عکس، بعد تعبیر».
"""
import os
import re
import time
import asyncio
import logging
import tempfile

import db
import ai
import config
import analytics
import locales
import payments
import symbols as SYM
import texts as C
import cardpay
from bale import inline_keyboard, reply_keyboard
from config import (
    SUBSCRIPTIONS, SUBSCRIPTION_ORDER,
    ADMIN_USER_ID, ADMIN_IDS, MIN_VOICE_DURATION, MAX_VOICE_DURATION,
    MIN_TEXT_CHARS, MAX_TEXT_CHARS,
    MASCOT_WELCOME, MASCOT_INVITE, SKIP_PAYMENT, SKIP_DAILY_LIMIT, NARRATE_INTERVAL,
    payment_methods_for, REFERRAL_ENABLED,
    FILE_API_TIMEOUT, DOWNLOAD_TIMEOUT, INTERPRET_TIMEOUT, IMAGE_TIMEOUT,
    RESET_BUTTON_ENABLED, PRODUCT_VERSION, is_admin,
    OPENROUTER_API_KEY, OPENROUTER_BASE_URL, RECEIPT_MODEL, RECEIPT_AI_AUTO_APPROVE,
    CARD_NUMBER, CARD_OWNER, CARD_RECIPIENT_NAME, CARD_DEST_LAST4, SUPPORT_CONTACT,
)

log = logging.getLogger("handlers")

# قفل ضد کلیک/پیام رگباری — کلید: (bot-tag, user_id, scope) — tag چون چند ربات تلگرامی داریم
_processing: set = set()

_REF_RE = re.compile(r"^ref_(\d+)$")
_CAPTION_SAFE = 1000  # حاشیه‌ی امن زیر سقف ۱۰۲۴ کپشن


# ===================== کارت‌به‌کارت (تلگرامِ فارسی) =====================
# ماژولِ قابلِ‌حملِ cardpay: نمایشِ کارت → دریافتِ رسید → ایجنتِ Gemini Flash → تأیید/رد/ارجاع.
# on_approved = گلوِ tabir: فعال‌سازیِ اشتراک (از مسیرِ موجودِ apply_successful_payment) + resumeِ گیت‌شده.
cardpay.store.configure(db._path)


async def _cardpay_on_approved(bot, payment):
    import uuid
    tier = payment.get("tier")
    sub = SUBSCRIPTIONS.get(tier)
    if not sub:
        return
    user_id = payment["user_id"]
    chat_id = payment.get("chat_id") or user_id
    payload = f"card_{tier}_{uuid.uuid4().hex}"
    await db.create_transaction(user_id, tier, sub["days"], sub["rial"], payload)
    # رفرنسِ تراکنش را روی رکوردِ cardpay ذخیره کن تا در صورتِ برگشت (رسیدِ فیک) قابل لغو باشد
    try:
        await cardpay.store.set_txn_payload(payment["id"], payload)
    except Exception:
        pass
    # apply_successful_payment: فعال‌سازی/تمدید + آنالیتیکس + پیام موفقیت + تحویلِ خودکارِ خوابِ تریالِ معلق
    await payments.apply_successful_payment(bot, user_id, payload, charge_id="CARD")
    # خوابِ awaiting_payment را فقط اگر از مسیرِ پی‌وال آمده resume کن (گیتِ استیت‌منیجمنت)
    if payment.get("resume"):
        await _try_resume_pending_dream(bot, chat_id, user_id)
    else:
        try:
            text, rows = C.main_menu_message(bot.locale)
            await bot.send_message(chat_id, text, reply_markup=inline_keyboard(rows))
        except Exception:
            pass


async def _cardpay_on_rejected(bot, payment, reason):
    return  # ماژول خودش کاربر را با دلیل مطلع کرده


async def _cardpay_on_reversed(bot, payment):
    """برگشتِ پرداختِ فیک: اشتراکِ ناشی از آن پرداخت لغو و از درآمد کنار می‌رود (مصرف‌شده اشکال ندارد).
    کاربر به حالتِ قبل (غیرمشترک) برمی‌گردد؛ ماژول خودش او را بی‌اعتماد و مطلع کرده."""
    tier = payment.get("tier")
    sub = SUBSCRIPTIONS.get(tier)
    if sub:
        await db.reverse_subscription(payment["user_id"], sub["days"])
    txn = payment.get("txn_payload")
    if txn:
        await db.mark_transaction_reversed(txn)


CARDPAY = cardpay.CardPay(
    card_number=CARD_NUMBER, card_owner=CARD_OWNER, recipient_name=CARD_RECIPIENT_NAME,
    dest_last4=CARD_DEST_LAST4, api_key=OPENROUTER_API_KEY, base_url=OPENROUTER_BASE_URL,
    model=RECEIPT_MODEL, auto_approve=RECEIPT_AI_AUTO_APPROVE, admin_ids=ADMIN_IDS,
    on_approved=_cardpay_on_approved, on_rejected=_cardpay_on_rejected,
    on_reversed=_cardpay_on_reversed, support_contact=SUPPORT_CONTACT,
)

# نگاشتِ معکوسِ متنِ دکمه‌های پایین → اکشن (در همه‌ی زبان‌ها، مقاوم به تغییر زبان)
_KB_ACTION: dict = {}
for _code in locales.LANG_ORDER:
    _kb = locales.get(_code)["kb"]
    _KB_ACTION[_kb["new_dream"]]    = "new_dream"
    _KB_ACTION[_kb["subscription"]] = "subscription"
    _KB_ACTION[_kb["persona"]]      = "persona"
    _KB_ACTION[_kb["invite"]]       = "invite"
    if "reset_test" in _kb:
        _KB_ACTION[_kb["reset_test"]] = "reset_test"
    if "symbols" in _kb:
        _KB_ACTION[_kb["symbols"]] = "symbols"


# ===================== کیبوردها =====================

def _main_reply_kb(bale, lang, uid=0):
    # دکمه‌ی زبان حذف شده — زبانِ هر ربات ثابت است.
    # دکمه‌ی ریست فقط برای ادمین‌ها (همیشه، حتی خارج از فاز تست) — ابزار مدیریتی برای تستِ فلوها.
    return reply_keyboard(C.main_reply_rows(
        lang,
        include_language=False,
        include_reset=is_admin(uid),
    ))


def _packages_inline(lang, resume: bool = False):
    """دکمه‌های پکیج. resume=True یعنی این پی‌وال از مسیرِ خواب→دمو→«باز کردن تعبیر
    کامل» آمده و پرداختش باید همان خواب را ادامه دهد (نشانِ `:r` روی callback).
    resume=False (منوی «همسفری من») = خریدِ مستقل؛ بعد از پرداخت فقط منوی اصلی."""
    suffix = ":r" if resume else ""
    rows = [[{"text": C.sub_button_label(lang, t), "callback_data": f"buy:{t}{suffix}"}]
            for t in SUBSCRIPTION_ORDER]
    return inline_keyboard(rows)


def _confirm_inline(lang):
    return inline_keyboard([
        [{"text": C.get(lang, "btn_confirm"), "callback_data": "confirm_dream"}],
        [{"text": C.get(lang, "btn_cancel"),  "callback_data": "cancel_dream"}],
    ])


def _view_full_inline(lang, dream_id: int):
    return inline_keyboard([[{"text": C.get(lang, "btn_view_full"),
                              "callback_data": f"fullview:{dream_id}"}]])


# ===================== کمک‌ها =====================

def _user_fields(obj: dict):
    frm = obj.get("from") or {}
    return frm.get("id"), frm.get("username"), frm.get("first_name")


# پسوندهای صوتیِ متداول (ویس‌رکوردرِ گوشی‌ها، واتساپ، آیفون m4a، ...)
_AUDIO_EXTS = {"ogg", "oga", "opus", "mp3", "m4a", "mp4", "aac",
               "wav", "webm", "flac", "amr", "3gp", "3gpp"}


def _extract_audio_input(msg: dict):
    """ورودیِ صوتی می‌تواند به سه شکل بیاید و هر سه را به یک «خوابِ صوتی» می‌بریم:
      voice    → ویسِ بومیِ تلگرام/بله (OGG)؛ همیشه duration دارد.
      audio    → فایلِ صوتی (مثلِ ویس‌مموی آیفون که فوروارد می‌شود)؛ معمولاً duration دارد.
      document → هر فایل؛ فقط اگر mime یا پسوندش صوتی باشد قبول می‌شود؛ duration ندارد
                 (مدتش بعد از دانلود با ffprobe دقیق سنجیده می‌شود).
    خروجی: {file_id, duration|None}  یا None اگر اصلاً صوتی نبود."""
    v = msg.get("voice")
    if v and v.get("file_id"):
        return {"file_id": v["file_id"], "duration": v.get("duration")}
    a = msg.get("audio")
    if a and a.get("file_id"):
        return {"file_id": a["file_id"], "duration": a.get("duration")}
    d = msg.get("document")
    if d and d.get("file_id"):
        mime = (d.get("mime_type") or "").lower()
        name = (d.get("file_name") or "").lower()
        ext = name.rsplit(".", 1)[-1] if "." in name else ""
        if mime.startswith("audio/") or ext in _AUDIO_EXTS:
            return {"file_id": d["file_id"], "duration": None}
    return None


def _lock_key(bale, user_id, scope):
    return (bale.tag, user_id, scope)


async def _staged(coro, timeout: float, label: str, platform: str):
    """اجرای یک مرحله با سقفِ زمانی + لاگِ شروع/پایان/تایم‌اوت با مدت‌زمان.
    تایم‌اوت → asyncio.TimeoutError (که در except مرحله گرفته و به پیامِ خطا تبدیل می‌شود)."""
    t0 = time.monotonic()
    try:
        res = await asyncio.wait_for(coro, timeout=timeout)
        log.info("[%s] stage '%s' ✓ %.1fs", platform, label, time.monotonic() - t0)
        return res
    except asyncio.TimeoutError:
        log.error("[%s] stage '%s' ✗ TIMEOUT after %ss", platform, label, timeout)
        raise
    except Exception as e:
        log.warning("[%s] stage '%s' ✗ %.1fs: %s", platform, label, time.monotonic() - t0, e)
        raise


def _lang_of(user: dict, bale=None) -> str:
    """زبانِ ربات — هر ربات زبانِ ثابتِ خودش را دارد (نه انتخابِ کاربر)."""
    if bale is not None:
        return bale.locale
    return db.user_lang(user)


async def _send_onboarding_step(bale, chat_id, lang, step):
    """فرستادن سؤال آنبوردینگ به‌صورت پیام جدید (نقاط ورود)."""
    text, rows = C.onboarding_message(lang, step)
    await bale.send_message(chat_id, text, reply_markup=inline_keyboard(rows))


async def _edit_onboarding_step(bale, chat_id, msg_id, lang, step):
    """ادیتِ همان پیامِ پرسش به سؤالِ جدید (تا فضای چت اشغال نشود)."""
    text, rows = C.onboarding_message(lang, step)
    if msg_id:
        await bale.edit_message_text(chat_id, msg_id, text, reply_markup=inline_keyboard(rows))
    else:
        await bale.send_message(chat_id, text, reply_markup=inline_keyboard(rows))


async def _send_welcome(bale, chat_id, lang):
    """خوش‌آمد: عکس مسکات + کپشنِ معرفی + سؤال ۱."""
    caption, rows = C.welcome_message(lang)
    kb = inline_keyboard(rows)
    res = await bale.send_asset(chat_id, MASCOT_WELCOME, caption=caption, reply_markup=kb)
    if res is None:  # مسکات نبود → fallback متنی
        await bale.send_message(chat_id, caption, reply_markup=kb)


async def _send_paywall(bale, chat_id, lang, prefix=""):
    """دعوت به همسفری: عکس مسکات + کپشن + دکمه‌های پلن.
    زیر پلن‌ها، مسیر رایگان «نمادیاب خواب» هم پیشنهاد می‌شود تا کاربری که فعلاً
    نمی‌خواهد بخرد، به جای ترک ربات وارد بازی رایگان شود."""
    caption = C.paywall_full(lang, prefix)
    # این پی‌وال از مسیرِ خواب آمده → نشانِ `:r` تا پرداخت همان خواب را ادامه دهد (باگ استیت‌منیجمنت).
    rows = [[{"text": C.sub_button_label(lang, t), "callback_data": f"buy:{t}:r"}]
            for t in SUBSCRIPTION_ORDER]
    if C.symbols_available(lang):
        rows.append([{"text": C.sym_text(lang, "btn_paywall"), "callback_data": "sym:open"}])
    # قرارداد State Management: پی‌وال هم مثل بقیه‌ی صفحه‌ها دکمه‌ی بازگشت به منو دارد (بن‌بست نباشد).
    rows.append(C.back_row(lang))
    kb = inline_keyboard(rows)
    res = await bale.send_asset(chat_id, MASCOT_INVITE, caption=caption, reply_markup=kb)
    if res is None:
        await bale.send_message(chat_id, caption, reply_markup=kb)


# روایت‌گرِ پس‌زمینه — یک پیامِ واحد که هر ~۴.۵ ثانیه ادیت می‌شود تا کاربر تنها نماند.
async def _narrate(bale, chat_id, lang):
    loc = locales.get(lang)
    lines = loc["narration"]
    patience = loc["narration_patience"]
    n = len(lines)
    msg_id = None
    sent_once = False
    i = 0
    try:
        while True:
            text = lines[i] if i < n else patience[(i - n) % len(patience)]
            try:
                if not sent_once:
                    res = await bale.send_message(chat_id, text, parse_mode=None)
                    sent_once = True
                    msg_id = (res or {}).get("message_id") if isinstance(res, dict) else None
                elif msg_id is not None:
                    await bale.edit_message_text(chat_id, msg_id, text, parse_mode=None)
            except Exception:
                pass
            i += 1
            await asyncio.sleep(NARRATE_INTERVAL)
    except asyncio.CancelledError:
        pass


# ===================== دیسپچر =====================

async def handle_update(bale, update: dict):
    log.info("[%s] update %s keys=%s", bale.tag, update.get("update_id"),
             [k for k in update if k != "update_id"])
    if "callback_query" in update:
        await _handle_callback(bale, update["callback_query"])
        return
    if "pre_checkout_query" in update:
        await bale.answer_pre_checkout_query(update["pre_checkout_query"].get("id"), ok=True)
        return
    if "message" in update:
        await _handle_message(bale, update["message"])


# ===================== پیام‌ها =====================

async def _handle_message(bale, msg: dict):
    chat_id = (msg.get("chat") or {}).get("id")
    user_id, username, first_name = _user_fields(msg)
    if chat_id is None or user_id is None:
        return

    if "successful_payment" in msg:
        # پرداختِ واقعیِ بله (sendInvoice). نیتِ resume در انتهای payload کد شده (`:r`) — قرینه‌ی
        # گیتِ استیت‌منیجمنتِ کارت‌به‌کارت: فقط اگر از مسیرِ پی‌والِ خواب آمده، خواب resume می‌شود.
        sp = msg["successful_payment"]
        payload = sp.get("invoice_payload", "")
        await payments.apply_successful_payment(
            bale, user_id, payload, sp.get("telegram_payment_charge_id", ""),
        )
        if payload.endswith(":r"):
            await _try_resume_pending_dream(bale, chat_id, user_id)
        else:
            try:
                text, rows = C.main_menu_message(bale.locale)
                await bale.send_message(chat_id, text, reply_markup=inline_keyboard(rows))
            except Exception:
                pass
        return

    user = await db.get_user(user_id)

    # --- کارت‌به‌کارت: عکسِ رسید (فقط ربات‌های card-mode = تلگرامِ فارسی) ---
    if config.payment_mode(bale.platform, bale.locale) == "card":
        photo = msg.get("photo")
        if photo:
            fid = photo[-1].get("file_id")
            await CARDPAY.maybe_handle_receipt(bale, user_id, chat_id, photo_file_id=fid, text=None)
            return

    audio = _extract_audio_input(msg)
    if audio:
        await _handle_dream_input(bale, chat_id, user_id, "voice", voice=audio)
        return

    text = (msg.get("text") or "").strip()
    if not text:
        return

    if text.startswith("/start"):
        await _handle_start(bale, chat_id, user_id, username, first_name, text)
        return
    if text.startswith("/simulate_pay") and (user_id == ADMIN_USER_ID or user_id in ADMIN_IDS):
        await _handle_simulate_pay(bale, chat_id, user_id, text)
        return

    lang = _lang_of(user, bale)
    action = _KB_ACTION.get(text)

    # هر دکمه‌ی منوی پایین (جز خودِ نمادیاب) = خروج از حالتِ نمادیاب، تا متنِ بعدی «خواب» تلقی شود نه «جستجوی نماد»
    if action and action != "symbols" and C.symbols_available(lang) and db.is_sym_browse(user):
        await db.set_sym_browse(user_id, False)

    # «خواب جدید» = ریست آگاهانه
    if action == "new_dream":
        await _send_new_dream_guide(bale, chat_id, user_id)
        return

    # هر اکشن دیگری: اگر خوابِ ناتمامِ شکست‌خورده هست، اول بازتلاش
    if (user or {}).get("pending_state") == "processing_failed":
        handled = await _try_resume_pending_dream(bale, chat_id, user_id)
        if handled:
            return

    if action == "subscription":
        await _send_subscription_status(bale, chat_id, user_id)
        return
    if action == "persona":
        ptext, rows = C.persona_change_message(lang)
        await bale.send_message(chat_id, ptext, reply_markup=inline_keyboard(rows))
        return
    if action == "invite" and REFERRAL_ENABLED:
        await bale.send_message(chat_id, C.invite_text(lang, bale.invite_link(user_id)))
        return
    if action == "symbols":
        await _send_symbols_home(bale, chat_id, user_id, via="keyboard")
        return

    if action == "reset_test" and is_admin(user_id):
        await db.reset_user(user_id)
        log.info("[%s] ADMIN RESET user=%s by reset button", bale.tag, user_id)
        # کیبوردِ پایین (شاملِ خودِ دکمه‌ی ریست) را دوباره بفرست تا بعد از ریست هم در دسترس بماند —
        # وگرنه چون یوزر «جدید» می‌شود و وارد آنبوردینگ می‌شود، دکمه تا پایانِ آنبوردینگ ناپدید می‌ماند.
        await bale.send_message(chat_id, "🔄 ریست شد — انگار یه یوزرِ تازه!",
                                reply_markup=_main_reply_kb(bale, lang, user_id), parse_mode=None)
        await _send_welcome(bale, chat_id, lang)
        return

    # حالتِ نمادیاب: متنِ کوتاه = جستجوی نماد (نه خواب)؛ متنِ بلند = کاربر دارد خوابش را
    # می‌گوید، پس از حالت خارج و به فلوی خواب می‌رود (ضدِ بلعیده‌شدنِ روایتِ خواب توسط جستجو).
    if C.symbols_available(lang) and db.is_sym_browse(user):
        if _looks_like_symbol_query(text):
            await _handle_symbol_search(bale, chat_id, user_id, lang, text)
            return
        await db.set_sym_browse(user_id, False)

    # --- کارت‌به‌کارت: متنِ رسید (فقط اگر پرداختِ منتظرِ رسید داشته باشد؛ فرمان/دکمه قبلاً هندل شده) ---
    if config.payment_mode(bale.platform, bale.locale) == "card" and not action:
        if await CARDPAY.maybe_handle_receipt(bale, user_id, chat_id, photo_file_id=None, text=text):
            return

    # در غیر این صورت = خواب متنی
    await _handle_dream_input(bale, chat_id, user_id, "text", text=text)


async def _handle_start(bale, chat_id, user_id, username, first_name, text):
    parts = text.split(maxsplit=1)
    raw_payload = parts[1].strip() if len(parts) == 2 else ""
    referred_by = None
    if REFERRAL_ENABLED:                       # رفرال خاموش → deeplinkِ ref_ نادیده گرفته می‌شود
        m = _REF_RE.match(raw_payload)
        if m:
            ref_id = int(m.group(1))
            if ref_id != user_id:
                referred_by = ref_id

    # زبان از همان ابتدا = زبانِ ثابتِ ربات (استپ انتخاب زبان حذف شده)
    is_new, user = await db.get_or_create_user(
        user_id, chat_id, username, first_name, referred_by=referred_by, language=bale.locale
    )
    # اتریبیوشن مونوریپو: رویداد start برای هر /start + first_source/first_version فقط برای کاربر جدید (analytics.py)
    await analytics.capture_start(user_id, raw_payload, is_new, version=PRODUCT_VERSION)

    lang = _lang_of(user, bale)
    if db.onboarding_done(user):
        await bale.send_message(
            chat_id,
            C.get(lang, "returning_welcome") + "\n\n" + C.invite_line(lang, user["persona"]),
            reply_markup=_main_reply_kb(bale, lang, user_id),
        )
    elif user["onboarding_step"] == 0:
        await _send_welcome(bale, chat_id, lang)
    else:
        await _send_onboarding_step(bale, chat_id, lang, user["onboarding_step"])


async def _edit_or_send(bale, chat_id, msg_id, text, rows, parse_mode="Markdown"):
    """ادیتِ همان پیام (فلوی درختی، چت تمیز)؛ اگر ادیت نشد (مثلاً پیام عکس‌دار) پیام جدید.
    rows خالی/None = بدونِ دکمه (برای پیام‌های «تایپ/ویس بفرست» که نباید دکمه‌ی حواس‌پرت‌کن داشته باشند)."""
    kb = inline_keyboard(rows) if rows else None
    if msg_id:
        try:
            await bale.edit_message_text(chat_id, msg_id, text, reply_markup=kb,
                                         parse_mode=parse_mode)
            return
        except Exception:
            pass
    await bale.send_message(chat_id, text, reply_markup=kb, parse_mode=parse_mode)


async def _send_new_dream_guide(bale, chat_id, user_id, msg_id=None):
    await db.clear_pending(user_id)
    await db.set_sym_browse(user_id, False)   # «خواب جدید»/CTA = خروج از حالت نمادیاب
    user = await db.get_user(user_id)
    lang = _lang_of(user, bale)
    if not user or not db.onboarding_done(user):
        step = (user or {}).get("onboarding_step", 0)
        await bale.send_message(chat_id, C.get(lang, "choose_persona_first"))
        await _send_onboarding_step(bale, chat_id, lang, step)
        return
    # پیامِ «رویات رو تعریف کن» یک ورودیِ تایپ/ویس است → طبق قرارداد ۹ب هیچ دکمه‌ی حواس‌پرت‌کنی نمی‌گذاریم
    # (کاربر روی گفتنِ خواب تمرکز کند)؛ راهِ خروج، کیبوردِ ماندگارِ پایین است که همیشه حاضر است.
    await _edit_or_send(bale, chat_id, msg_id, C.new_dream_text(lang, user["persona"]), [])


def _subscription_status_view(lang, status):
    """(text, rows) وضعیت اشتراک. فعال → دکمه‌های اقدام (خواب جدید/نمادیاب) + بازگشت.
    غیرفعال (از منوی «همسفری من») → پکیج‌ها بدونِ نشانِ resume + بازگشت."""
    text = C.subscription_status_text(lang, status)
    if status["active"]:
        rows = [[{"text": C.kb_labels(lang)["new_dream"], "callback_data": "menu:new_dream"}]]
        if C.symbols_available(lang) and "symbols" in C.kb_labels(lang):
            rows.append([{"text": C.kb_labels(lang)["symbols"], "callback_data": "menu:symbols"}])
        rows.append(C.back_row(lang))
    else:
        rows = _packages_inline(lang, resume=False)["inline_keyboard"] + [C.back_row(lang)]
    return text, rows


async def _send_subscription_status(bale, chat_id, user_id):
    user = await db.get_user(user_id)
    lang = _lang_of(user, bale)
    status = db.subscription_status(user or {})
    text, rows = _subscription_status_view(lang, status)
    await bale.send_message(chat_id, text, reply_markup=inline_keyboard(rows))


# ===================== دریافت خواب =====================

async def _handle_dream_input(bale, chat_id, user_id, source, voice=None, text=None):
    user = await db.get_user(user_id)
    if not user:
        _, user = await db.get_or_create_user(user_id, chat_id, None, None,
                                              language=bale.locale)
    lang = _lang_of(user, bale)

    if not db.onboarding_done(user):
        await bale.send_message(chat_id, C.get(lang, "choose_persona_first"))
        await _send_onboarding_step(bale, chat_id, lang, user.get("onboarding_step", 0))
        return

    if source == "voice":
        # بررسیِ سریعِ مدت وقتی پیام‌رسان خودش گزارش کرده (ویس و اغلبِ audioها).
        # بله مدت را به «میلی‌ثانیه» می‌دهد، تلگرام به «ثانیه». به ثانیه نرمال می‌کنیم.
        # اگر duration نبود (مثلِ document/فایلِ فورواردشده)، اینجا رد نمی‌کنیم؛
        # بعد از دانلود با ffprobe دقیق سنجیده می‌شود (مستقل از فرمت/حجم).
        dur = (voice or {}).get("duration")
        if dur:
            if bale.platform == "bale":
                dur = dur / 1000
            if dur < MIN_VOICE_DURATION:
                await bale.send_message(chat_id, C.get(lang, "voice_too_short"))
                return
            if dur > MAX_VOICE_DURATION:
                await bale.send_message(chat_id, C.get(lang, "voice_too_long"))
                return
        payload = voice["file_id"]
    else:
        if len(text) < MIN_TEXT_CHARS:
            await bale.send_message(chat_id, C.get(lang, "text_too_short"))
            return
        payload = text[:MAX_TEXT_CHARS]

    await db.set_pending(user_id, source, payload)
    confirm_text = C.get(lang, "confirm_voice") if source == "voice" else C.get(lang, "confirm_text")
    await bale.send_message(chat_id, confirm_text, reply_markup=_confirm_inline(lang))


# ===================== Callback =====================

async def _handle_callback(bale, cq: dict):
    cq_id = cq.get("id")
    data = cq.get("data") or ""
    user_id, _, _ = _user_fields(cq)
    chat_id = ((cq.get("message") or {}).get("chat") or {}).get("id")
    if chat_id is None:
        chat_id = user_id
    msg_id = (cq.get("message") or {}).get("message_id")

    try:
        if data == "onb_start":
            await _cb_onboarding_start(bale, cq_id, chat_id, user_id)
        elif data.startswith("onb:"):
            _, step, idx = data.split(":")
            await _cb_onboarding_answer(bale, cq_id, chat_id, msg_id, user_id, int(step), int(idx))
        elif data == "onb_prev":
            await _cb_onboarding_prev(bale, cq_id, chat_id, msg_id, user_id)
        elif data.startswith("pers:"):
            await _cb_persona_change(bale, cq_id, chat_id, user_id, int(data.split(":", 1)[1]))
        elif data == "confirm_dream":
            await _cb_confirm_dream(bale, cq_id, chat_id, user_id)
        elif data == "cancel_dream":
            user = await db.get_user(user_id)
            lang = _lang_of(user, bale)
            await db.clear_pending(user_id)
            await bale.answer_callback_query(cq_id)
            await bale.send_message(chat_id, C.get(lang, "cancelled"))
        elif data.startswith("buy:"):
            parts = data.split(":")
            resume = len(parts) > 2 and parts[2] == "r"
            await _cb_buy(bale, cq_id, chat_id, user_id, parts[1], resume)
        elif data.startswith("paym:"):
            parts = data.split(":")
            resume = len(parts) > 3 and parts[3] == "r"
            await _cb_pay_method(bale, cq_id, chat_id, user_id, parts[1], parts[2], resume)
        elif data.startswith("fullview:"):
            await _cb_view_full(bale, cq_id, chat_id, user_id, int(data.split(":", 1)[1]))
        elif data.startswith("sym:"):
            await _cb_symbols(bale, cq_id, chat_id, msg_id, user_id, data)
        elif data.startswith("menu:"):
            await _cb_menu(bale, cq_id, chat_id, msg_id, user_id, data.split(":", 1)[1])
        elif data.startswith("card"):   # cardok/cardno/cardsms/cardrev/cardrevno (ادمین)
            await CARDPAY.handle_admin_callback(bale, cq_id, user_id, data)
        else:
            await bale.answer_callback_query(cq_id)
    except Exception as e:
        log.exception("callback error: %s", e)
        try:
            await bale.answer_callback_query(cq_id)
        except Exception:
            pass


async def _cb_onboarding_start(bale, cq_id, chat_id, user_id):
    """شروع آنبوردینگ: سؤال اول را بفرست."""
    user = await db.get_user(user_id)
    if not user:
        _, user = await db.get_or_create_user(user_id, chat_id, None, None,
                                              language=bale.locale)
    lang = _lang_of(user, bale)
    await db.set_onboarding_step(user_id, 0)
    await bale.answer_callback_query(cq_id)
    await _send_onboarding_step(bale, chat_id, lang, 0)


async def _cb_onboarding_answer(bale, cq_id, chat_id, msg_id, user_id, step, idx):
    """پاسخ‌دادن به سؤال؛ همان پیام در جا به سؤالِ بعد ادیت می‌شود."""
    user = await db.get_user(user_id)
    if not user:
        _, user = await db.get_or_create_user(user_id, chat_id, None, None,
                                              language=bale.locale)
    lang = _lang_of(user, bale)
    if step != user.get("onboarding_step", 0):
        await bale.answer_callback_query(cq_id)
        return
    questions = locales.onboarding_questions(lang)
    q = questions[step]
    if idx < 0 or idx >= len(q["options"]):
        await bale.answer_callback_query(cq_id)
        return
    val, label = q["options"][idx]
    await db.save_onboarding_answer(user_id, step, q["key"], val, q.get("is_persona", False))
    await bale.answer_callback_query(cq_id, text=label[:40])

    total = len(questions)
    if step + 1 < total:
        # سؤالِ بعد روی همان پیام ادیت می‌شود
        await _edit_onboarding_step(bale, chat_id, msg_id, lang, step + 1)
    else:
        # آنبوردینگ تمام: پیامِ آخرین پرسش را به خوش‌آمدِ پرسونا تبدیل کن،
        # و دعوت به فرستادن رویا را با کیبوردِ اصلی به‌صورت پیام جدید بفرست.
        user = await db.get_user(user_id)
        persona = user["persona"]
        if msg_id:
            await bale.edit_message_text(chat_id, msg_id, C.persona_key(lang, persona, "greet"))
        await bale.send_message(chat_id, C.persona_key(lang, persona, "invite"),
                                reply_markup=_main_reply_kb(bale, lang, user_id))


async def _cb_onboarding_prev(bale, cq_id, chat_id, msg_id, user_id):
    """برگشت به سؤال قبل — روی همان پیام ادیت می‌شود."""
    user = await db.get_user(user_id)
    if not user:
        await bale.answer_callback_query(cq_id)
        return
    lang = _lang_of(user, bale)
    step = user.get("onboarding_step", 0)
    if step <= 0:
        await bale.answer_callback_query(cq_id)
        return
    prev_step = step - 1
    await db.set_onboarding_step(user_id, prev_step)
    await bale.answer_callback_query(cq_id)
    await _edit_onboarding_step(bale, chat_id, msg_id, lang, prev_step)


async def _cb_persona_change(bale, cq_id, chat_id, user_id, idx):
    user = await db.get_user(user_id)
    lang = _lang_of(user, bale)
    q = locales.onboarding_questions(lang)[0]
    if idx < 0 or idx >= len(q["options"]):
        await bale.answer_callback_query(cq_id)
        return
    val, label = q["options"][idx]
    await db.set_persona(user_id, val)
    await bale.answer_callback_query(cq_id, text=label[:40])
    await bale.send_message(chat_id, C.ready_text(lang, val), reply_markup=_main_reply_kb(bale, lang, user_id))


async def _cb_confirm_dream(bale, cq_id, chat_id, user_id):
    pending = await db.get_pending(user_id)
    if not pending:
        await bale.answer_callback_query(cq_id)
        return

    user = await db.get_user(user_id)
    lang = _lang_of(user, bale)

    # --- eligibility gate ---
    # ترتیب مهم است: مشترکِ فعال همیشه paid (دمو+کامل همزمان + مصرفِ سهمیه‌ی روزانه).
    # فقط غیرمشترک تریالِ رایگان می‌گیرد — وگرنه مشترک روزِ اول ۱ تریال + ۱ پولی = ۲ خواب می‌گرفت.
    status = db.subscription_status(user)
    if status["active"]:
        if not SKIP_DAILY_LIMIT and not await db.can_use_today(user_id):
            await bale.answer_callback_query(cq_id)
            await db.clear_pending(user_id)
            await bale.send_message(chat_id, C.get(lang, "daily_limit"))
            return
        mode = "paid"
    elif not user.get("has_used_free_trial"):
        mode = "free"
    else:
        await bale.answer_callback_query(cq_id)
        await db.set_pending_state(user_id, "awaiting_payment", "paid")
        await _send_paywall(bale, chat_id, lang, C.need_subscription_prefix(lang))
        return

    lock = _lock_key(bale, user_id, "dream")
    if lock in _processing:
        await bale.answer_callback_query(cq_id, text=C.processing_busy(lang))
        return
    await bale.answer_callback_query(cq_id)

    # پس‌زمینه: تا یک خوابِ کند/سنگین، polling کلِ پلتفرم را بلاک نکند.
    # قفلِ _processing از پردازشِ هم‌زمانِ دوباره جلوگیری می‌کند.
    asyncio.create_task(_process_dream(bale, chat_id, user_id, mode, pending))


async def _process_dream(bale, chat_id, user_id, mode, pending):
    """Pipeline اصلی: transcript → interpretation → image → delivery.
    در صورت خطا، pending را حفظ می‌کند تا بعداً قابل بازتلاش باشد."""
    lock = _lock_key(bale, user_id, "dream")
    if lock in _processing:
        return
    _processing.add(lock)
    log.info("[%s] _process_dream START user=%s mode=%s source=%s",
             bale.tag, user_id, mode, (pending or {}).get("source"))

    user = await db.get_user(user_id)
    lang = _lang_of(user, bale)
    persona = (user or {}).get("persona") or locales.default_persona(lang)
    profile = db.get_profile(user or {})

    # --- idempotency: آیا برای همین ورودی قبلاً تعبیر ساخته‌ایم؟ ---
    # اگر بله (تعبیر در DB هست ولی تحویل/عکس ناتمام ماند یا ربات ری‌استارت شد)،
    # دیگر هرگز LLM را دوباره صدا نمی‌زنیم — مستقیم می‌رویم سراغ عکس/تحویل.
    existing = None
    edid = (user or {}).get("pending_dream_id")
    if edid:
        d = await db.get_dream(edid)
        if d and d.get("interpretation"):
            existing = d

    narrator = asyncio.create_task(_narrate(bale, chat_id, lang))
    try:
        tier = "free" if mode == "free" else "paid"

        if existing:
            # تعبیر قبلاً ساخته شده — هیچ ریکوئست LLMِ جدیدی زده نمی‌شود
            preview = existing.get("preview") or ""
            # depth (بخشِ دومِ JSON) برای تحویلِ پریمیوم؛ اگر ردیفِ قدیمی بدونِ depth بود،
            # به متنِ کامل برمی‌گردیم تا چیزی از دست نرود.
            depth = existing.get("depth") or existing["interpretation"]
            teaser = ai.teaser_of(preview)
            image_prompt = existing["image_prompt"]
            dream_id = existing["id"]
            image_url = existing["image_url"] if existing.get("image_generated") else None
        else:
            # سهمیه فقط در نخستین تلاش مصرف می‌شود (resume دوباره مصرف نمی‌کند)
            if mode == "free":
                await db.mark_free_trial_used(user_id)
            else:
                await db.consume_daily(user_id)

            async def _refund():
                if mode == "free":
                    await db.unmark_free_trial(user_id)
                else:
                    await db.refund_daily(user_id)

            # --- تعبیر (گران‌ترین قدم) ---
            if pending["source"] == "voice":
                tmp_path = None
                try:
                    file_path = await _staged(
                        bale.get_file_path(pending["payload"]),
                        FILE_API_TIMEOUT, "getfile", bale.tag)
                    ext = os.path.splitext(file_path)[1] or ".ogg"
                    fd, tmp_path = tempfile.mkstemp(suffix=ext)
                    os.close(fd)
                    await _staged(
                        bale.download_file(file_path, tmp_path),
                        DOWNLOAD_TIMEOUT, "download", bale.tag)
                    # سنجشِ دقیقِ مدت با ffprobe — مستقل از فرمت/حجم. مخصوصاً برای فایل‌هایی
                    # که مدت‌شان را گزارش نکرده‌اند (document/m4aِ فورواردشده) تنها بررسیِ معتبر است.
                    real_dur = await ai.audio_duration(tmp_path)
                    if real_dur is not None and not (MIN_VOICE_DURATION <= real_dur <= MAX_VOICE_DURATION):
                        log.info("[%s] audio duration %.1fs out of [%s,%s] → rejected",
                                 bale.tag, real_dur, MIN_VOICE_DURATION, MAX_VOICE_DURATION)
                        narrator.cancel()
                        await _refund()
                        await db.clear_pending(user_id)
                        key = "voice_too_short" if real_dur < MIN_VOICE_DURATION else "voice_too_long"
                        await bale.send_message(chat_id, C.get(lang, key))
                        return
                    result = await _staged(
                        ai.process_voice_dream(tmp_path, lang, persona, profile, tier),
                        INTERPRET_TIMEOUT, "interpret-voice", bale.tag)
                except Exception as e:
                    log.warning("[%s] voice dream FAILED → notifying user: %s", bale.tag, e)
                    narrator.cancel()
                    await _refund()
                    await db.set_pending_state(user_id, "processing_failed", mode)
                    await bale.send_message(chat_id, C.persona_key(lang, persona, "error"))
                    return
                finally:
                    if tmp_path and os.path.exists(tmp_path):
                        try:
                            os.remove(tmp_path)
                        except OSError:
                            pass
                transcript = None
            else:
                transcript = pending["payload"]
                try:
                    result = await _staged(
                        ai.interpret_dream(transcript, lang, persona, profile, tier),
                        INTERPRET_TIMEOUT, "interpret-text", bale.tag)
                except Exception as e:
                    log.warning("[%s] text dream FAILED → notifying user: %s", bale.tag, e)
                    narrator.cancel()
                    await _refund()
                    await db.set_pending_state(user_id, "processing_failed", mode)
                    await bale.send_message(chat_id, C.persona_key(lang, persona, "error"))
                    return

            # تعبیر موفق شد → فوراً ذخیره + ثبتِ پیوند، تا از این لحظه به بعد
            # هر شکست/ری‌استارتی بدون فراخوانی دوباره‌ی LLM قابل ادامه باشد.
            preview = result["preview"]
            depth = result["depth"]
            full = ai.compose_full(preview, depth)
            teaser = ai.teaser_of(preview)
            image_prompt = result["image_prompt"]
            dream_id = await db.create_dream(
                user_id, transcript, persona, full, image_prompt,
                is_free_trial=1 if mode == "free" else 0, preview=preview, depth=depth,
            )
            await db.set_pending_dream_id(user_id, dream_id)
            image_url = None

        # --- عکس و تحویل (بعد از این نقطه، هر خطایی resume می‌شود نه از نو) ---
        try:
            # عکس: اگر از قبل ساخته شده بازاستفاده، وگرنه از روی image_promptِ ذخیره‌شده بساز (بدون LLM)
            if not image_url:
                try:
                    img = await _staged(
                        ai.generate_image(image_prompt),
                        IMAGE_TIMEOUT, "image", bale.tag)
                    image_url = img["url"]
                    await db.mark_image(
                        dream_id, image_url,
                        width=img.get("width"), height=img.get("height"),
                        black_retries=img.get("black_retries", 0),
                    )
                except Exception as e:
                    log.warning("[%s] image generation failed (continuing without image): %s",
                                bale.tag, e)

            narrator.cancel()

            if mode == "free":
                await _deliver_trial(bale, chat_id, lang, dream_id, image_url, teaser)
                await analytics.track_once(user_id, "first_value", {"via": "trial"})
            else:
                await _deliver_paid(bale, chat_id, lang, image_url, preview, depth)
                await db.mark_full_delivered(dream_id)
                await analytics.track(user_id, "product_delivered", {"type": "dream", "dream_id": dream_id})
                await analytics.track_once(user_id, "first_value", {"via": "dream"})

            await db.clear_pending(user_id)
            log.info("[%s] _process_dream DONE user=%s dream=%s image=%s",
                     bale.tag, user_id, dream_id, "yes" if image_url else "no")
        except Exception as e:
            # تعبیر سالم در DB مانده؛ resumeِ بعدی بدون LLM فقط عکس/تحویل را تکرار می‌کند.
            log.warning("[%s] delivery failed (will resume without re-interpreting): %s",
                        bale.tag, e)
            await db.set_pending_state(user_id, "processing_failed", mode)

    except Exception as e:
        # هر خطای پیش‌بینی‌نشده‌ای: کاربر نباید بی‌خبر بماند.
        log.exception("[%s] _process_dream UNEXPECTED error user=%s: %s", bale.tag, user_id, e)
        try:
            await db.set_pending_state(user_id, "processing_failed", mode)
            await bale.send_message(chat_id, C.persona_key(lang, persona, "error"))
        except Exception:
            pass
    finally:
        narrator.cancel()
        _processing.discard(lock)


async def _try_resume_pending_dream(bale, chat_id, user_id) -> bool:
    """بررسی و بازتلاش خوابِ ناتمام (در صورت وجود)."""
    user = await db.get_user(user_id)
    if not user:
        return False
    lang = _lang_of(user, bale)
    pending_state = user.get("pending_state")
    if not pending_state:
        return False

    pending = await db.get_pending(user_id)
    mode = user.get("pending_mode") or "paid"

    if pending_state == "processing_failed":
        if not pending:
            await db.clear_pending(user_id)
            return False
        if mode == "paid":
            sub = db.subscription_status(user)
            if not sub["active"]:
                await db.set_pending_state(user_id, "awaiting_payment", mode)
                await _send_paywall(bale, chat_id, lang, C.need_subscription_prefix(lang))
                return True
            if not SKIP_DAILY_LIMIT and not await db.can_use_today(user_id):
                await db.clear_pending(user_id)
                await bale.send_message(chat_id, C.get(lang, "daily_limit"))
                return True
        lock = _lock_key(bale, user_id, "dream")
        if lock not in _processing:
            asyncio.create_task(_process_dream(bale, chat_id, user_id, mode, pending))
        return True

    if pending_state == "awaiting_payment":
        if not pending:
            await db.clear_pending(user_id)
            return False
        sub = db.subscription_status(user)
        if sub["active"]:
            lock = _lock_key(bale, user_id, "dream")
            if lock not in _processing:
                asyncio.create_task(_process_dream(bale, chat_id, user_id, mode, pending))
            return True
        else:
            await _send_paywall(bale, chat_id, lang, C.need_subscription_prefix(lang))
            return True

    return False


async def _send_photo_robust(bale, chat_id, image_url, caption=None, reply_markup=None) -> bool:
    """ارسالِ عکس با مقاومت — تا یک خطای ارسالِ عکس کلِ تحویل را نشکند:
      ۱) اول با URL (سریع، بدونِ آپلود).
      ۲) اگر پیام‌رسان نتوانست URL را بکشد (مثلاً «wrong type of the web page content»)،
         عکس را خودمان دانلود و به‌صورتِ فایل آپلود می‌کنیم.
    True اگر موفق شد؛ False اگر هر دو شکست خوردند (caller متن را بدونِ عکس می‌فرستد)."""
    if not image_url:
        return False
    try:
        await bale.send_photo(chat_id, image_url, caption=caption,
                              reply_markup=reply_markup, parse_mode=None)
        return True
    except Exception as e:
        log.warning("[%s] sendPhoto by URL failed (%s) — trying download+upload", bale.tag, e)
    tmp = None
    try:
        fd, tmp = tempfile.mkstemp(suffix=".png")
        os.close(fd)
        await bale.download_url(image_url, tmp)
        await bale.send_photo(chat_id, tmp, caption=caption,
                              reply_markup=reply_markup, parse_mode=None)
        return True
    except Exception as e:
        log.warning("[%s] sendPhoto by file also failed: %s — delivering text without image",
                    bale.tag, e)
        return False
    finally:
        if tmp and os.path.exists(tmp):
            try:
                os.remove(tmp)
            except OSError:
                pass


async def _deliver_trial(bale, chat_id, lang, dream_id, image_url, teaser):
    kb = _view_full_inline(lang, dream_id)
    # عکس + کپشن در یک پیام؛ اگر موفق شد همان بس است.
    if image_url and len(teaser) <= _CAPTION_SAFE:
        if await _send_photo_robust(bale, chat_id, image_url, caption=teaser, reply_markup=kb):
            return
    elif image_url:
        await _send_photo_robust(bale, chat_id, image_url)
    else:
        await bale.send_message(chat_id, C.get(lang, "image_failed"), parse_mode=None)
    await bale.send_message(chat_id, teaser, reply_markup=kb, parse_mode=None)


async def _deliver_paid(bale, chat_id, lang, image_url, preview, depth):
    """تحویلِ پریمیوم برای مشترکِ فعال — دقیقاً مثلِ بارِ اول، فقط بدونِ دکمه‌ی «گشودن تعبیر کامل»:
      عکس + کپشن = preview (خام، بدونِ «…»)، و سپس depth در یک پیامِ جدا.
    عمداً preview را به depth نمی‌چسبانیم: اگر مدل preview را داخلِ depth تکرار کرده باشد،
    دستِ‌کم در دو پیامِ جدا می‌افتد، نه چسبیده و دوباره در یک متن."""
    sent_with_caption = False
    if image_url and len(preview) <= _CAPTION_SAFE:
        sent_with_caption = await _send_photo_robust(bale, chat_id, image_url, caption=preview)
    elif image_url:
        await _send_photo_robust(bale, chat_id, image_url)
    else:
        await bale.send_message(chat_id, C.get(lang, "image_failed"), parse_mode=None)
    if not sent_with_caption:
        await bale.send_message(chat_id, preview, parse_mode=None)
    await bale.send_message(chat_id, depth, parse_mode=None)


# ===================== نمادیاب خواب (مسیر رایگان بدون LLM) =====================

_SYM_QUERY_MAX = 24   # نامِ نماد کوتاه است؛ متنِ بلندتر = روایتِ خواب، نه کوئری


def _looks_like_symbol_query(text: str) -> bool:
    """آیا این متن، کوئریِ نماد است (نه روایتِ خواب)؟ کوتاه و کم‌کلمه = کوئری."""
    t = (text or "").strip()
    return 0 < len(t) <= _SYM_QUERY_MAX and len(t.split()) <= 3


async def _handle_symbol_search(bale, chat_id, user_id, lang, query):
    """جستجوی متنیِ نماد در حالتِ نمادیاب. یک نتیجه → مستقیم؛ چند نتیجه → لیست؛ صفر → پیام
    صادقانه + پیشنهاد + CTA (و ثبتِ symbol_not_found برای فازِ گسترشِ دیتا)."""
    user = await db.get_user(user_id)
    persona = (user or {}).get("persona") or locales.default_persona(lang)
    results = SYM.search(lang, query)
    if len(results) == 1:
        li, wi, entry = results[0]
        text, rows, _ = C.symbols_word_message(lang, li, wi, persona)
        await bale.send_message(chat_id, text, reply_markup=inline_keyboard(rows))
        await analytics.track(user_id, "symbol_viewed", {
            "letter": entry["letter"], "word": entry["word"], "persona": persona, "via": "search",
        })
    elif results:
        text, rows = C.symbols_result_list_message(lang, results)
        await bale.send_message(chat_id, text, reply_markup=inline_keyboard(rows))
        await analytics.track(user_id, "symbol_search", {"n": len(results)})
    else:
        text, rows = C.symbols_not_found_message(lang, query, SYM.suggest(lang, query))
        await bale.send_message(chat_id, text, reply_markup=inline_keyboard(rows), parse_mode=None)
        await analytics.track(user_id, "symbol_not_found", {"query": " ".join((query or "").split())[:64]})


async def _send_symbols_home(bale, chat_id, user_id, via: str, msg_id=None):
    """ورود به نمادیاب: معرفی + گرید حروف. msg_id → ادیت در جا (ناوبری درختی از منوی اصلی)."""
    user = await db.get_user(user_id)
    lang = _lang_of(user, bale)
    if not C.symbols_available(lang):
        return
    text, rows = C.symbols_home_message(lang)
    await _edit_or_send(bale, chat_id, msg_id, text, rows)
    await db.set_sym_browse(user_id, True)   # از این پس متنِ کوتاه = جستجوی نماد (تا خروج)
    await analytics.track(user_id, "symbol_opened", {"via": via})


async def _sym_show(bale, chat_id, msg_id, text, rows):
    """ناوبری نمادیاب روی همان پیام ادیت می‌شود تا چت شلوغ نشود؛ بدون msg_id پیام جدید."""
    kb = inline_keyboard(rows)
    if msg_id:
        await bale.edit_message_text(chat_id, msg_id, text, reply_markup=kb)
    else:
        await bale.send_message(chat_id, text, reply_markup=kb)


async def _cb_symbols(bale, cq_id, chat_id, msg_id, user_id, data):
    user = await db.get_user(user_id)
    lang = _lang_of(user, bale)
    if not C.symbols_available(lang):
        await bale.answer_callback_query(cq_id)
        return
    parts = data.split(":")
    action = parts[1] if len(parts) > 1 else ""
    persona = (user or {}).get("persona") or locales.default_persona(lang)

    if action == "open":       # از پی‌وال — پیام جدید تا پیام پی‌وال دست‌نخورده بماند
        await bale.answer_callback_query(cq_id)
        await _send_symbols_home(bale, chat_id, user_id, via="paywall")
        return
    if action == "dream":      # CTA: از نماد به تعریف کامل خواب
        await bale.answer_callback_query(cq_id)
        await analytics.track(user_id, "symbol_cta_dream", {})
        await _send_new_dream_guide(bale, chat_id, user_id)
        return

    if action == "home":
        text, rows = C.symbols_home_message(lang)
    elif action == "l" and len(parts) == 3 and parts[2].isdigit():
        text, rows = C.symbols_list_message(lang, int(parts[2]), 0)
    elif action == "p" and len(parts) == 4 and parts[2].isdigit() and parts[3].isdigit():
        text, rows = C.symbols_list_message(lang, int(parts[2]), int(parts[3]))
    elif action == "w" and len(parts) == 4 and parts[2].isdigit() and parts[3].isdigit():
        li, wi = int(parts[2]), int(parts[3])
        text, rows, entry = C.symbols_word_message(lang, li, wi, persona)
        if entry:
            await analytics.track(user_id, "symbol_viewed", {
                "letter": entry["letter"], "word": entry["word"], "persona": persona,
            })
    else:
        text, rows = None, None

    await bale.answer_callback_query(cq_id)
    if text is not None:
        await _sym_show(bale, chat_id, msg_id, text, rows)


async def _cb_menu(bale, cq_id, chat_id, msg_id, user_id, action):
    """منوی اصلیِ اینلاین (فلوی درختی). دکمه‌های بازگشت به `menu:home` می‌رسند و از آنجا
    به هر بخش. همه ادیت‌درجا (چت تمیز). آنبوردینگ استثناست: کاربر تازه‌وارد این‌ها را نمی‌بیند
    چون منوی اصلی فقط از دکمه‌های حالت‌هایی می‌آید که کاربرِ عادی (نه در آنبوردینگ) با آن‌ها روبروست."""
    user = await db.get_user(user_id)
    lang = _lang_of(user, bale)
    await bale.answer_callback_query(cq_id)

    if action == "home":
        await db.set_sym_browse(user_id, False)
        text, rows = C.main_menu_message(lang)
        await _edit_or_send(bale, chat_id, msg_id, text, rows)
    elif action == "new_dream":
        await _send_new_dream_guide(bale, chat_id, user_id, msg_id=msg_id)
    elif action == "symbols":
        await _send_symbols_home(bale, chat_id, user_id, via="menu", msg_id=msg_id)
    elif action == "sub":
        await db.set_sym_browse(user_id, False)
        status = db.subscription_status(user or {})
        text, rows = _subscription_status_view(lang, status)
        await _edit_or_send(bale, chat_id, msg_id, text, rows)
    elif action == "persona":
        await db.set_sym_browse(user_id, False)
        ptext, rows = C.persona_change_message(lang)
        await _edit_or_send(bale, chat_id, msg_id, ptext, rows)


# ===================== پرداخت =====================

async def _after_purchase(bale, chat_id, user_id, resume: bool):
    """بعد از پرداخت: فقط اگر از مسیرِ خواب→پی‌وال آمده (resume) خواب را ادامه بده؛
    وگرنه (خریدِ مستقل از منوی «همسفری من») استیتِ خوابِ کهنه را پاک کن و منوی اصلی را نشان بده."""
    if resume:
        await _try_resume_pending_dream(bale, chat_id, user_id)
        return
    # خریدِ منو: هیچ خوابی resume نمی‌شود؛ استیتِ awaiting_paymentِ کهنه پاک شود تا بعداً زنده نشود
    user = await db.get_user(user_id)
    if (user or {}).get("pending_state") == "awaiting_payment":
        await db.clear_pending(user_id)
    lang = _lang_of(user, bale)
    text, rows = C.main_menu_message(lang)
    await bale.send_message(chat_id, text, reply_markup=inline_keyboard(rows))


async def _cb_buy(bale, cq_id, chat_id, user_id, tier, resume: bool = False):
    await bale.answer_callback_query(cq_id)
    if tier not in SUBSCRIPTIONS:
        return
    user = await db.get_user(user_id)
    lang = _lang_of(user, bale)
    mode = config.payment_mode(bale.platform, bale.locale)
    sub = SUBSCRIPTIONS[tier]

    if mode == "card":
        # تلگرامِ فارسی → کارت‌به‌کارت (ماژول cardpay). نیتِ resume در خودِ پرداخت ذخیره می‌شود.
        await CARDPAY.start(bale, user_id, chat_id, tier, amount_rial=sub["rial"],
                            amount_toman=sub["toman"], tier_title=sub["title"], resume=resume)
        return

    if mode == "bale_invoice":
        # بله → sendInvoice بومیِ کیف‌پولِ بله (پرداختِ واقعی)؛ نیتِ resume در payload کد می‌شود.
        await payments.send_subscription_invoice(bale, chat_id, user_id, tier, resume=resume)
        return

    # simulate (غیرفارسیِ تلگرام) → انتخاب روش (Stars / Crypto)؛ نشانِ resume تا پرداخت حفظ می‌شود
    methods = payment_methods_for(lang)
    suffix = ":r" if resume else ""
    rows = [[{"text": C.pay_method_button(lang, m), "callback_data": f"paym:{m}:{tier}{suffix}"}]
            for m in methods]
    rows.append(C.back_row(lang))  # قرارداد State Management: انتخابگر روش پرداخت هم دکمه‌ی بازگشت دارد
    title = locales.get(lang)["tiers"].get(tier, tier)
    text = f"*{title}*\n\n" + C.pay_choose_text(lang)
    await bale.send_message(chat_id, text, reply_markup=inline_keyboard(rows))


async def _cb_pay_method(bale, cq_id, chat_id, user_id, method, tier, resume: bool = False):
    await bale.answer_callback_query(cq_id)
    if tier not in SUBSCRIPTIONS:
        return
    # حالت تست: هر کلیک = پرداخت‌شده فرض می‌شود
    await payments.simulate_purchase(bale, chat_id, user_id, tier)
    await _after_purchase(bale, chat_id, user_id, resume)


async def _cb_view_full(bale, cq_id, chat_id, user_id, dream_id):
    dream = await db.get_dream(dream_id)
    user = await db.get_user(user_id)
    lang = _lang_of(user, bale)
    if not dream or dream["user_id"] != user_id:
        await bale.answer_callback_query(cq_id, text=C.dream_not_found(lang))
        return
    status = db.subscription_status(user or {})
    if status["active"]:
        # کاربر preview را قبلاً در دموی رایگان دیده؛ حالا فقط ادامه (depth، بخشِ دومِ JSON)
        # را می‌فرستیم تا preview دوباره (و احتمالاً تکراری) چسبانده نشود.
        depth = dream.get("depth") or dream["interpretation"]
        await bale.answer_callback_query(cq_id)
        await bale.send_message(chat_id, depth, parse_mode=None)
        await db.mark_full_delivered(dream_id)
        await analytics.track(user_id, "product_delivered", {"type": "dream", "dream_id": dream_id})
        await analytics.track_once(user_id, "first_value", {"via": "dream"})
    else:
        await bale.answer_callback_query(cq_id)
        await _send_paywall(bale, chat_id, lang, C.need_subscription_prefix(lang))


# ===================== تست ادمین =====================

async def _handle_simulate_pay(bale, chat_id, user_id, text):
    parts = text.split()
    tier = parts[1] if len(parts) > 1 else "week"
    if tier not in SUBSCRIPTIONS:
        await bale.send_message(chat_id, f"tier نامعتبر. یکی از: {', '.join(SUBSCRIPTIONS)}")
        return
    import uuid
    payload = f"sub_{tier}_{uuid.uuid4().hex}"
    await db.create_transaction(
        user_id, tier, SUBSCRIPTIONS[tier]["days"], SUBSCRIPTIONS[tier]["rial"], payload
    )
    await payments.apply_successful_payment(bale, user_id, payload, charge_id="SIMULATED")
