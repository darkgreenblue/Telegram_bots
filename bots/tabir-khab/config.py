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
GAPGPT_API_KEY          = os.getenv("GAPGPT_API_KEY", "").strip()
OPENROUTER_API_KEY      = os.getenv("OPENROUTER_API_KEY", "").strip()

# توکن کیف‌پول بله از @botfather
BALE_PAYMENT_TOKEN      = os.getenv("BALE_PAYMENT_TOKEN", "WALLET-TEST-1111111111111111").strip()
# توکن زرین‌پال تلگرام — فعلاً stub؛ بعداً از env خوانده می‌شود
TELEGRAM_PAYMENT_TOKEN  = os.getenv("TELEGRAM_PAYMENT_TOKEN", "").strip()

# ============================================================
#  ثابت‌های غیرمحرمانه — داخل کد
# ============================================================

# نسخه‌ی محصول (کوهورت users.first_version): با هر تغییر «رفتاری» رو-به-کاربر bump کن
# — بند «قوانین ربات زنده» CLAUDE.md ریشه‌ی مونوریپو
PRODUCT_VERSION = "1.3.1"   # 1.3.1: برگشتِ پرداختِ فیک (تأیید دومِ ادمین + لغوِ اشتراک + بی‌اعتمادیِ کاربر)

# --- پلتفرم‌ها ---
BALE_API_BASE     = "https://tapi.bale.ai"
TELEGRAM_API_BASE = "https://api.telegram.org"

# --- دیتابیس — هر ربات (پلتفرم×زبان) DB جداگانه دارد ---
BALE_DB_PATH     = "tabir_bale.db"
TELEGRAM_DB_PATH = "tabir_telegram.db"   # DB تاریخیِ ربات تلگرام → حالا رباتِ فارسی

# ============================================================
#  ربات‌ها — هر زبان یک رباتِ تلگرامِ مستقل (بدون مرحله‌ی انتخاب زبان)
# ============================================================
# معماری: یک پروسه، یک polling-loop برای هر ربات. کد و locale ها مشترک‌اند؛
# هر instance زبانش fix است (برای مارکتینگِ جدا و حذفِ استپ انتخاب زبان).
# فارسی: بله + تلگرام. بقیه‌ی زبان‌ها: فقط تلگرام. کلید OpenRouter مشترک است.
#
# توکن‌ها در .env: BALE_BOT_TOKEN، TELEGRAM_BOT_TOKEN_FA (فالبک: TELEGRAM_BOT_TOKEN
# — نام قدیمی، تا رباتِ موجود بدون تغییر secret کار کند)، TELEGRAM_BOT_TOKEN_EN و... .
# توکنِ خالی = آن ربات غیرفعال (بقیه بالا می‌آیند) — افزودن زبان‌ها تدریجی ممکن است.
# زبان جدید؟ فقط locales/<code>.py و LANG_ORDER — ربات و DBاش خودکار تعریف می‌شود.

def _env(*names: str) -> str:
    for n in names:
        v = os.getenv(n, "").strip()
        if v:
            return v
    return ""


def bot_instances() -> list[dict]:
    """تعریفِ همه‌ی ربات‌ها. import داخلی تا حلقه‌ی config↔locales پیش نیاید."""
    from locales import LANG_ORDER
    instances = [{
        "platform": "bale", "locale": "fa",
        "token": _env("BALE_BOT_TOKEN"), "db": BALE_DB_PATH,
    }]
    for code in LANG_ORDER:
        envs = (f"TELEGRAM_BOT_TOKEN_{code.upper()}",)
        db = f"tabir_telegram_{code}.db"
        if code == "fa":   # ربات موجود: نامِ قدیمیِ توکن و DB حفظ می‌شود (داده‌ها می‌مانند)
            envs += ("TELEGRAM_BOT_TOKEN",)
            db = TELEGRAM_DB_PATH
        instances.append({
            "platform": "telegram", "locale": code,
            "token": _env(*envs), "db": db,
        })
    return instances

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

# فالبک LLM: deepseek/deepseek-chat از OpenRouter
# زنجیره‌ی صوتی: gemini خطا داد → gpt-4o-mini-transcribe (STT) + deepseek (LLM)
# زنجیره‌ی متنی: gemini خطا داد → deepseek (LLM)
# نسخه‌ی غیرِ reasoning (سریع): deepseek-v4-pro حین «فکر کردن» ۷۷s+ طول می‌کشید و
# تایم‌اوت می‌خورد. deepseek-chat مستقیم جواب می‌دهد (~۱۰–۳۰s) و روی بنچمارک‌ها با
# gemini-flash رقابت می‌کند — برای فالبکِ نادر کاملاً کافی و قابل‌اعتماد است.
LLM_FALLBACK_MODEL  = "deepseek/deepseek-chat"

# فالبک STT: gpt-4o-mini-transcribe از OpenRouter (gemini خطا داد → STT → deepseek).
# کارش فقط رونویسیِ عینِ صوت به متن است (بدون هیچ تغییری). جایگزینِ whisper شد چون
# whisper بر اساسِ «دقیقه» قیمت می‌گیرد و گران بود؛ این مدل بر اساسِ توکن و ارزان‌تر است.
# نکته: این مدل فایلِ OGG/Opusِ تلگرام را اغلب رد می‌کند؛ پیش از ارسال به mp3 تبدیل می‌شود.
STT_FALLBACK_MODEL  = "openai/gpt-4o-mini-transcribe"

# ⚠️ تستِ موقت: وقتی True باشد، مدلِ اصلی (gemini-2.5-flash) کنار گذاشته می‌شود و همه‌ی
# خواب‌ها مستقیم از مسیرِ فالبک (STT+deepseek برای صوت، deepseek برای متن) می‌روند تا
# بتوان فالبک را در ربات تست کرد. بعد از تست، این را False کن تا به حالتِ عادی برگردد.
FORCE_FALLBACK_FOR_TEST = False

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
INTERPRET_TIMEOUT = 240   # فراخوانیِ LLM برای تعبیر (متن یا صوت تا ۱۰ دقیقه، شاملِ retry/fallback)
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

# --- ادمین (از env ADMIN_IDS کاما-جدا؛ همان OWNER_TELEGRAM_ID مشترکِ بقیه‌ی ربات‌ها) ---
ADMIN_IDS = [int(x) for x in os.getenv("ADMIN_IDS", "").replace(" ", "").split(",") if x.strip().isdigit()]
ADMIN_USER_ID = ADMIN_IDS[0] if ADMIN_IDS else 0  # سازگاری با کد قدیمی (اولین آی‌دی)

def is_admin(uid) -> bool:
    return uid in ADMIN_IDS

# --- دکمه‌ی تست موقت «ریسک کردن» ---
# وقتی True باشد، یک دکمه‌ی ریست کنار دکمه‌های اصلی ظاهر می‌شود.
# فشار دادن آن کاربر را کاملاً ریست می‌کند (آنبوردینگ، اشتراک، تریال — همه).
# سخت‌سازی پیش‌لانچِ ربات‌های زنده‌ی همسایه: خاموش تا غریبه نتواند تریالِ مجانی بی‌نهایت بگیرد.
RESET_BUTTON_ENABLED = False

# --- نمادیاب خواب (مسیر رایگان بدون LLM) ---
# وقتی True باشد، دکمه‌ی «نمادیاب خواب (رایگان)» در کیبورد اصلی و پی‌وال ظاهر می‌شود
# (فقط برای زبان‌هایی که دیتای symbols/<lang> دارند). Rollback فوری: False کن؛
# دکمه‌ها و callback ها محو می‌شوند و رفتار دقیقاً مثل قبل می‌شود.
SYMBOL_FINDER_ENABLED = True

# --- مارکر برش تعبیر (نقطه‌ی تعلیق برای تریال) ---
CUT_MARKER = "||CUT||"

# --- دارایی‌ها (مسکات تعبیرکننده‌ی اعظم) ---
ASSETS_DIR          = "assets"
MASCOT_WELCOME      = "mascot_welcome.png"   # حالت خوش‌آمدگویی
MASCOT_INVITE       = "mascot_invite.png"    # حالت دست‌دراز‌کرده (دعوت به همسفری)

# --- پرداخت ---
# روش پرداخت per (پلتفرم × زبان):
#   تلگرامِ فارسی → کارت‌به‌کارت (ماژول cardpay + ایجنتِ رسیدِ Gemini Flash)
#   بله (فارسی)   → sendInvoice بومیِ کیف‌پولِ بله (پرداختِ واقعیِ بله)
#   بقیه (غیرفارسی تلگرام) → فعلاً شبیه‌سازی (Stars/کریپتو، خارج از این فاز)
def payment_mode(platform: str, locale: str) -> str:
    if platform == "telegram" and (locale or DEFAULT_LANGUAGE) == "fa":
        return "card"
    if platform == "bale":
        return "bale_invoice"
    return "simulate"

# SKIP_PAYMENT فقط برای مسیرِ «simulate» (غیرفارسی) معنی دارد؛ کارت‌به‌کارت و بله واقعی‌اند.
SKIP_PAYMENT = True
SKIP_DAILY_LIMIT = False  # سقفِ «هر شب یک رویا» فعال — ضد مصرفِ LLM بی‌سقفِ غریبه

# --- کارت‌به‌کارت (تلگرامِ فارسی) ---
CARD_NUMBER          = os.getenv("CARD_NUMBER", "6219861904145405").strip()
CARD_OWNER           = os.getenv("CARD_OWNER", "علیرضا اولیا — بلوبانک").strip()
CARD_RECIPIENT_NAME  = os.getenv("CARD_RECIPIENT_NAME", "علیرضا اولیا").strip()  # نامِ تطبیق در رسید
CARD_DEST_LAST4      = os.getenv("CARD_DEST_LAST4", "5405").strip()             # ۴رقمِ آخرِ کارتِ مقصد
SUPPORT_CONTACT      = os.getenv("SUPPORT_CONTACT", "@alireza_oliya").strip()
# ایجنتِ رسید: روشن = تأییدِ خودکارِ AI؛ خاموش = همه‌ی رسیدها به ادمین (رول‌بکِ فوری).
RECEIPT_AI_AUTO_APPROVE = True
RECEIPT_MODEL           = LLM_MODEL   # Gemini Flash (چندوجهی، همان مسیرِ عکسِ ai.py)

# --- محدودیت‌ها ---
MIN_VOICE_DURATION = 10      # ثانیه — کمتر از این «خیلی کوتاه»
MAX_VOICE_DURATION = 300     # ثانیه — سقف ۵ دقیقه (هر دو پلتفرم)؛ بیشتر = «خیلی بلند» (کنترلِ هزینه)
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
# زبانِ هر ربات fix است (bot_instances)؛ انتخابگرِ زبان از UX حذف شده.
DEFAULT_LANGUAGE = "fa"

# روش پرداخت بر اساس زبان:
#   فارسی → زرین‌پال (stub فعلاً)
#   بقیه  → تلگرام Stars + رمزارز (فعلاً دکمه؛ کلیک = پرداخت‌شده در تست)
def payment_methods_for(lang: str) -> list[str]:
    return ["zarinpal"] if (lang or DEFAULT_LANGUAGE) == "fa" else ["stars", "crypto"]


def fmt_toman(n: int) -> str:
    return f"{n:,}"
