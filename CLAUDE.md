# CLAUDE.md — راهنمای کامل ریپو برای سشن‌های Claude Code

> این فایل را در شروع هر سشن کامل بخوان. هدف: بدون توضیح دوباره‌ی کاربر، کل معماری، محدودیت‌ها و گردش‌کار را بدانی و بتوانی با **کمترین دخالت کاربر** تغییرات را خودت جلو ببری.

## ۱) این ریپو چیست
مونوریپوی **ربات‌های تلگرام**. هر ربات در `bots/<name>/` مستقل است: `index.js` (ESM, Node ≥ 20)، `package.json`، `.env` و دیتابیس `data/` جداگانه. هدف: افزودن آسانِ محصولات جدید با معماری و مدیریت کلیدِ **یکپارچه**، و اندازه‌گیری مستقل هزینه‌ی هر ربات (توکن تلگرام و کلید OpenRouter جدا).

## ۲) ربات‌های فعلی
| پوشه | پروسه‌ی pm2 | شرح | حساسیت |
|------|-----------|-----|--------|
| `bots/voice2text` | `voice2text` | ویس→متن (Gemini از OpenRouter)، کیف‌پول/پرداخت، SQLite، long-polling | **زنده و درآمدزا — هرگز نباید بشکند** |
| `bots/resume-tailor` | `resume-tailor` | ساخت رزومه‌ی استاندارد انگلیسیِ کاستومایز برای هر آگهی شغلی | در حال راه‌اندازی |

مدل‌ها (همه از طریق **OpenRouter**): ویس→متن = `google/gemini-2.5-flash`؛ کارهای دقیق (تولید رزومه) = `google/gemini-2.5-pro`.

## ۳) زیرساخت استقرار (مهم)
- **VPS:** host `185.204.171.170`، کاربر `ubuntu`، مسیر کلون `~/voice2text` (نامش تاریخی است؛ همین مونوریپوست). اجرا با **PM2**، Node 20.
- **CD:** `.github/workflows/deploy.yml` روی هر push به `main` → با `appleboy/ssh-action` و سکرت **`VPS_SSH_KEY`** به VPS وصل می‌شود → `git pull` → مهاجرت → ساخت `.env`ها از Secrets → `pm2 startOrReload ecosystem.config.cjs`.
- **`ecosystem.config.cjs`** (ریشه): همه‌ی ربات‌ها را با `cwd` مخصوص خودشان تعریف می‌کند، پس هر کدام `.env` و `data/` خودش را از پوشه‌ی خودش می‌خواند.
- **CI:** `.github/workflows/ci.yml` با build-matrix هر ربات را جدا `npm ci` + `node --check` می‌کند.
- کاربر **به VPS دسترسی SSH ندارد** (فقط کلیدِ CI مجاز است). یعنی **هر تغییر سروری فقط از مسیر کامیت→merge→deploy انجام می‌شود.** خودت با کامیت روی برنچ و mer, deploy را پیش ببر.

## ۴) مدیریت کلیدها — تک‌منبعِ حقیقت = GitHub Secrets
دیپلوی، فایل `bots/<name>/.env` را روی سرور از روی Secrets می‌سازد. قرارداد نام‌گذاری:
- `<BOT>_BOT_TOKEN` و `<BOT>_OPENROUTER_KEY` (و اختیاری مثل `<BOT>_NOTION_TOKEN`).

Secretهای فعلی/موردانتظار (در `Settings → Secrets and variables → Actions`):
| Secret | کاربرد |
|--------|--------|
| `VPS_SSH_KEY` | کلید SSH برای اتصال CD به سرور (از قبل موجود) |
| `RESUME_TAILOR_BOT_TOKEN` | توکن تلگرام resume-tailor |
| `RESUME_TAILOR_OPENROUTER_KEY` | کلید OpenRouter resume-tailor |
| `VOICE2TEXT_BOT_TOKEN` *(اختیاری)* | برای یکپارچه‌کردن voice2text؛ تا ست نشود، از `.env` روی سرور استفاده می‌شود |
| `VOICE2TEXT_OPENROUTER_KEY` *(اختیاری)* | همان |
| `VOICE2TEXT_NOTION_TOKEN` *(اختیاری)* | NOTION_TOKEN ربات voice2text |

**قاعده‌ی غیرمخرب:** deploy فقط وقتی توکنِ یک ربات در Secrets ست شده باشد `.env` آن را می‌نویسد؛ در غیر این صورت `.env` موجود روی سرور دست‌نخورده می‌ماند. به همین دلیل voice2text تا قبل از ست‌شدن secretهایش دقیقاً مثل قبل کار می‌کند.

> تاریخچه: کلیدهای voice2text در اصل **در GitHub نبودند** و دستی در `~/voice2text/.env` روی سرور قرار داشتند. معماری جدید این را به Secrets منتقل می‌کند (به‌صورت اختیاری و بدون‌شکست).

**از کجا مقدارِ هر Secret را برداریم:**
- `*_BOT_TOKEN`: از [@BotFather](https://t.me/BotFather) → `/mybots` → ربات موردنظر → API Token (همان توکنِ زنده).
- `*_OPENROUTER_KEY`: داشبورد OpenRouter (`openrouter.ai/keys`). کلیدها فقط یک‌بار نمایش داده می‌شوند؛ اگر کلید قبلی ذخیره نشده، یک کلیدِ نو (با اعتبار) بساز — ربات بعد از deploy به آن سوییچ می‌کند.
- `VOICE2TEXT_NOTION_TOKEN` *(اختیاری)*: فقط اگر قابلیتِ «ارسال به Notion» استفاده می‌شود. **هشدار:** چون materialize فایل `.env` را بازنویسی می‌کند، اگر این قابلیت فعال است و این secret را نگذاری، بعد از یکپارچه‌سازی غیرفعال می‌شود. دیپلوی قبل از اولین بازنویسی یک `bots/voice2text/.env.bak` می‌سازد تا قابل بازگردانی باشد.

## ۴ب) بررسی سلامت بعد از deploy و rollback
بعد از merge، نتیجه‌ی workflowِ `Deploy` را در GitHub Actions ببین (لاگ SSH خطوط `✅ <bot> دیپلوی شد` را چاپ می‌کند). چون به VPS دسترسی نداری، برای تأیید نهایی از کاربر بخواه:
- `pm2 ls` → هر دو ربات `online`.
- `pm2 logs voice2text --lines 50` → بدون کرش‌لوپ.
- یک تست واقعیِ voice2text (ارسال ویس) و یک `/start` روی resume-tailor.

**Rollback اگر voice2text بعد از یکپارچه‌سازی مشکل گرفت:** مقادیر درست را در Secrets اصلاح کن و یک کامیت خالی به `main` بزن (دیپلوی دوباره اجرا می‌شود). فایلِ `bots/voice2text/.env.bak` روی سرور نسخه‌ی دستیِ قبلی را نگه داشته (برای مقایسه/بازگردانی). برای rollbackِ کد: `git revert` کامیتِ مشکل‌دار و merge.

## ۵) افزودن یک ربات جدید (چک‌لیست کمینه)
1. `bots/<name>/` با `index.js` (ESM)، `package.json` و `package-lock.json` و `.env.example` بساز.
2. در `ecosystem.config.cjs` یک اپ اضافه کن: `{ name: '<name>', cwd: 'bots/<name>', script: 'index.js' }`.
3. در `.github/workflows/ci.yml` نام را به ماتریس `bot:` اضافه کن.
4. در `.github/workflows/deploy.yml`: دو خط `env:` (`<NAME>_BOT_TOKEN`, `<NAME>_OPENROUTER_KEY`)، اضافه‌کردنشان به `envs:`، یک بلوک materialize، و یک `deploy_bot <name>`.
5. کاربر فقط دو Secret را در رابط وب گیت‌هاب می‌سازد. بقیه با merge خودکار است.

## ۶) محدودیت‌ها و نکات حیاتی
- **voice2text نباید بشکند.** تنها نقطه‌ی حساس، اولین دیپلویِ مهاجرت است (root→`bots/voice2text`). امن شده: قبل از `mv data` پروسه `pm2 stop` می‌شود، بعد `delete` و استارت از `cwd` جدید. مهاجرت ایدمپوتنت است.
- بعد از هر دیپلویِ حساس، با کاربر چک کن: `pm2 ls` هر دو `online`، و یک تست واقعی voice2text.
- secretها هرگز در گیت/کامیت/چت نروند. `.env`، `data/`، `node_modules/` در `.gitignore` هستند.

## ۶ب) دکمه‌ی «ریست تست» (قرارداد فاز تست — همه‌ی ربات‌ها)
در فاز تست، هر ربات یک دکمه‌ی persistent در reply-keyboard با متن **`🔄 ریست ربات (تست)`** دارد که با زدنش، داده‌های کاربر کاملاً پاک می‌شود (انگار کاربر جدید آمده). پیاده‌سازی با `bot.hears(RESET_TEST_BTN, ...)`.
- **رباتِ تست/بدون‌درآمد** (مثل resume-tailor): برای همه‌ی کاربران فعال است؛ همه‌ی جدول‌های کاربرـمحورِ آن ربات برای آن کاربر پاک می‌شوند (تابع `wipeUser`).
- **رباتِ زنده/درآمدزا** (مثل voice2text): این دکمه و عملکردش **فقط برای `OWNER_ID`** است (تا کاربرِ پولی تصادفاً کیف‌پول/تاریخچه‌اش را پاک نکند). فقط ردیف‌های خودِ مالک از جدول‌ها (`users, usage_log, payments, discount_uses, pro_whitelist, voice_flows`) و stateهای in-memory پاک می‌شوند.
- هنگام افزودن ربات جدید، همین دکمه را اضافه کن (با همین متن و قاعده‌ی owner-only روی ربات‌های دارای پول).
- جمع‌بندیِ پایان فاز تست: این دکمه باید قبل از انتشار نهایی حذف یا پشت یک فلگ غیرفعال شود.

## ۷) گردش‌کار توسعه
- روی برنچ feature کار کن (الگوی `claude/...`)، PR بده، بعد از سبزشدن CI به `main` merge کن تا deploy اجرا شود.
- `بات‌های ریزِ بعدی` هم در همین ریپو زیر `bots/` می‌آیند.
