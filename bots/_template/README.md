# _template — اسکلت ربات جدید

**این یک ربات واقعی نیست** — در `ecosystem.config.cjs`، ماتریس CI و deploy.yml ثبت نشده و روی سرور اجرا نمی‌شود.

## ساخت ربات جدید از روی این قالب
1. `cp -r bots/_template bots/<name>` و حذف این README (یک README واقعی بنویس).
2. در فایل‌ها `<NAME>`/`tg-NAME` را جایگزین کن؛ `npm install` بزن تا `package-lock.json` ساخته شود (برای CI لازم است).
3. یک `bots/<name>/CLAUDE.md` بساز (طبق الگوی ربات‌های دیگر).
4. چک‌لیست بند ۵ CLAUDE.md ریشه را کامل کن (ecosystem, ci.yml, deploy.yml, دو Secret).

قالب از قبل شامل: قرارداد لاگ/`bot.catch`/هندلرهای خطای پروسه (بند ۸)، دکمه‌ی ریست تست (بند ۶ب)،
دکمه‌ی «🆘 پشتیبانی» (بند ۶ج — فقط کافی است یک ردیف در `BOT_CODES` در `shared/support.js` اضافه کنی و همان کد را به `registerSupport` بدهی)،
فراخوانی مقاوم OpenRouter با فالبک، SQLite جدا در `data/`، launch با retry، و **زیرساخت رشد از قبل سیم‌کشی‌شده**
(`ensureAnalytics`+`ensureAb`، `captureStart` در /start، `wipeUser` که events/ab_exposures را هم پاک می‌کند) — همه از `shared/`.

**برای اتصال به داشبورد** (اتریبیوشن/فانل/A-B/مالی/پشتیبانی): بند ۵ CLAUDE.md ریشه را کامل کن — خلاصه:
۱) track ها را با ثابت‌های `EVENTS` در نقاط فانل بگذار (کامنت راهنما ته index.js هست)،
۲) یک ردیف به `BOTS` در `bots/dashboard/lib/bots.js` اضافه کن (اگر قرارداد پیش‌فرض را رعایت کنی مینیمال است)،
۳) یک entry فانل در `bots/dashboard/routes/funnels.js`. اگر پول داری، جدول `payments` استاندارد بساز تا مالی خودکار کار کند.

**قبل از طراحی و حین ساخت، بندهای ۹ (اصول فنی)، ۱۰ (اصول محصولی) و ۱۱ (سؤالات اجباری) CLAUDE.md ریشه را رعایت کن** — جوابِ سؤالات بند ۱۱ را در CLAUDE.md خود ربات ثبت کن.
