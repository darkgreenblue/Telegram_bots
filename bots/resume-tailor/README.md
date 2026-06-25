# resume-tailor

ربات تلگرام: اول با گرفتن «شرح کامل سوابق کاری» + «رزومه‌ی اصلی» تو رو می‌شناسه، بعد برای هر آگهی شغلی (لینک یا متن) یک **رزومه‌ی استاندارد انگلیسیِ کاستومایز** می‌سازه.

- ویس → متن: `google/gemini-2.5-flash` (از طریق OpenRouter)
- تولید رزومه: `google/gemini-2.5-pro` (از طریق OpenRouter)
- اجرا: Node ۲۰، long-polling، دیتابیس SQLite در `./data/bot.db`

## فلو
1. `/start` → فرستادن شرح مفصل سوابق (متن یا PDF/DOCX/TXT)
2. فرستادن رزومه‌ی اصلی → ربات می‌گه «حالا می‌شناسمت»
3. فرستادن لینک آگهی شغلی → ربات کرال می‌کنه (اگه نشد، متن کامل آگهی رو می‌خواد)
4. توضیحات تکمیلی (متن یا ویس) یا «رد شو»
5. دریافت رزومه‌ی کاستومایز (متن + فایل `.md`)

دستورها: `/profile`, `/update_history`, `/update_resume`, `/reset`, `/help`

## اجرای محلی
```bash
cp .env.example .env   # BOT_TOKEN و OPENROUTER_API_KEY این پروژه را بگذارید
npm install
npm start
```

## دیپلوی روی VPS
این ربات بخشی از مونوریپوست و با PM2 از طریق `ecosystem.config.cjs` ریشه اجرا می‌شود.
نیازی به SSH دستی نیست؛ توکن و کلید **جداگانه** (برای اندازه‌گیری هزینه) از طریق GitHub Secrets تزریق می‌شوند:

در GitHub: **Settings → Secrets and variables → Actions → New repository secret** و این دو را بسازید:
- `RESUME_TAILOR_BOT_TOKEN` = توکن تلگرام این ربات
- `RESUME_TAILOR_OPENROUTER_KEY` = کلید OpenRouter این ربات

workflowِ `Deploy` در هر push به `main`، فایل `bots/resume-tailor/.env` را روی سرور از روی همین secretها می‌سازد و ربات را با pm2 استارت می‌کند. تا وقتی این دو secret تنظیم نشده باشند، ربات به‌صورت امن skip می‌شود و `voice2text` دست‌نخورده می‌ماند.
