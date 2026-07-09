"""پروفایلینگِ کاربر — بافتِ خصوصیِ هر فرد برای شخصی‌سازیِ «زیرپوستیِ» تعبیر.

معماری:
- پروفایلینگ = همان `users.profile` (JSON پرسش‌وپاسخ‌های آنبوردینگ). هیچ store جداگانه‌ای ندارد،
  پس با هر تغییرِ جواب (db.save_onboarding_answer که `profile[key]` را overwrite می‌کند)
  هم دیتابیس هم پروفایلینگ هم‌زمان به‌روز می‌شوند.
- سؤال ۱ (persona) کارکردِ دوگانه دارد: (الف) انتخابِ منابع/لحنِ تعبیر، (ب) عضوی از پروفایلینگ.
  بلوکِ پرسونا جداگانه در prompts ساخته می‌شود؛ این ماژول فقط سؤال‌های ۲ تا ۷ را به بافتِ
  شخصیت/دغدغه/خلق‌وخو/سبک تبدیل می‌کند.

نقطه‌ی توسعه‌ی آینده (هنوز پیاده نشده):
  `merge_dream_signal(profile, signal)` — بعدها هر خوابِ تعبیرشده می‌تواند سیگنال‌هایی
  (تم‌های تکرارشونده، ترس‌ها، …) به پروفایلینگ بیفزاید تا پویا و خوداصلاح‌گر شود.
"""
import locales

# توصیفِ انگلیسیِ سؤال‌های پروفایلینگ (غیرپرسونا). پاسخ‌ها به زبانِ کاربر تزریق می‌شوند.
PROFILE_FIELDS = {
    "life_focus":      "What occupies their heart these days",
    "inner_compass":   "What they rely on most when making decisions",
    "nature_refuge":   "The natural setting where they find peace (reveals temperament)",
    "time_travel":     "Their pull toward past, future, or present",
    "dream_frequency": "How often they have dreams that catch their attention",
    "dream_recall":    "How much dream detail they usually remember",
}


def _answer_label(lang: str, key: str, value: str) -> str | None:
    """برچسبِ زبانِ کاربر برای یک پاسخِ آنبوردینگ (از locale)."""
    for q in locales.onboarding_questions(lang):
        if q["key"] == key:
            for val, label in q["options"]:
                if val == value:
                    return label
    return None


def build_context(lang: str, profile: dict | None) -> str:
    """بافتِ خصوصیِ فرد را به‌صورت چند خطِ توصیفی برای پرامپت می‌سازد (فقط سؤال‌های پروفایلینگ).
    اگر هیچ پاسخی نباشد، رشته‌ی خالی برمی‌گرداند."""
    profile = profile or {}
    lines = []
    for key, descriptor in PROFILE_FIELDS.items():
        val = profile.get(key)
        if not val:
            continue
        label = _answer_label(lang, key, val) or val
        lines.append(f"- {descriptor}: {label}")
    return "\n".join(lines)


# ===================== نقطه‌ی توسعه‌ی آینده (placeholder) =====================

def merge_dream_signal(profile: dict, signal: dict) -> dict:
    """آینده: ادغامِ سیگنال‌های یک خوابِ تعبیرشده در پروفایلینگ (پویا).
    فعلاً no-op است تا معماری آماده باشد."""
    return profile
