"""لایه‌ی متن‌های رو به کاربر — زبان‌آگاه (dispatch روی پکیج locales).

اصل: همه‌ی توابع یک آرگومان `lang` می‌گیرند و رشته‌ی محلی را از locale می‌خوانند.
کاراکترِ «تعبیرکننده‌ی اعظم»، «قلمرو رویاها»، «همسفری» و ساختار تجربه در همه‌ی
زبان‌ها یکسان است؛ فقط محتوای محلی فرق می‌کند.
"""
import locales
from config import (
    SUBSCRIPTIONS, SUBSCRIPTION_ORDER, savings_percent, fmt_toman, DEFAULT_LANGUAGE,
    REFERRAL_ENABLED,
)

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


def main_reply_rows(lang: str | None, include_language: bool = True) -> list:
    """ردیف‌های کیبورد ثابتِ پایین (متن دکمه‌ها).
    include_language=False برای بله (تک‌زبانه)."""
    kb = kb_labels(lang)
    second_row = [kb["persona"]]
    if REFERRAL_ENABLED:           # دکمه‌ی «لینک دعوت» فقط وقتی رفرال روشن است
        second_row.append(kb["invite"])
    rows = [
        [kb["new_dream"], kb["subscription"]],
        second_row,
    ]
    if include_language:
        rows.append([kb["language"]])
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
        return f"{emoji} {title} — {fmt_toman(s['toman'])} تومان"
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
