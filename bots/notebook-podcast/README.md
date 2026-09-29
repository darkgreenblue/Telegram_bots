# Telegram → NotebookLM podcast

ربات شخصی مالک برای جمع‌کردن چند منبع و ساخت Audio Overview در NotebookLM.

## رفتار ربات

۱. «📥 ورود ورودی‌ها» را بزنید. ربات یک بار درخواست ارسال منبع می‌کند.
۲. متن، لینک وب یا یوتیوب، PDF، فایل متنی، Word، PowerPoint، EPUB، CSV، تصویر، صوت یا ویدیو بفرستید. فایل‌ها به NotebookLM سپرده می‌شوند و اگر نوعی را نپذیرد، پس از زدن دکمهٔ پایان خطا گزارش می‌شود. در مرحلهٔ جمع‌آوری ربات عمداً هیچ پاسخی به هر ورودی نمی‌دهد.
۳. «✅ ورودی‌ها تمام شد» را بزنید. ربات یک نوت‌بوک تازه می‌سازد و منابع را به ترتیب وارد می‌کند. اگر منبعی رد شود، ساخت پادکست شروع نمی‌شود.
۴. قالب، زبان، طول و پرامپت راهنما را انتخاب کنید. انتخاب طول در همهٔ زبان‌ها نمایش داده و به NotebookLM ارسال می‌شود.
۵. فایل صوتی پس از آماده‌شدن در همان چت ارسال می‌شود.

تنها شناسه‌های عددی در `OWNER_TELEGRAM_ID` اجازهٔ استفاده دارند. درخواست‌های ناتمام در SQLite زیر `data/` حفظ می‌شوند. فایل‌های موقت پس از آپلود یا تحویل پاک می‌شوند. نوت‌بوک و منابع واردشده در حساب گوگل باقی می‌مانند.

## Secrets در GitHub

در ریپوی `darkgreenblue/Telegram_bots` به `Settings → Secrets and variables → Actions → New repository secret` بروید:

| نام دقیق | مقدار |
|---|---|
| `NOTEBOOK_PODCAST_BOT_TOKEN` | توکن همین ربات از BotFather |
| `NOTEBOOK_PODCAST_GOOGLE_MASTER_TOKEN_JSON` | **متن کامل** فایل `master_token.json` که در مرحلهٔ بعد ساخته می‌شود |
| `OWNER_TELEGRAM_ID` | شناسهٔ عددی تلگرام مالک؛ این Secret احتمالاً از قبل در ریپو تنظیم شده است |
| `VPS_SSH_KEY` | کلید اتصال VPS؛ از قبل در ریپو تنظیم شده و نباید عوض شود |

هیچ‌کدام را در چت، کد، Issue یا Pull Request قرار ندهید. اشتراک Google AI Pro خودش کلید API نیست؛ ربات از نشست همان حساب در NotebookLM استفاده می‌کند.

### ساخت فایل ورود گوگل

روی **کامپیوتر شخصیِ قابل‌اعتماد**، با Python 3.10 یا جدیدتر و مرورگر گرافیکی:

```bash
python3 -m venv notebook-login-venv
./notebook-login-venv/bin/pip install 'notebooklm-py[headless,browser]==0.8.3'
./notebook-login-venv/bin/notebooklm -p notebook-podcast login --master-token --account YOUR_GOOGLE_EMAIL
```

در پنجرهٔ مرورگری که باز می‌شود، با حسابِ دارای دسترسی NotebookLM وارد شوید. سپس محتوای فایل `~/.notebooklm/profiles/notebook-podcast/master_token.json` را **فقط** به‌عنوان مقدار Secret بالا در GitHub قرار دهید. این فایل دسترسی گسترده و ماندگار به حساب گوگل می‌دهد؛ بهتر است از یک حساب جداگانه با دسترسی لازم استفاده شود. فایل را در ریپو کپی نکنید. راهنمای رسمی کتابخانه: [headless server installation](https://github.com/teng-lin/notebooklm-py/blob/main/docs/installation.md#d-headless-server-or-ci).

## استقرار و بررسی

Workflow مستقل `Deploy Notebook Podcast` روی تغییرات این پوشه در `main` اجرا می‌شود. اگر سکرتی هنوز وارد نشده باشد، استقرار را رد می‌کند و نام سکرت‌های لازم را در لاگ می‌نویسد. پس از واردکردن سکرت‌ها، از تب `Actions → Deploy Notebook Podcast → Run workflow` آن را دستی اجرا کنید. کاربر نیازی به SSH ندارد. Workflow تنها پروسهٔ PM2 به نام `notebook-podcast` را نصب یا reload می‌کند.

برای آزمون واقعی، به ربات `/start` بفرستید و یک متن کوتاه و یک لینک یوتیوبِ دارای زیرنویس را امتحان کنید. ورود لینک یوتیوب فقط رونوشت آن را به منبع تبدیل می‌کند. ربات با API معمولی تلگرام نمی‌تواند فایل ورودی بزرگ‌تر از ۲۰ مگابایت را دانلود کند یا صوت بزرگ‌تر از ۵۰ مگابایت را مستقیم بفرستد.

## اجرای محلی توسعه

```bash
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
cp .env.example .env
# BOT_TOKEN و ADMIN_IDS را فقط در .env محلی وارد کنید.
.venv/bin/python bot.py
```

برای آزمون‌های بدون شبکه: `.venv/bin/python -m unittest discover -p 'test_*.py'`.
