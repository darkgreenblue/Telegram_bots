# CLAUDE.md — resume-tailor (رزومه‌ساز 📄 — فاز تست، بدون درآمد)

> این فایل باید با هر PR که رفتار ربات را عوض می‌کند به‌روز شود. از `shared/` (logger, errors) استفاده می‌کند.

## چیستی
ساخت رزومه‌ی استاندارد انگلیسی کاستومایز برای هر آگهی شغلی، با پایپلاین چندایجنتی. بدون کیف‌پول/پرداخت. State کاملاً در SQLite persist است (ری‌استارت امن — برخلاف voice2text).

## فلوی محصول
1. **پروفایل master**: `/start` → «رزومه داری؟» → (اختیاری) فایل رزومه (PDF/DOCX/txt/ویس) → جمع‌آوری چندتکه‌ی سوابق (`history_chunks`) تا دکمه‌ی «✅ همه را فرستادم».
2. **ساماندهی** (`buildStructuredProfile`): لایه۱ Flash تفکیک شرکت‌ها (JSON) → لایه۲ Flash موازی per شرکت → `structured_profile`. شکست → state به collect_history برمی‌گردد. *(نکته: کامنت‌های قدیمی می‌گفتند Pro؛ کد Flash است — منبع حقیقت کد.)*
3. **ویرایش**: `/profile` نمایش، `/edit` → انتخاب شرکت → دستور متنی/ویسی → `AGENT_EDIT_COMPANY` (Flash).
4. **تولید per آگهی** (state `ready`): لینک (کرال با UA مرورگر، timeout ۲۵s، حداقل ۴۰۰ کاراکتر، شکست → درخواست متن دستی) یا متن آگهی → توضیحات اختیاری → planner (Flash) بخش‌ها را تعیین می‌کند (core: summary/skills/experience همیشه) → ایجنت‌های بخش موازی: **Experience با PRO**، بقیه Flash → ترکیب برنامه‌نویسی‌شده: header تماس + بخش‌های غیرخالی Markdown → ارسال متن تکه‌تکه + فایل `.md` + راهنمای PDF. لاگ در `generations`.

## اصول LLM
- `FLASH=gemini-2.5-flash` (همه‌چیز)؛ `PRO=gemini-2.5-pro` (فقط Experience — بهینه‌سازی هزینه).
- `RESUME_KNOWLEDGE` (resume-knowledge.js — عصاره‌ی deep-research رزومه‌نویسی) + اصل `NO_HALLUCINATION` به همه‌ی ایجنت‌های planner/تولید تزریق می‌شود.
- بدون retry per فراخوانی؛ degradation نرم: planner→DEFAULT_SECTIONS، بخش شکست‌خورده حذف، organize→ساختار حداقلی. ویس→متن با Flash (`input_audio`، ogg با برچسب mp3).

## دیتابیس (`data/bot.db`)
`users` (state، pending_job_url/text، edit_company_idx، **first_source/first_payload** اتریبیوشن write-once)، `profiles` (main_resume، contact_info، structured_profile JSON)، `history_chunks` (kind: text/document/voice)، `generations`، **`events`** (آنالیتیکس مشترک).

## آنالیتیکس و اتریبیوشن (shared/analytics.js)
- `ensureAnalytics(db)` بعد از ساخت جدول‌ها؛ `captureStart` در `bot.start` (رویداد `start` برای هر /start + first_source فقط کاربر جدید؛ payload: `c_<code>` کمپین / خالی = organic — این ربات رفرال ندارد).
- رویدادها: `start`، `onboard_done` (پایان ساماندهی پروفایل)، `product_delivered` + `first_value` (تحویل رزومه)، `reset`. `wipeUser` جدول events را هم پاک می‌کند. خطای track هرگز فلو را نمی‌شکند.

## ماشین حالت
`new → ask_has_resume → await_resume_file → collect_history → structuring → ready` + `edit_company`, `await_notes`, `await_job_text`. ویس فقط در `await_notes/collect_history/edit_company/await_resume_file`.

## دیباگ‌پذیری و ریست
- `bot.catch` سراسری (`makeBotCatch` از shared) + هندلرهای پروسه (`registerGlobalErrorHandlers`).
- دکمه‌ی ریست تست **برای همه** فعال (ربات بدون‌درآمد): `wipeUser` = حذف profiles/history_chunks/generations + ریست state (ردیف users می‌ماند).

## env
`BOT_TOKEN`*, `OPENROUTER_API_KEY`*. سقف دانلود فایل ۲۰MB؛ timeout فراخوانی‌ها ۱۰ دقیقه.
