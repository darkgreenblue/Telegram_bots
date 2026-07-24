"""لایه‌ی متن‌های رو به کاربر — زبان‌آگاه (dispatch روی پکیج locales).

اصل: همه‌ی توابع یک آرگومان `lang` می‌گیرند و رشته‌ی محلی را از locale می‌خوانند.
کاراکترِ «تعبیرکننده‌ی اعظم»، «قلمرو رویاها»، «همسفری» و ساختار تجربه در همه‌ی
زبان‌ها یکسان است؛ فقط محتوای محلی فرق می‌کند.
"""
import locales
import symbols as SYM
from config import (
    SUBSCRIPTIONS, SUBSCRIPTION_ORDER, savings_percent, fmt_toman, DEFAULT_LANGUAGE,
    REFERRAL_ENABLED, SYMBOL_FINDER_ENABLED,
)
from support import SUPPORT_ENABLED, support_message as _support_message

_TIER_EMOJI = {"week": "🌒", "month": "🌓", "quarter": "🌕"}

# رشته‌های نادری که در schema‌ی locale نیستند (fallback محلی، یک‌جا)
_EXTRAS = {
    "dream_not_found": {
        "fa": "این رویا را در قلمرو نیافتم 🌫️",
        "en": "I couldn't find this dream in the realm 🌫️",
        "ar": "لم أجد هذه الرؤيا في العالَم 🌫️",
        "ru": "Я не нашёл этот сон в Царстве 🌫️",
        "es": "No encontré este sueño en el reino 🌫️",
        "pt": "Não encontrei este sonho no reino 🌫️",
    },
}


# ===================== هسته =====================

def L(lang: str | None) -> dict:
    return locales.get(lang)


def num(lang: str | None, n) -> str:
    return locales.num(lang, n)


def get(lang: str | None, key: str, **fmt) -> str:
    """رشته‌ی محلی برای key؛ اگر در locale نبود از _EXTRAS؛ با format اختیاری."""
    loc = locales.get(lang)
    val = loc.get(key)
    if val is None:
        extra = _EXTRAS.get(key, {})
        val = extra.get(lang or DEFAULT_LANGUAGE) or extra.get(DEFAULT_LANGUAGE) or ""
    return val.format(**fmt) if fmt else val


def dream_not_found(lang: str | None) -> str:
    return get(lang, "dream_not_found")


def processing_busy(lang: str | None) -> str:
    return get(lang, "processing_busy")


# ===================== کیبورد پایین =====================

def kb_labels(lang: str | None) -> dict:
    return locales.get(lang)["kb"]


def back_button(lang: str | None) -> dict:
    """دکمه‌ی «بازگشت» (اینلاین) → منوی اصلی. یک سطح بالاتر در فلوی درختی."""
    return {"text": get(lang, "btn_back"), "callback_data": "menu:home"}


def back_row(lang: str | None) -> list:
    return [back_button(lang)]


def support_message(lang: str | None, uid: int):
    """(text, inline_rows) پیامِ پشتیبانی به زبانِ کاربر: کدِ پیگیری + دکمه‌ی چتِ پشتیبانی
    با پیامِ آماده. منطق و حسابِ پشتیبانی در support.py (پورتِ shared/support.js)."""
    return _support_message(locales.get(lang)["support"], uid)


def main_menu_message(lang: str | None):
    """(text, rows) — منوی اصلیِ اینلاین که همه‌ی دکمه‌های بازگشت به آن می‌رسند.
    دکمه‌ها همان اکشن‌های منوی پایین‌اند (خواب جدید، نمادیاب، همسفری، تغییر سبک)."""
    kb = kb_labels(lang)
    rows = [[{"text": kb["new_dream"], "callback_data": "menu:new_dream"}]]
    if symbols_available(lang) and "symbols" in kb:
        rows.append([{"text": kb["symbols"], "callback_data": "menu:symbols"}])
    rows.append([{"text": kb["subscription"], "callback_data": "menu:sub"}])
    rows.append([{"text": kb["persona"], "callback_data": "menu:persona"}])
    return get(lang, "main_menu"), rows


def main_reply_rows(lang: str | None, include_language: bool = True,
                    include_reset: bool = False) -> list:
    """ردیف‌های کیبورد ثابتِ پایین (متن دکمه‌ها).
    include_language=False برای بله (تک‌زبانه).
    include_reset=True دکمه‌ی موقت تست «ریسک کردن» را اضافه می‌کند."""
    kb = kb_labels(lang)
    second_row = [kb["persona"]]
    if REFERRAL_ENABLED:           # دکمه‌ی «لینک دعوت» فقط وقتی رفرال روشن است
        second_row.append(kb["invite"])
    rows = [
        [kb["new_dream"], kb["subscription"]],
        second_row,
    ]
    # نمادیاب خواب — فقط برای زبان‌هایی که دیتا دارند (فعلاً fa) و وقتی فلگ روشن است
    if symbols_available(lang) and "symbols" in kb:
        rows.insert(1, [kb["symbols"]])
    if include_language:
        rows.append([kb["language"]])
    # 🆘 پشتیبانی — قرارداد مشترکِ همه‌ی ربات‌ها (SUPPORT_ENABLED=False → دکمه محو می‌شود)
    if SUPPORT_ENABLED and "support" in kb:
        rows.append([kb["support"]])
    if include_reset and "reset_test" in kb:
        rows.append([kb["reset_test"]])
    return rows


# ===================== خوش‌آمد / آنبوردینگ =====================

def welcome_message(lang: str | None):
    """(text, rows) — خوش‌آمد + دکمه‌ی شروع (سؤالات بعداً)."""
    count = locales.question_count(lang)
    intro = get(lang, "welcome_intro", count=num(lang, count))
    btn_label = get(lang, "onboarding_start_btn", count=num(lang, count))
    rows = [[{"text": btn_label, "callback_data": "onb_start"}]]
    return intro, rows


def onboarding_message(lang: str | None, step: int):
    """(text, rows) — هدرِ «پرسش X از Y» + گزینه‌ها + دکمه‌های قبل/بعد."""
    q = locales.onboarding_questions(lang)[step]
    total = locales.question_count(lang)
    progress = get(lang, "progress_tmpl", n=num(lang, step + 1), total=num(lang, total))
    lines = [progress, "", q["prompt"], ""]
    for i, (_val, label) in enumerate(q["options"], start=1):
        lines.append(f"{num(lang, i)}. {label}")

    # دکمه‌های گزینه‌ها
    option_buttons = [
        {"text": num(lang, i + 1), "callback_data": f"onb:{step}:{i}"}
        for i in range(len(q["options"]))
    ]
    rows = [option_buttons] if len(option_buttons) <= 5 else [option_buttons[:3], option_buttons[3:]]

    # فقط دکمه‌ی «پرسش قبل» — پرسشِ بعدی فقط با انتخابِ یک گزینه نمایش داده می‌شود
    if step > 0:
        rows.append([{"text": get(lang, "onboarding_prev_btn"), "callback_data": "onb_prev"}])

    return "\n".join(lines), rows


def persona_change_message(lang: str | None):
    """(text, rows) برای دکمه‌ی «تغییر سبک» — همان سؤال پرسونا با callback pers:idx."""
    q = locales.onboarding_questions(lang)[0]
    lines = [get(lang, "persona_change_prompt"), ""]
    for i, (_val, label) in enumerate(q["options"], start=1):
        lines.append(f"{num(lang, i)}. {label}")
    buttons = [{"text": num(lang, i + 1), "callback_data": f"pers:{i}"}
               for i in range(len(q["options"]))]
    rows = [buttons] if len(buttons) <= 5 else [buttons[:3], buttons[3:]]
    rows.append(back_row(lang))   # «تغییر سبک» → بازگشت به منوی اصلی (فلوی درختی)
    return "\n".join(lines), rows


# ===================== متن‌های per-persona =====================

def persona_key(lang: str | None, persona: str, key: str) -> str:
    personas = locales.personas(lang)
    p = personas.get(persona) or personas[locales.default_persona(lang)]
    return p[key]


def invite_line(lang: str | None, persona: str) -> str:
    return persona_key(lang, persona, "invite")


def ready_text(lang: str | None, persona: str) -> str:
    """پس از آنبوردینگ یا تغییر سبک."""
    return persona_key(lang, persona, "greet") + "\n" + persona_key(lang, persona, "invite")


def new_dream_text(lang: str | None, persona: str) -> str:
    """دکمه‌ی «خواب جدید» — کاربر را از قبل می‌شناسیم."""
    return get(lang, "new_dream_greet") + "\n" + persona_key(lang, persona, "invite")


# ===================== همسفری / پرداخت =====================

def subscription_status_text(lang: str | None, status: dict) -> str:
    if status.get("active"):
        rem = num(lang, status.get("remaining_days", 0))
        return get(lang, "sub_active_tmpl", days=rem)
    return get(lang, "sub_inactive_head") + "\n\n" + paywall_body(lang)


def paywall_body(lang: str | None) -> str:
    """متنِ بازاریابیِ همسفری (بدونِ قیمت — قیمت‌ها روی خودِ دکمه‌ها هستند).
    دکمه‌ها جداگانه با _packages_inline ساخته می‌شوند و دست‌نخورده‌اند."""
    return get(lang, "paywall_offer")


def paywall_full(lang: str | None, prefix: str = "") -> str:
    head = (prefix.strip() + "\n") if prefix else ""
    return head + paywall_body(lang)


def need_subscription_prefix(lang: str | None) -> str:
    return get(lang, "need_subscription_prefix")


def sub_button_label(lang: str | None, tier: str) -> str:
    loc = locales.get(lang)
    title = loc["tiers"].get(tier, tier)
    emoji = _TIER_EMOJI.get(tier, "🌙")
    if (lang or DEFAULT_LANGUAGE) == "fa":
        s = SUBSCRIPTIONS[tier]
        return f"{emoji} {title}: {fmt_toman(s['toman'])} تومان"
    return f"{emoji} {title}"


def pay_success(lang: str | None, days: int) -> str:
    return get(lang, "pay_success_tmpl", days=num(lang, days))


def referral_reward(lang: str | None) -> str:
    return get(lang, "referral_reward")


# ===================== روش‌های پرداخت (Stars / Crypto / زرین‌پال) =====================

def pay_dict(lang: str | None) -> dict:
    return locales.get(lang)["pay"]


def pay_choose_text(lang: str | None) -> str:
    return pay_dict(lang).get("choose_method", "")


def pay_method_button(lang: str | None, method: str) -> str:
    return pay_dict(lang).get(f"{method}_btn", method)


def pay_stub(lang: str | None, method: str) -> str:
    return pay_dict(lang).get(f"{method}_stub", "")


def zarinpal_stub(lang: str | None) -> str:
    return pay_dict(lang).get("zarinpal_stub", "")


# ===================== لینک دعوت =====================

def invite_text(lang: str | None, link: str) -> str:
    return get(lang, "invite_text_tmpl", link=link)


# ===================== نمادیاب خواب =====================
# مرور رایگان نمادها (بدون LLM). دیتا: پکیج symbols؛ متن‌ها: بخش sym هر locale.
# قرارداد callback ها (همه ASCII و کوتاه): sym:home | sym:l:<li> | sym:p:<li>:<page> |
# sym:w:<li>:<wi> | sym:dream | sym:open (ورود از پی‌وال). li/wi = ایندکس حرف/کلمه.

SYM_PAGE_SIZE = 10        # کلمه در هر صفحه (۵ ردیف ۲تایی)
SYM_LETTERS_PER_ROW = 4   # حروف الفبا در هر ردیف گرید


def symbols_available(lang: str | None) -> bool:
    return SYMBOL_FINDER_ENABLED and SYM.has_data(lang)


def sym_text(lang: str | None, key: str, **fmt) -> str:
    val = locales.get(lang).get("sym", {}).get(key, "")
    return val.format(**fmt) if fmt else val


def _sym_rows(items: list, per_row: int, rtl: bool) -> list:
    """چانک دکمه‌ها + برعکس‌کردن هر ردیف در RTL تا ترتیب بصری راست‌به‌چپ شود."""
    rows = [items[i:i + per_row] for i in range(0, len(items), per_row)]
    return [list(reversed(r)) for r in rows] if rtl else rows


def _sym_rtl(lang: str | None) -> bool:
    return bool(locales.get(lang)["meta"].get("rtl"))


def symbols_home_message(lang: str | None):
    """(text, rows) — معرفی + راهنمای تایپ + گرید حروف الفبا."""
    buttons = [{"text": letter, "callback_data": f"sym:l:{i}"}
               for i, letter in enumerate(SYM.letters(lang))]
    rows = _sym_rows(buttons, SYM_LETTERS_PER_ROW, _sym_rtl(lang))
    rows.append(back_row(lang))   # خانه‌ی نمادیاب → منوی اصلی (فلوی درختی)
    hint = sym_text(lang, "search_hint")
    intro = sym_text(lang, "intro") + (("\n\n" + hint) if hint else "")
    return intro, rows


def symbols_result_list_message(lang: str | None, results: list):
    """(text, rows) — جستجو چند نماد برگرداند: دکمه‌های انتخاب (sym:w) + برگشت به حروف."""
    buttons = [{"text": e["word"], "callback_data": f"sym:w:{li}:{wi}"} for li, wi, e in results]
    rows = _sym_rows(buttons, 2, _sym_rtl(lang))
    rows.append([{"text": sym_text(lang, "btn_letters"), "callback_data": "sym:home"}])
    return sym_text(lang, "search_multi", count=num(lang, len(results))), rows


def symbols_not_found_message(lang: str | None, query: str, suggestions: list):
    """(text, rows) — جستجوی بی‌نتیجه: پیام صادقانه + پیشنهادِ نزدیک + CTA خواب کامل + حروف.
    این پیام باید با parse_mode=None فرستاده شود چون کوئریِ خام کاربر را نمایش می‌دهد."""
    rtl = _sym_rtl(lang)
    rows = []
    if suggestions:
        sug = [{"text": e["word"], "callback_data": f"sym:w:{li}:{wi}"} for li, wi, e in suggestions]
        rows += _sym_rows(sug, 2, rtl)
    rows.append([{"text": sym_text(lang, "btn_dream"), "callback_data": "sym:dream"}])
    rows.append([{"text": sym_text(lang, "btn_letters"), "callback_data": "sym:home"}])
    disp = " ".join((query or "").split())[:40]
    return sym_text(lang, "not_found", query=disp), rows


def symbols_list_message(lang: str | None, li: int, page: int):
    """(text, rows) — لیست صفحه‌بندی‌شده‌ی کلمات یک حرف. حرف نامعتبر → (None, None)."""
    letter = SYM.letter_at(lang, li)
    if letter is None:
        return None, None
    entries = SYM.words_for(lang, letter)
    # «بازگشت» یک سطح بالاتر = گریدِ حروف (خانه‌ی نمادیاب)؛ جایگزینِ دکمه‌ی «همه‌ی حروف».
    back = [{"text": get(lang, "btn_back"), "callback_data": "sym:home"}]
    if not entries:
        return sym_text(lang, "letter_empty", letter=letter), [back]

    pages = (len(entries) + SYM_PAGE_SIZE - 1) // SYM_PAGE_SIZE
    page = max(0, min(page, pages - 1))
    start = page * SYM_PAGE_SIZE
    rtl = _sym_rtl(lang)

    buttons = [{"text": e["word"], "callback_data": f"sym:w:{li}:{start + j}"}
               for j, e in enumerate(entries[start:start + SYM_PAGE_SIZE])]
    rows = _sym_rows(buttons, 2, rtl)

    # ناوبریِ صفحه: به‌جای قبل/بعد، دکمه‌ی کوچکِ هر صفحه؛ صفحه‌ی فعلی با تیک سبز.
    if pages > 1:
        page_btns = []
        for p in range(pages):
            label = sym_text(lang, "page_btn", n=num(lang, p + 1))
            if p == page:
                label = "✅ " + label
            page_btns.append({"text": label, "callback_data": f"sym:p:{li}:{p}"})
        rows += _sym_rows(page_btns, 5, rtl)   # حداکثر ۵ صفحه در هر ردیف
    rows.append(back)

    text = sym_text(lang, "letter_header", letter=letter,
                    page=num(lang, page + 1), pages=num(lang, pages))
    return text, rows


def symbols_word_message(lang: str | None, li: int, wi: int, persona: str | None):
    """(text, rows, entry) — تعبیر کوتاه نماد برای پرسونای کاربر + CTA. نامعتبر → (None, None, None)."""
    entry = SYM.get(lang, li, wi)
    if entry is None:
        return None, None, None
    body = SYM.tafsir_for(entry, persona)
    text = (sym_text(lang, "word_title", word=entry["word"])
            + "\n\n" + body + "\n\n" + sym_text(lang, "cta_line"))
    page = wi // SYM_PAGE_SIZE
    second = [{"text": sym_text(lang, "btn_back_list"), "callback_data": f"sym:p:{li}:{page}"},
              {"text": sym_text(lang, "btn_letters"), "callback_data": "sym:home"}]
    rows = [
        [{"text": sym_text(lang, "btn_dream"), "callback_data": "sym:dream"}],
        list(reversed(second)) if _sym_rtl(lang) else second,
    ]
    return text, rows, entry
