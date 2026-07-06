# CLAUDE.md — راهنمای کامل ریپو برای سشن‌های Claude Code

> این فایل را در شروع هر سشن کامل بخوان. هدف: بدون توضیح دوباره‌ی کاربر، کل معماری، محدودیت‌ها و گردش‌کار را بدانی و بتوانی با **کمترین دخالت کاربر** تغییرات را خودت جلو ببری.
> این فایل فقط **قراردادهای مشترک پلتفرم** را دارد؛ جزئیات هر ربات در `bots/<name>/CLAUDE.md` خودش است (وقتی روی آن ربات کار می‌کنی خوانده می‌شود).

## ۱) این ریپو چیست
مونوریپوی **ربات‌های تلگرام**. هر ربات در `bots/<name>/` مستقل است: `index.js` (ESM, Node ≥ 20)، `package.json`، `.env` و دیتابیس `data/` جداگانه. هدف: افزودن آسانِ محصولات جدید با معماری و مدیریت کلیدِ **یکپارچه**، و اندازه‌گیری مستقل هزینه‌ی هر ربات (توکن تلگرام و کلید OpenRouter جدا).

کد مشترک در `shared/` است (logger، فراخوانی مقاوم OpenRouter، دکمه‌ی ریست تست، هندلرهای خطای سراسری) با import نسبی — قوانینش در `shared/README.md`. ربات جدید از روی `bots/_template/` ساخته می‌شود.

## ۲) ربات‌های فعلی
| پوشه | پروسه | شرح | حساسیت | جزئیات |
|------|-------|-----|--------|--------|
| `bots/voice2text` | pm2: `voice2text` | ویس→متن، کیف‌پول/پرداخت | **زنده و درآمدزا — هرگز نباید بشکند؛ از shared استفاده نمی‌کند** | `bots/voice2text/CLAUDE.md` |
| `bots/resume-tailor` | pm2: `resume-tailor` | رزومه‌ی انگلیسی کاستومایز per آگهی | فاز تست | `bots/resume-tailor/CLAUDE.md` |
| `bots/tarot` | pm2: `tarot` | فال تاروت فارسی، کیف‌پول + کارت‌به‌کارت | فاز تست | `bots/tarot/CLAUDE.md` |
| `bots/tabir-khab` | systemd: `tabir-khab` | تعبیر خواب (بله + تلگرام، پایتون) — **استثنای مونوریپو**: Python/venv/systemd، نه Node/pm2 | در حال تست شخصی — روی سرور زنده است | `bots/tabir-khab/CLAUDE.md` |

مدل‌ها (همه از **OpenRouter**): پیش‌فرض `google/gemini-2.5-flash`؛ کارهای دقیق `google/gemini-2.5-pro`؛ فالبک ارزان `deepseek/deepseek-v3.2`.

## ۲ب) قرارداد «تعریفِ تمام‌شدن» (ضد گم‌شدن کانتکست)
هر PR که **رفتار** یک ربات را عوض می‌کند (قیمت، فلو، جدول DB، پرامپت، دستور ادمین، env جدید) باید `bots/<name>/CLAUDE.md` همان ربات را هم به‌روز کند. تغییرات پلتفرمی (workflow، shared، قرارداد کلیدها) باید همین فایل ریشه را به‌روز کنند. PR بدون آپدیت مستندات = ناقص.

## ۳) زیرساخت استقرار
- **VPS:** host `185.204.171.170`، کاربر `ubuntu`، مسیر کلون `~/voice2text` (نام تاریخی؛ همین مونوریپوست). اجرا با **PM2**، Node 20.
- **`ecosystem.config.cjs`** (ریشه): هر ربات با `cwd` خودش → `.env` و `data/` جدا.
- **CI** (`ci.yml`): per ربات (matrix) → `npm ci` + `node --check` + **تست دود boot** (اجرای واقعی تا گارد ENV — import های shared هم resolve می‌شوند).
- **CD** (`deploy.yml`): روی push به `main` با SSH (سکرت `VPS_SSH_KEY`) → `git pull` → ساخت `.env`ها از Secrets → **دیپلوی انتخابی**: فقط رباتی reload می‌شود که کدش (`bots/<name>/` بجز `.md`)، `.env`اش، یا زیرساخت مشترک (ecosystem/`shared/`/خود deploy.yml) تغییر کرده باشد یا در pm2 نباشد. یعنی merge مربوط به یک ربات، ربات‌های دیگر (خصوصاً voice2text) را ری‌استارت نمی‌کند.
- **دیپلوی اجباری همه:** اجرای دستی workflow `Deploy` با input `force_all=true` (از GitHub MCP: `actions_run_trigger`).
- کاربر **به VPS دسترسی SSH ندارد** (فقط کلید CI). هر تغییر سروری فقط از مسیر کامیت→merge→deploy. خودت با کامیت روی برنچ و merge، deploy را پیش ببر.

### ۳ب) استثنای tabir-khab (پایتون + systemd — نه pm2)
- **کد** در `bots/tabir-khab/` است ولی **روی سرور** در مسیر تاریخی خودش می‌ماند: `/home/ubuntu/tabir_khab` (همان VPS، venv و `.env` و دیتابیس‌های SQLite و `logs/` مخصوص خودش)، با سرویسِ systemd به نام `tabir-khab` (نه pm2/ecosystem).
- **دیپلوی:** جابِ `deploy-tabir-khab` در همان `deploy.yml` — **انتخابی** (فقط وقتی `bots/tabir-khab/` تغییر کرده یا force_all): کد را با `git archive | tar -x` روی مسیر سرور overlay می‌کند (فایل‌های runtime مثل `.env`/db/logs/venv دست نمی‌خورند؛ فایل‌های *حذف‌شده* از ریپو هم از سرور پاک نمی‌شوند — اگر حذف مهم بود، در اسکریپت دیپلوی یک‌باره اضافه کن) و بعد `sudo systemctl restart tabir-khab`.
- **کلیدها:** `.env` این ربات (BALE_BOT_TOKEN، TELEGRAM_BOT_TOKEN، OPENROUTER_API_KEY، GAPGPT_API_KEY و…) دستی روی سرور است و دیپلوی به آن دست نمی‌زند — از قاعده‌ی materialize از Secrets پیروی نمی‌کند (فعلاً عمداً).
- **دیباگ:** چون خارج از pm2 است، `Ops` آن را نمی‌بیند — به‌جایش workflowِ `Tabir-khab logs` (وضعیت systemd + tail لاگ) و `Tabir-khab report` (داشبورد کاربر/درآمد) را dispatch کن. **`Health` آن را هم پایش می‌کند** (چک systemd + tail لاگ در خرابی). **بکاپ:** workflow `Backup` دیتابیس‌های آن را هم می‌گیرد (snapshot پایتونی از `/home/ubuntu/tabir_khab/*.db`).
- **CI:** جاب `check-tabir-khab` در `ci.yml` (setup-python + pip install + compileall).
- ریپوی قدیمیِ `darkgreenblue/tabir-khab` فقط آرشیو است — **توسعه فقط اینجا.** راهنمای کامل: `bots/tabir-khab/CLAUDE.md`.

## ۴) مدیریت کلیدها — تک‌منبع حقیقت = GitHub Secrets
دیپلوی، `bots/<name>/.env` را روی سرور از Secrets می‌سازد (فقط اگر توکن آن ربات ست باشد؛ وگرنه `.env` موجود دست‌نخورده می‌ماند — voice2text تا ست‌نشدن secretهایش مثل قبل کار می‌کند؛ بکاپ یک‌باره: `.env.bak`).

| Secret | کاربرد |
|--------|--------|
| `VPS_SSH_KEY` | اتصال CI/CD به سرور (موجود) |
| `<BOT>_BOT_TOKEN` / `<BOT>_OPENROUTER_KEY` | per ربات: `VOICE2TEXT_*` (اختیاری)، `RESUME_TAILOR_*`، `TAROT_*` |
| `VOICE2TEXT_NOTION_TOKEN` | اختیاری — قابلیت Notion |
| `OWNER_TELEGRAM_ID` | **اختیاری ولی مهم**: آی‌دی عددی تلگرام مالک → هشدار تلگرامی خرابی Health/Deploy/Backup |
| `BACKUP_PASSPHRASE` | اختیاری: رمزنگاری بکاپ شبانه‌ی دیتابیس‌ها |

منبع مقادیر: `*_BOT_TOKEN` از [@BotFather](https://t.me/BotFather)؛ `*_OPENROUTER_KEY` از `openrouter.ai/keys` (فقط یک‌بار نمایش داده می‌شود — در صورت گم‌شدن کلید نو بساز). نکته‌ی tarot: روی BotFather برای این ربات `/setinline` فعال شود (لازمه‌ی دکمه‌ی دعوت).

## ۴ب) سلامت بعد از deploy و rollback
بعد از merge، نتیجه‌ی workflow `Deploy` را ببین (لاگ خطوط `✅ <bot> دیپلوی شد (دلیل: ...)` و `⏭ <bot> بدون تغییر` دارد). بعد با workflow `Ops` (action=`status`) صحت را خودت تأیید کن. برای تست واقعی محصول (ارسال ویس، /start و…) از کاربر بخواه.
**Rollback کد:** `git revert` کامیت مشکل‌دار → merge. **Rollback کلید:** Secret را اصلاح کن → اجرای `Deploy` با `force_all=true` (نیازی به کامیت خالی نیست؛ `bots/voice2text/.env.bak` روی سرور نسخه‌ی دستی قدیمی را دارد). **Rollback دیتابیس:** بند ۸ب.

## ۵) افزودن ربات جدید (چک‌لیست)
1. `cp -r bots/_template bots/<name>` → طبق `bots/_template/README.md` کامل کن (`npm install` برای lockfile، `CLAUDE.md` مخصوص ربات).
2. `ecosystem.config.cjs`: `{ name: '<name>', cwd: 'bots/<name>', script: 'index.js' }`.
3. `ci.yml`: نام به ماتریس `bot:`.
4. `deploy.yml`: دو خط `env:`، افزودن نام‌ها به `envs:`، یک بلوک `write_env <name>` و یک `deploy_bot <name>`.
5. کاربر فقط دو Secret می‌سازد (`<NAME>_BOT_TOKEN`, `<NAME>_OPENROUTER_KEY`). بقیه با merge خودکار است.

## ۶) محدودیت‌ها و نکات حیاتی
- **voice2text نباید بشکند** — تغییراتش کمینه و افزایشی؛ refactor فقط با تصمیم صریح کاربر؛ از `shared/` استفاده نمی‌کند (خودکفاست).
- تغییر `shared/` = ری‌دیپلوی همه‌ی ربات‌ها → backward-compatible تغییر بده. ماژول‌های shared حق import از npm ندارند (`shared/README.md`).
- secretها هرگز در گیت/کامیت/چت نروند. `.env`، `data/`، `node_modules/` در `.gitignore` هستند.
- بعد از هر دیپلوی حساس: `Ops status` بزن؛ برای تست محصولی از کاربر کمک بخواه.

## ۶ب) دکمه‌ی «ریست تست» (قرارداد فاز تست)
هر ربات در فاز تست دکمه‌ی persistent با متن `🔄 ریست ربات (تست)` دارد (پیاده‌سازی مشترک: `shared/reset.js`؛ voice2text نسخه‌ی inline خودش را دارد). ربات بدون‌درآمد: برای همه فعال؛ ربات درآمدزا (voice2text): **فقط OWNER_ID** (کاربر پولی تصادفاً کیف‌پولش را پاک نکند). تابع wipe باید همه‌ی جدول‌های کاربرمحور همان ربات را پاک کند. پایان فاز تست: `TEST_PHASE=false` (دکمه مخفی؛ `/reset` برای مالک می‌ماند).

## ۷) گردش‌کار توسعه
- برنچ feature (الگوی `claude/...`) → PR → سبزشدن CI → **merge را خودت انجام بده** (GitHub MCP: خروج از draft + merge). کاربر فقط Secret می‌سازد؛ هیچ مرحله‌ی دستی دیگری از او نخواه.
- قرارداد «تعریفِ تمام‌شدن» (بند ۲ب) در هر PR رعایت شود.
- ربات‌های بعدی هم در همین ریپو زیر `bots/` می‌آیند.

## ۸) سیستم دیباگ و مانیتورینگ (همیشه از همین استفاده کن)
کاربر SSH ندارد؛ این workflow ها دسترسی را از داخل هر سشن می‌دهند. **وقتی کاربر گفت «فلان ربات مشکل دارد» (حتی یک جمله)، بدون سؤال اضافه همین مسیر را برو:**

### دیباگ on-demand: workflow `Ops` (`.github/workflows/ops.yml`)
1. GitHub MCP → `actions_run_trigger` روی `ops.yml` (ref=`main`) با inputs:
   - `action`: `status` (وضعیت pm2 همه + چک pm2-startup برای reboot سرور) | `logs` (out+error) | `errors` | `restart` | `env-check` (وجود .envها بدون محتوا) | **`db-query`**
   - `app`: نام اپ pm2 (برای logs/errors/restart/db-query)؛ `lines`: تعداد خطوط (پیش‌فرض ۱۰۰)
   - `query`: برای db-query — SQL **فقط-خواندنی** روی SQLite همان ربات (اتصال readonly؛ حداکثر ۲۰۰ ردیف چاپ می‌شود). سؤال‌های دیتابیسی کاربر («چند نفر خریدند؟»، «موجودی فلان کاربر؟») را از همین راه سریع جواب بده.
2. چند ثانیه صبر کن، run جدید را با `actions_list` پیدا و خروجی را با `get_job_logs` بخوان (خروجی دستورها مستقیم در لاگ جاب است).
3. تشخیص → فیکس → commit → PR → merge → رصد Deploy → دوباره `Ops` برای تأیید. **کل حلقه بدون دخالت کاربر.**

### پایش خودکار: workflow `Health` (`.github/workflows/health.yml`)
هر ۳۰ دقیقه: هر ربات pm2 غیر-`online` یا در کرش‌لوپ (uptime<۱۰min و restart>۵) + سرویس systemd ربات tabir-khab → جاب قرمز + چاپ error-log همان ربات + ساخت/آپدیت Issue «🚨 Health check failed» + **پیام تلگرام مستقیم به مالک** (اگر `OWNER_TELEGRAM_ID` ست باشد). در شروع هر سشن مرتبط با ربات‌ها، Issueهای باز با این عنوان را چک کن — لینک run با لاگ خطا داخلش است.

### قرارداد کدنویسی برای دیباگ‌پذیری (هر ربات)
- **`bot.catch` سراسری الزامی** + هندلرهای `unhandledRejection` (فقط لاگ — کرش یعنی مرگ همه‌ی فلوهای در جریان) و `uncaughtException` (لاگ stack + exit تا pm2 ری‌استارت کند). پیاده‌سازی آماده: `shared/errors.js`. هرگز فلو «بی‌صدا» نمیرد.
- لاگ = stdout/stderr که pm2 در `~/.pm2/logs/<app>-{out,error}.log` نگه می‌دارد — منبع حقیقت دیباگ؛ لاگر جدا نساز.
- خطاهای عملیاتی مهم با پیشوند ثابت قابل‌grep: `❌ GLOBAL`، `❌ UNHANDLED_REJECTION`، `❌ UNCAUGHT_EXCEPTION`، `REFUND path`.

## ۸ب) بکاپ دیتابیس‌ها: workflow `Backup` (`.github/workflows/backup.yml`)
- هر شب خودکار (+ dispatch دستی): snapshot سازگار همه‌ی `bots/*/data/*.db` با online-backup API خود better-sqlite3 (امن حین اجرا، WAL پوشش داده می‌شود) + دیتابیس‌های tabir-khab با sqlite3 پایتون → artifact در Actions با نگه‌داری ۳۰ روز؛ اگر `BACKUP_PASSPHRASE` ست باشد رمز می‌شود. شکست بکاپ → پیام تلگرام به مالک + جاب قرمز.
- **بازگردانی:** از صفحه‌ی run در Actions فایل `db-backup-*.tar.gz(.gpg)` را دانلود کن (رمز: `gpg -d`). جایگزینی روی سرور نیاز به دسترسی فایل دارد؛ مسیر بدون SSH: فایل ‌db را موقتاً در ریپو کامیت کن + یک اسکریپت مهاجرت یک‌باره در deploy (بعد از restore حتماً از تاریخچه پاک شود چون داده‌ی کاربران است) — یا در سناریوی فاجعه، بازسازی سرور با همین ریپو + آخرین بکاپ. قبل از هر restore، `pm2 stop <bot>` (از طریق Ops).
