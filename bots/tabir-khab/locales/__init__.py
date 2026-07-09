"""پکیج چندزبانه — هر زبان یک ماژول با ساختار یکسان (LOCALE dict).

اصل طراحی: تجربه‌ی کاربری (کاراکترِ «تعبیرکننده‌ی اعظم»، «قلمرو رویاها»،
«همسفری»، لحن قصه‌گو، روایت‌گرِ حین پردازش، ساختار teaser) در همه‌ی زبان‌ها
یکسان است. فقط پرسوناها، سؤال اولِ آنبوردینگ (که پرسونا را تعیین می‌کند)،
و رفرنس‌های پرامپتِ تعبیر per-language هستند.

ساختار هر LOCALE (کلیدهای لازم):
  meta:   {code, name, flag, select_label, output_language, rtl, digits}
  kb:     {new_dream, subscription, persona, invite, language}
  welcome_intro, choose_persona_first, persona_change_prompt
  onboarding: [ {key, prompt, options:[(val,label),...], is_persona?}, ... ]  (۵ سؤال؛ سؤال۰ پرسونا)
  personas:  { val: {prompt, greet, invite, image_caption, error}, ... }      (val = گزینه‌های سؤال۰)
  voice_too_short, voice_too_long, text_too_short
  confirm_voice, confirm_text, btn_confirm, btn_cancel, cancelled
  daily_limit, image_failed, btn_view_full
  narration: [...], narration_patience: [...]
  catchphrase, pay_success_tmpl({days}), referral_reward
  sub_active_tmpl({days}), need_subscription_prefix, paywall_intro
  invite_text_tmpl({link}), new_dream_greet, returning_welcome
  tiers: {week, month, quarter}                 (عنوان محلیِ پکیج‌ها)
  pay:   {choose_method, stars_btn, crypto_btn, zarinpal_stub, stars_stub, crypto_stub}
  lang_changed, processing_busy
"""
from locales import fa, en, ar, ru, es, pt

_LOCALES = {
    "fa": fa.LOCALE,
    "en": en.LOCALE,
    "ar": ar.LOCALE,
    "ru": ru.LOCALE,
    "es": es.LOCALE,
    "pt": pt.LOCALE,
}

DEFAULT_LANG = "fa"

# ترتیب نمایش در انتخابگر زبان
LANG_ORDER = ["fa", "en", "ar", "ru", "es", "pt"]


def get(lang: str | None) -> dict:
    return _LOCALES.get(lang or DEFAULT_LANG, _LOCALES[DEFAULT_LANG])


def is_supported(lang: str | None) -> bool:
    return lang in _LOCALES


def onboarding_questions(lang: str | None) -> list:
    return get(lang)["onboarding"]


def question_count(lang: str | None) -> int:
    return len(get(lang)["onboarding"])


def personas(lang: str | None) -> dict:
    return get(lang)["personas"]


def persona_order(lang: str | None) -> list:
    """ترتیب کلیدهای پرسونا = ترتیب گزینه‌های سؤال۰."""
    return [val for (val, _label) in get(lang)["onboarding"][0]["options"]]


def valid_persona(lang: str | None, persona: str) -> bool:
    return persona in get(lang)["personas"]


def default_persona(lang: str | None) -> str:
    return persona_order(lang)[0]


# ===================== اعداد محلی =====================

def num(lang: str | None, n) -> str:
    """رندر عدد با ارقام محلیِ زبان (فارسی/عربیِ شرقی یا غربی)."""
    digits = get(lang)["meta"].get("digits", "0123456789")
    return "".join(digits[int(d)] if d.isdigit() else d for d in str(n))


# ===================== انتخابگر زبان =====================

def language_picker_rows() -> list:
    """ردیف‌های دکمه‌ی انتخاب زبان (callback: lang:<code>)."""
    rows = []
    row = []
    for code in LANG_ORDER:
        meta = _LOCALES[code]["meta"]
        row.append({"text": meta["select_label"], "callback_data": f"lang:{code}"})
        if len(row) == 2:
            rows.append(row)
            row = []
    if row:
        rows.append(row)
    return rows


LANGUAGE_PICKER_TITLE = (
    "🌙\n"
    "🇮🇷 زبان خود را انتخاب کنید\n"
    "🇬🇧 Choose your language\n"
    "🇸🇦 اختر لغتك\n"
    "🇷🇺 Выберите язык\n"
    "🇪🇸 Elige tu idioma\n"
    "🇧🇷 Escolha seu idioma"
)


# ===================== اعتبارسنجی schema (آینده‌ی امن) =====================

# کلیدهای سطح‌بالای الزامی در هر locale (فارسی مرجع است).
_TOPLEVEL_KEYS = set(fa.LOCALE.keys())
# کلیدهای الزامیِ هر پرسونا
_PERSONA_KEYS = {"prompt", "greet", "invite", "image_caption", "error"}
# کلیدهای الزامیِ بخش pay
_PAY_KEYS = set(fa.LOCALE["pay"].keys())
# کلیدِ هر سؤال آنبوردینگ
_Q_KEYS = {"key", "prompt", "options"}


def validate() -> list[str]:
    """بررسی می‌کند هر زبان دقیقاً همان ساختار locale مرجع (فارسی) را دارد.
    لیست هشدارها را برمی‌گرداند (خالی = همه‌چیز سالم). در bot.py هنگام استارت صدا زده می‌شود."""
    warns: list[str] = []
    ref_qkeys = [q["key"] for q in fa.LOCALE["onboarding"]]  # کلیدهای پروفایل مرجع (به‌جز persona)

    for code, loc in _LOCALES.items():
        # ۱) کلیدهای سطح‌بالا
        missing = _TOPLEVEL_KEYS - set(loc.keys())
        if missing:
            warns.append(f"[{code}] کلیدهای سطح‌بالای گم‌شده: {sorted(missing)}")

        # ۲) pay
        for k in _PAY_KEYS:
            if k not in loc.get("pay", {}):
                warns.append(f"[{code}] pay.{k} گم‌شده")

        # ۳) پرسوناها: گزینه‌های سؤال۰ باید با کلیدهای personas یکی باشند + کلیدهای copy کامل
        q0_vals = [v for v, _ in loc["onboarding"][0]["options"]]
        for v in q0_vals:
            p = loc["personas"].get(v)
            if p is None:
                warns.append(f"[{code}] persona copy برای '{v}' گم‌شده")
                continue
            pmissing = _PERSONA_KEYS - set(p.keys())
            if pmissing:
                warns.append(f"[{code}] persona '{v}' کلیدهای گم‌شده: {sorted(pmissing)}")

        # ۴) سؤالات آنبوردینگ: ساختار + هم‌ترازیِ کلیدهای پروفایل (به‌جز سؤال پرسونا)
        non_persona_keys = [q["key"] for q in loc["onboarding"] if not q.get("is_persona")]
        ref_non_persona = [k for k in ref_qkeys if k != "persona"]
        if non_persona_keys != ref_non_persona:
            warns.append(f"[{code}] کلیدهای سؤال‌های پروفایل ناهماهنگ: {non_persona_keys} ≠ {ref_non_persona}")
        for q in loc["onboarding"]:
            if _Q_KEYS - set(q.keys()):
                warns.append(f"[{code}] سؤال '{q.get('key')}' ساختار ناقص")

        # ۵) tiers
        if set(loc.get("tiers", {})) != {"week", "month", "quarter"}:
            warns.append(f"[{code}] tiers ناقص: {set(loc.get('tiers', {}))}")

    return warns
