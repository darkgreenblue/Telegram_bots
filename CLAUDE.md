# CLAUDE.md — راهنمای کامل ریپو برای سشن‌های Claude Code

> این فایل را در شروع هر سشن کامل بخوان. هدف: بدون توضیح دوباره‌ی کاربر، کل معماری، محدودیت‌ها و گردش‌کار را بدانی و بتوانی با **کمترین دخالت کاربر** تغییرات را خودت جلو ببری.

## ۱) این ریپو چیست
مونوریپوی **ربات‌های تلگرام**. هر ربات در `bots/<name>/` مستقل است: `index.js` (ESM, Node ≥ 20)، `package.json`، `.env` و دیتابیس `data/` جداگانه. هدف: افزودن آسانِ محصولات جدید با معماری و مدیریت کلیدِ **یکپارچه**، و اندازه‌گیری مستقل هزینه‌ی هر ربات (توکن تلگرام و کلید OpenRouter جدا).

## ۲) ربات‌های فعلی
| پوشه | پروسه‌ی pm2 | شرح | حساسیت |
|------|-----------|-----|--------|
| `bots/voice2text` | `voice2text` | ویس→متن (Gemini از OpenRouter)، کیف‌پول/پرداخت، SQLite، long-polling | **زنده و درآمدزا — هرگز نباید بشکند** |
| `bots/resume-tailor` | `resume-tailor` | ساخت رزومه‌ی استاندارد انگلیسیِ کاستومایز برای هر آگهی شغلی | در حال راه‌اندازی |
| `bots/tarot` | `tarot` | فال تاروت فارسی — بازسازی سفر مشتری تاروت‌خوان حرفه‌ای؛ کیف‌پول + کارت‌به‌کارت، رفرال، milestone | در حال راه‌اندازی |
| `bots/tabir-khab` | — (systemd: `tabir-khab`) | تعبیر خواب (بله + تلگرام، پایتون) — **استثنای مونوریپو**: Python/venv/systemd، نه Node/pm2. جزئیات در `bots/tabir-khab/CLAUDE.md` | در حال تست شخصی — روی سرور زنده است |

مدل‌ها (همه از طریق **OpenRouter**): ویس→متن = `google/gemini-2.5-flash`؛ کارهای دقیق (تولید رزومه) = `google/gemini-2.5-pro`؛ مغز فال تاروت = `google/gemini-2.5-flash`.

نکته‌ی tarot: چندزبانه‌ی آماده — همه‌ی متن‌ها/پرامپت‌ها در `bots/tarot/locales/<LOCALE>.js`؛ هر زبان بعداً یک اپ pm2 جدا از همان پوشه با `ENV_FILE` و `LOCALE` خودش (دیتابیس جدا: `data/bot-<LOCALE>.db`). تصاویر ۷۹گانه‌ی دک RWS (public domain) در `assets/cards/` کامیت شده‌اند.

## ۳) زیرساخت استقرار (مهم)
- **VPS:** host `185.204.171.170`، کاربر `ubuntu`، مسیر کلون `~/voice2text` (نامش تاریخی است؛ همین مونوریپوست). اجرا با **PM2**، Node 20.
- **CD:** `.github/workflows/deploy.yml` روی هر push به `main` → با `appleboy/ssh-action` و سکرت **`VPS_SSH_KEY`** به VPS وصل می‌شود → `git pull` → مهاجرت → ساخت `.env`ها از Secrets → `pm2 startOrReload ecosystem.config.cjs`.
- **`ecosystem.config.cjs`** (ریشه): همه‌ی ربات‌ها را با `cwd` مخصوص خودشان تعریف می‌کند، پس هر کدام `.env` و `data/` خودش را از پوشه‌ی خودش می‌خواند.
- **CI:** `.github/workflows/ci.yml` با build-matrix هر ربات را جدا `npm ci` + `node --check` می‌کند.
- کاربر **به VPS دسترسی SSH ندارد** (فقط کلیدِ CI مجاز است). یعنی **هر تغییر سروری فقط از مسیر کامیت→merge→deploy انجام می‌شود.** خودت با کامیت روی برنچ و mer, deploy را پیش ببر.

### ۳ب) استثنای tabir-khab (پایتون + systemd — نه pm2)
- **کد** در `bots/tabir-khab/` است ولی **روی سرور** در مسیر تاریخی خودش می‌ماند: `/home/ubuntu/tabir_khab` (همان VPS، venv و `.env` و دیتابیس‌های SQLite و `logs/` مخصوص خودش)، با سرویسِ systemd به نام `tabir-khab` (نه pm2/ecosystem).
- **دیپلوی:** جابِ `deploy-tabir-khab` در همان `deploy.yml` — کدِ `bots/tabir-khab` را با `git archive | tar -x` روی مسیرِ سرور overlay می‌کند (فایل‌های runtime مثل `.env`/db/logs/venv دست نمی‌خورند؛ فایل‌های *حذف‌شده* از ریپو هم از سرور پاک نمی‌شوند — اگر فایلی را حذف/تغییرنام دادی و مهم بود، حذفش را در اسکریپت دیپلوی یک‌باره اضافه کن) و بعد `sudo systemctl restart tabir-khab`.
- **کلیدها:** `.env` این ربات (BALE_BOT_TOKEN، TELEGRAM_BOT_TOKEN، OPENROUTER_API_KEY، GAPGPT_API_KEY و…) دستی روی سرور است و دیپلوی به آن دست نمی‌زند — از قاعده‌ی materialize از Secrets پیروی نمی‌کند (فعلاً عمداً؛ برای یکپارچه‌سازی بعداً می‌شود secrets اضافه کرد).
- **دیباگ:** چون خارج از pm2 است، `Ops`/`Health` آن را نمی‌بینند. به‌جایش: workflowِ `Tabir-khab logs` (وضعیت systemd + tail لاگ) و `Tabir-khab report` (داشبورد کاربر/درآمد) را dispatch کن و خروجی را از لاگ جاب بخوان.
- **CI:** جاب `check-tabir-khab` در `ci.yml` (setup-python + pip install + compileall).
- ریپوی قدیمیِ `darkgreenblue/tabir-khab` فقط آرشیو است؛ deploy آن غیرفعال شده — **توسعه فقط اینجا.** راهنمای کاملِ خودِ ربات: `bots/tabir-khab/CLAUDE.md`.

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
| `TAROT_BOT_TOKEN` | توکن تلگرام tarot (از BotFather؛ روی همین ربات `/setinline` هم فعال شود — لازمه‌ی دکمه‌ی دعوت) |
| `TAROT_OPENROUTER_KEY` | کلید OpenRouter ربات tarot |

**قاعده‌ی غیرمخرب:** deploy فقط وقتی توکنِ یک ربات در Secrets ست شده باشد `.env` آن را می‌نویسد؛ در غیر این صورت `.env` موجود روی سرور دست‌نخورده می‌ماند. به همین دلیل voice2text تا قبل از ست‌شدن secretهایش دقیقاً مثل قبل کار می‌کند.

> تاریخچه: کلیدهای voice2text در اصل **در GitHub نبودند** و دستی در `~/voice2text/.env` روی سرور قرار داشتند. معماری جدید این را به Secrets منتقل می‌کند (به‌صورت اختیاری و بدون‌شکست).

**از کجا مقدارِ هر Secret را برداریم:**
- `*_BOT_TOKEN`: از [@BotFather](https://t.me/BotFather) → `/mybots` → ربات موردنظر → API Token (همان توکنِ زنده).
- `*_OPENROUTER_KEY`: داشبورد OpenRouter (`openrouter.ai/keys`). کلیدها فقط یک‌بار نمایش داده می‌شوند؛ اگر کلید قبلی ذخیره نشده، یک کلیدِ نو (با اعتبار) بساز — ربات بعد از deploy به آن سوییچ می‌کند.
- `VOICE2TEXT_NOTION_TOKEN` *(اختیاری)*: فقط اگر قابلیتِ «ارسال به Notion» استفاده می‌شود. **هشدار:** چون materialize فایل `.env` را بازنویسی می‌کند، اگر این قابلیت فعال است و این secret را نگذاری، بعد از یکپارچه‌سازی غیرفعال می‌شود. دیپلوی قبل از اولین بازنویسی یک `bots/voice2text/.env.bak` می‌سازد تا قابل بازگردانی باشد.

## ۴ب) بررسی سلامت بعد از deploy و rollback
بعد از merge، نتیجه‌ی workflowِ `Deploy` را در GitHub Actions ببین (لاگ SSH خطوط `✅ <bot> دیپلوی شد` را چاپ می‌کند). چون به VPS دسترسی نداری، برای تأیید نهایی از کاربر بخواه:
- `pm2 ls` → هر سه ربات (`voice2text`, `resume-tailor`, `tarot`) روی `online`.
- `pm2 logs voice2text --lines 50` → بدون کرش‌لوپ.
- یک تست واقعیِ voice2text (ارسال ویس)، یک `/start` روی resume-tailor، و یک `/start` + کارت روز روی tarot.

**Rollback اگر voice2text بعد از یکپارچه‌سازی مشکل گرفت:** مقادیر درست را در Secrets اصلاح کن و یک کامیت خالی به `main` بزن (دیپلوی دوباره اجرا می‌شود). فایلِ `bots/voice2text/.env.bak` روی سرور نسخه‌ی دستیِ قبلی را نگه داشته (برای مقایسه/بازگردانی). برای rollbackِ کد: `git revert` کامیتِ مشکل‌دار و merge.

## ۵) افزودن یک ربات جدید (چک‌لیست کمینه)
1. `bots/<name>/` با `index.js` (ESM)، `package.json` و `package-lock.json` و `.env.example` بساز.
2. در `ecosystem.config.cjs` یک اپ اضافه کن: `{ name: '<name>', cwd: 'bots/<name>', script: 'index.js' }`.
3. در `.github/workflows/ci.yml` نام را به ماتریس `bot:` اضافه کن.
4. در `.github/workflows/deploy.yml`: دو خط `env:` (`<NAME>_BOT_TOKEN`, `<NAME>_OPENROUTER_KEY`)، اضافه‌کردنشان به `envs:`، یک بلوک materialize، و یک `deploy_bot <name>`.
5. کاربر فقط دو Secret را در رابط وب گیت‌هاب می‌سازد. بقیه با merge خودکار است.

## ۶) محدودیت‌ها و نکات حیاتی
- **voice2text نباید بشکند.** تنها نقطه‌ی حساس، اولین دیپلویِ مهاجرت است (root→`bots/voice2text`). امن شده: قبل از `mv data` پروسه `pm2 stop` می‌شود، بعد `delete` و استارت از `cwd` جدید. مهاجرت ایدمپوتنت است.
- بعد از هر دیپلویِ حساس، با کاربر چک کن: `pm2 ls` همه‌ی ربات‌ها `online`، و یک تست واقعی voice2text.
- secretها هرگز در گیت/کامیت/چت نروند. `.env`، `data/`، `node_modules/` در `.gitignore` هستند.

## ۶ب) دکمه‌ی «ریست تست» (قرارداد فاز تست — همه‌ی ربات‌ها)
در فاز تست، هر ربات یک دکمه‌ی persistent در reply-keyboard با متن **`🔄 ریست ربات (تست)`** دارد که با زدنش، داده‌های کاربر کاملاً پاک می‌شود (انگار کاربر جدید آمده). پیاده‌سازی با `bot.hears(RESET_TEST_BTN, ...)`.
- **رباتِ تست/بدون‌درآمد** (مثل resume-tailor): برای همه‌ی کاربران فعال است؛ همه‌ی جدول‌های کاربرـمحورِ آن ربات برای آن کاربر پاک می‌شوند (تابع `wipeUser`).
- **رباتِ زنده/درآمدزا** (مثل voice2text): این دکمه و عملکردش **فقط برای `OWNER_ID`** است (تا کاربرِ پولی تصادفاً کیف‌پول/تاریخچه‌اش را پاک نکند). فقط ردیف‌های خودِ مالک از جدول‌ها (`users, usage_log, payments, discount_uses, pro_whitelist, voice_flows`) و stateهای in-memory پاک می‌شوند.
- هنگام افزودن ربات جدید، همین دکمه را اضافه کن (با همین متن و قاعده‌ی owner-only روی ربات‌های دارای پول).
- جمع‌بندیِ پایان فاز تست: این دکمه باید قبل از انتشار نهایی حذف یا پشت یک فلگ غیرفعال شود.

## ۷) گردش‌کار توسعه
- روی برنچ feature کار کن (الگوی `claude/...`)، PR بده، بعد از سبزشدن CI به `main` merge کن تا deploy اجرا شود.
- **merge را خودت انجام بده** (از طریق GitHub MCP: خروج از draft + merge). کاربر فقط Secretها را می‌سازد؛ هیچ مرحله‌ی دستیِ دیگری از او نخواه.
- `بات‌های ریزِ بعدی` هم در همین ریپو زیر `bots/` می‌آیند.

## ۸) سیستم دیباگ و مانیتورینگ (برای همه‌ی ربات‌ها — همیشه از همین استفاده کن)
چون به VPS دسترسی SSH نداری، دو workflow این دسترسی را از داخل هر سشن فراهم می‌کنند. **وقتی کاربر گفت «فلان ربات مشکل دارد» (حتی با یک جمله)، بدون سؤال اضافه همین مسیر را برو:**

### دیباگ on-demand: workflow `Ops` (`.github/workflows/ops.yml`)
1. با GitHub MCP اجرا کن: `actions_run_trigger` روی `ops.yml` (ref=`main`) با inputs:
   - `action`: یکی از `status` (وضعیت pm2 همه)، `logs` (out+error)، `errors` (فقط error)، `restart`، `env-check` (وجود .envها، بدون محتوا)
   - `app`: نام اپ pm2 (مثل `tarot`) — برای logs/errors/restart لازم است
   - `lines`: تعداد خطوط (پیش‌فرض ۱۰۰)
2. چند ثانیه صبر کن، run جدید را با `actions_list` پیدا کن و خروجی را با `get_job_logs` (job همان run) بخوان — خروجی دستورها مستقیم در لاگ جاب چاپ می‌شود.
3. تشخیص → فیکس → commit → PR → merge → رصد Deploy → دوباره با `Ops` (status/logs) صحت را تأیید کن. **کل حلقه بدون دخالت کاربر.**

### پایش خودکار: workflow `Health` (`.github/workflows/health.yml`)
- هر ۳۰ دقیقه خودکار اجرا می‌شود: هر رباتی که `online` نباشد یا در کرش‌لوپ باشد (uptime<۱۰min و restart>۵) → جاب قرمز + چاپ error-log همان ربات در لاگ + ساخت/آپدیت یک GitHub Issue با عنوان «🚨 Health check failed».
- در شروع هر سشن اگر کار مرتبط با ربات‌ها داری، یک نگاه به Issueهای باز با این عنوان بینداز؛ اگر بود، خودش شامل لینک run با لاگ خطاست — همان را دیباگ کن.

### قرارداد کدنویسی برای دیباگ‌پذیری (هر ربات جدید)
- **`bot.catch` سراسری الزامی است**: هر خطای هندل‌نشده باید (۱) با `logErr` و stack کامل لاگ شود و (۲) یک پیام عذرخواهی عمومی به کاربر بدهد. هرگز نباید فلو «بی‌صدا» بمیرد (نمونه: `bots/tarot/index.js`).
- لاگ‌ها همان stdout/stderr هستند که pm2 در `~/.pm2/logs/<app>-{out,error}.log` نگه می‌دارد — منبع حقیقتِ دیباگ همین است؛ لاگر جدا نساز.
- خطاهای عملیاتی مهم (شکست LLM، refund، شکست پرداخت) را با پیشوند ثابت و قابل‌grep لاگ کن.
