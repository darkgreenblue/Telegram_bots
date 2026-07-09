# 🌙 ربات تعبیر خواب صوتی «بله» (تعبیرِ خواب)

ربات («بازو») پیام‌رسان بله که خواب صوتی/متنی کاربر را می‌گیرد، با هوش مصنوعی تعبیر می‌کند
و تصویر سورئال رویا می‌سازد. واحد پولی: «ستاره» ⭐.

## معماری
- **بله:** کلاینت async روی `aiohttp` (long-polling، بدون نیاز به IP عمومی).
- **هوش مصنوعی:** GapGPT (OpenAI-compatible) — تبدیل صوت با Gemini Flash (fallback ویسپر)،
  تعبیر تک‌ریکوئستی JSON، تصویر با DALL·E 3.
- **دیتابیس:** SQLite (`aiosqlite`).
- **پرداخت:** درگاه بومی بله (`sendInvoice`) — کاملاً درون پیام‌رسان.
- **شخصی‌سازی:** ۴ پرسونا (مذهبی/سنتی/اساطیری/روان‌شناختی) با لحن کپی و کانتکست پرامپت جداگانه.

## فایل‌ها
| فایل | نقش |
|---|---|
| `config.py` | env و ثابت‌ها (پکیج‌ها، هزینه‌ها، پرسوناها) |
| `texts.py` | تمام متن‌های کاربر + متن‌های per-persona |
| `db.py` | اسکیمای SQLite و توابع |
| `bale.py` | کلاینت Bale Bot API |
| `prompts.py` | سیستم‌پرامپت + بلوک هر پرسونا |
| `ai.py` | GapGPT: transcribe / interpret / image |
| `handlers.py` | روتینگ و منطق تعامل |
| `payments.py` | فاکتور بله + رفرال |
| `bot.py` | حلقه‌ی polling |

## راه‌اندازی
```bash
pip install -r requirements.txt
cp .env.example .env      # فقط دو کلید محرمانه را پر کنید
python bot.py
```

### `.env` — فقط محرمانه‌ها
- `BALE_BOT_TOKEN` — توکن ربات از @botfather در بله.
- `GAPGPT_API_KEY` — کلید GapGPT.
- `BALE_PAYMENT_TOKEN` — اختیاری؛ خالی بماند از توکن تست استفاده می‌شود.

### باقی تنظیمات در `config.py` (نه در env)
- مدل‌ها: `gemini-2.0-flash` (تعبیر و صوت)، `whisper-1` (fallback صوت)، `dall-e-3` (تصویر).
- `GAPGPT_BASE_URL = https://gapgpt.app/api/v1` (طبق داک رسمی).
- قیمت پکیج‌ها، هزینه‌ها، پرسوناها.
- `BOT_USERNAME` خودکار با `getMe` گرفته می‌شود (دستی لازم نیست).
- `ADMIN_USER_ID` — برای دستور تستِ `/simulate_pay` آی‌دی عددی خود را در `config.py` بگذارید.

## تست رفرال بدون درگاه واقعی
کاربر B با لینک `https://ble.ir/<BOT>?start=ref_<A_id>` وارد شود، سپس ادمین `/simulate_pay basic`
را اجرا کند تا جریان خرید + پاداش رفرال شبیه‌سازی شود.

## نکات اجرا
- اگر تبدیل صوت با Gemini روی GapGPT کار نکرد، خودکار به `whisper-1` سوییچ می‌شود؛
  در صورت نیاز `STT_MODEL` را در `.env` به `whisper-1` تغییر دهید.
- `GAPGPT_BASE_URL` را با مقدار دقیق داشبورد GapGPT تطبیق دهید.

## فازهای بعد (خارج از MVP)
زرین‌پال، دیتاست/RAG تعبیر، Postgres، داشبورد ادمین.
