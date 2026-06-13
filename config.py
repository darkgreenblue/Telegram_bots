"""پیکربندی و ثابت‌های ربات تعبیر خواب.

سیاست: فقط مقادیر محرمانه از .env خوانده می‌شوند (توکن‌ها/کلیدها).
باقی همه‌چیز (مدل‌ها، آدرس‌ها، قیمت‌ها، پرسوناها، سؤالات) همین‌جا در کد ثابت است.
"""
import os
from dotenv import load_dotenv

load_dotenv()

# ============================================================
#  محرمانه‌ها — تنها چیزهایی که در .env قرار می‌گیرند
# ============================================================
BALE_BOT_TOKEN          = os.getenv("BALE_BOT_TOKEN", "").strip()
TELEGRAM_BOT_TOKEN      = os.getenv("TELEGRAM_BOT_TOKEN", "").strip()
GAPGPT_API_KEY          = os.getenv("GAPGPT_API_KEY", "").strip()
OPENROUTER_API_KEY      = os.getenv("OPENROUTER_API_KEY", "").strip()

# توکن کیف‌پول بله از @botfather
BALE_PAYMENT_TOKEN      = os.getenv("BALE_PAYMENT_TOKEN", "WALLET-TEST-1111111111111111").strip()
# توکن زرین‌پال تلگرام — فعلاً stub؛ بعداً از env خوانده می‌شود
TELEGRAM_PAYMENT_TOKEN  = os.getenv("TELEGRAM_PAYMENT_TOKEN", "").strip()

# ============================================================
#  ثابت‌های غیرمحرمانه — داخل کد
# ============================================================

# --- پلتفرم‌ها ---
BALE_API_BASE     = "https://tapi.bale.ai"
TELEGRAM_API_BASE = "https://api.telegram.org"

# --- دیتابیس — هر پلتفرم DB جداگانه دارد ---
BALE_DB_PATH     = "tabir_bale.db"
TELEGRAM_DB_PATH = "tabir_telegram.db"

# --- GapGPT (OpenAI-compatible) — فقط برای تولید تصویر اصلی ---
GAPGPT_BASE_URL  = "https://api.gapgpt.app/v1"
IMAGE_MODEL      = "gapgpt/z-image"   # url مستقیم برمی‌گرداند — دست نزن

# --- ابعاد و قاب‌بندیِ هنریِ تصویرِ خروجی (عمودی ۹:۱۶، مناسبِ استوریِ سوشال‌مدیا) ---
# ابعاد فقط «درخواست» می‌شود؛ هیچ بررسیِ هاردکدی روی ابعاد انجام نمی‌شود و در صورتِ
# اشتباه‌بودن ریکوئستِ دوباره زده نمی‌شود — ابعادِ واقعی فقط در DB ثبت می‌شود (برای آمار).
IMAGE_SIZE = "1024x1792"   # عمودی ~۹:۱۶
# روشناییِ بیشینه‌ی کمتر از این → تصویر «کاملاً سیاه» تلقی می‌شود (تنها بررسیِ هاردکدِ تصویر)
IMAGE_BLACK_MAX_LUMA = 8

# قاب‌بندیِ هنری در کد ساخته می‌شود؛ توصیفِ بصریِ خواب (خروجیِ مدلِ زبانی) به‌عنوان
# context داخلش تزریق می‌شود. هدف: تصویری وهم‌آلود، عجیب و چشم‌نواز که کاربر میل به
# هم‌رسانیِ آن در سوشال‌مدیا داشته باشد (بدون اشاره‌ی مستقیم به «اشتراک‌گذاری»).
IMAGE_ART_DIRECTION = (
    "Vertical 9:16 portrait composition that fills a social-media story frame. "
    "Surreal, dreamlike and uncanny; a haunting ethereal mystical-night atmosphere with "
    "deep shadows and glowing otherworldly light. Striking, strange and unforgettable — "
    "a mesmerizing, share-worthy dream-image. Rich detail, cinematic depth, painterly "
    "surrealism, high quality.\n\n"
    "Depict the following dream scene:\n{description}"
)

# اگر مدلِ تصویر یک فریمِ کاملاً سیاه برگرداند (به‌خاطرِ موارد حساس)، ریکوئستِ دوم با
# این یادداشت به همان مدلِ اصلیِ تصویر (نه فالبک) فرستاده می‌شود.
IMAGE_SAFE_RETRY_NOTE = (
    "Render this as a purely artistic, symbolic, safe-for-all-audiences dream image. "
    "Any sensitive, disturbing or explicit element must be omitted or softened into a gentle "
    "artistic metaphor (a soft shadow, a wisp of mist, a closed door). Never leave the frame "
    "dark or empty — always produce a fully rendered, luminous, detailed scene."
)

# --- OpenRouter — همه‌ی LLM (صوت+متن) از اینجا ---
OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1"

# مدل اصلی: Gemini 2.5 Flash از OpenRouter — چندوجهی (صوت + متن در یک ریکوئست)
# جایگزین دو مرحله‌ی قبلی: whisper-1 (STT) + qwen-thinking (LLM)
LLM_MODEL           = "google/gemini-2.5-flash"
PAID_TIER_LLM_MODEL = LLM_MODEL
FREE_TIER_LLM_MODEL = LLM_MODEL

# فالبک LLM: deepseek/deepseek-v4-pro از OpenRouter
# زنجیره‌ی صوتی: gemini خطا داد → whisper-1 (STT) + deepseek (LLM)
# زنجیره‌ی متنی: gemini خطا داد → deepseek (LLM)
LLM_FALLBACK_MODEL  = "deepseek/deepseek-v4-pro"

# فالبک STT: whisper-1 از OpenRouter (gemini خطا داد → whisper → deepseek)
STT_FALLBACK_MODEL  = "openai/whisper"

# فالبک تصویر: فعلاً غیرفعال — مدل مناسبی پیدا نشده
IMAGE_FALLBACK_MODEL = ""

# اگر مدل اصلی خروجیِ «خارج از قالب» داد (JSON خراب یا کلیدهای ناقص)،
# همان مدل اصلی تا این تعداد بار دوباره صدا زده می‌شود، و فقط بعد از آن سراغ فالبک می‌رویم.
PRIMARY_FORMAT_ATTEMPTS = 2

# --- تایم‌اوتِ مراحلِ پردازشِ خواب (ثانیه) ---
# هر مرحله سقفِ زمانی دارد تا یک هنگِ شبکه/مدل، کلِ پردازش را بی‌نهایت معلق نگذارد.
# عبور از سقف = خطا → پیامِ خطا به کاربر + امکانِ بازتلاش (به‌جای انتظارِ بی‌پایان).
FILE_API_TIMEOUT  = 30    # getFile (گرفتن مسیرِ فایلِ صوتی)
DOWNLOAD_TIMEOUT  = 120   # دانلودِ فایلِ صوتی
INTERPRET_TIMEOUT = 240   # فراخوانیِ LLM برای تعبیر (متن یا صوت تا ۱۵ دقیقه، شاملِ retry/fallback)
IMAGE_TIMEOUT     = 120   # تولیدِ تصویر (اختیاری — شکست یا تایم‌اوتش تعبیر را متوقف نمی‌کند)

# --- لاگ‌گیریِ ماندگار ---
LOG_DIR  = "logs"
LOG_FILE = "logs/bot.log"


def llm_model_for(tier: str) -> str:
    """انتخاب مدل تعبیر بر اساس ردیف کاربر ('free' یا 'paid')."""
    return FREE_TIER_LLM_MODEL if tier == "free" else PAID_TIER_LLM_MODEL


# --- شبکه ---
BALE_SSL_NO_VERIFY     = True   # شبکه محلی با گواهی self-signed
TELEGRAM_SSL_NO_VERIFY = True

# --- ادمین (برای دستور تست /simulate_pay) ---
ADMIN_USER_ID = 0

# --- مارکر برش تعبیر (نقطه‌ی تعلیق برای تریال) ---
CUT_MARKER = "||CUT||"

# --- دارایی‌ها (مسکات تعبیرکننده‌ی اعظم) ---
ASSETS_DIR          = "assets"
MASCOT_WELCOME      = "mascot_welcome.png"   # حالت خوش‌آمدگویی
MASCOT_INVITE       = "mascot_invite.png"    # حالت دست‌دراز‌کرده (دعوت به همسفری)

# --- پرداخت ---
# فعلاً پرداخت رد می‌شود: کلیک روی پلن بلافاصله همسفری را فعال می‌کند.
# برای فعال‌کردن درگاه واقعی، این را False کن.
SKIP_PAYMENT = True
SKIP_DAILY_LIMIT = True   # برای تست: محدودیت «هر شب یک رویا» را برمی‌دارد — برای پروداکشن False کن

# --- محدودیت‌ها ---
MIN_VOICE_DURATION = 10      # ثانیه — کمتر از این «خیلی کوتاه»
MAX_VOICE_DURATION = 900     # ثانیه — سقف ۱۵ دقیقه (هر دو پلتفرم)؛ بیشتر = «خیلی بلند»
MIN_TEXT_CHARS     = 25      # حداقل کاراکتر ورودی متنی
MAX_TEXT_CHARS     = 4096    # سقف پیام پیام‌رسان‌ها
TEASER_MAX_CHARS   = 950     # هدف teaser — بلندتر از قبل ولی همچنان در کپشن عکس (سقف ~۱۰۲۴) جا می‌شود
NARRATE_INTERVAL   = 4.5     # ثانیه — فاصله‌ی جملات روایت‌گرِ حین پردازش

# --- اقتصاد: اشتراک زمان‌دار (به‌جای اعتبار ستاره‌ای) ---
# مبلغ ریال = تومان × ۱۰ (برای درگاه بله)
SUBSCRIPTIONS = {
    "week":    {"days": 7,  "toman": 98_000,  "rial": 980_000,   "title": "۷ روزه"},
    "month":   {"days": 30, "toman": 198_000, "rial": 1_980_000, "title": "۱ ماهه"},
    "quarter": {"days": 90, "toman": 398_000, "rial": 3_980_000, "title": "۳ ماهه"},
}
SUBSCRIPTION_ORDER = ["week", "month", "quarter"]

REFERRAL_REWARD_DAYS = 7     # پاداش معرف: ۷ روز اشتراک هدیه
# سیستم رفرال موقتاً خاموش: دکمه‌ی «لینک دعوت» پنهان، deeplinkِ ref_ نادیده، پاداشِ معرف غیرفعال.
# برای روشن‌کردن دوباره True کن.
REFERRAL_ENABLED = False


def _per_day_toman(tier: str) -> float:
    s = SUBSCRIPTIONS[tier]
    return s["toman"] / s["days"]


def savings_percent(tier: str) -> int:
    """٪ صرفه‌جویی نرخ روزانه نسبت به پلن پایه (هفتگی)، رند به نزدیک‌ترین ۱۰.
    ماهانه ≈ ۵۰٪، سه‌ماهه ≈ ۷۰٪."""
    base = _per_day_toman("week")
    pct = (1 - _per_day_toman(tier) / base) * 100
    return int(round(pct / 10.0) * 10)


# --- چندزبانه ---
# پرسوناها، سؤالات آنبوردینگ، و همه‌ی متن‌ها در پکیج locales/ تعریف شده‌اند.
# هر زبان فایل خودش را دارد (locales/fa.py, en.py, ...).
DEFAULT_LANGUAGE = "fa"

# فقط تلگرام چندزبانه است؛ بله فقط فارسی.
def multilang_enabled(platform: str) -> bool:
    return platform == "telegram"

# روش پرداخت بر اساس زبان:
#   فارسی → زرین‌پال (stub فعلاً)
#   بقیه  → تلگرام Stars + رمزارز (فعلاً دکمه؛ کلیک = پرداخت‌شده در تست)
def payment_methods_for(lang: str) -> list[str]:
    return ["zarinpal"] if (lang or DEFAULT_LANGUAGE) == "fa" else ["stars", "crypto"]


def fmt_toman(n: int) -> str:
    return f"{n:,}"
