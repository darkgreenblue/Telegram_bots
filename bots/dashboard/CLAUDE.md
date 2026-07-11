# CLAUDE.md — dashboard (داشبورد ادمین همه‌ی ربات‌ها 🧠)

> این فایل باید با هر PR که رفتار داشبورد را عوض می‌کند به‌روز شود (قرارداد بند ۲ب ریشه).
> ربات تلگرام نیست؛ یک وب‌اپ SSR است که عمداً زیر `bots/` نشسته تا کل زنجیره‌ی ci/deploy/backup/ops موجود را بدون تغییر ساختاری دوباره استفاده کند (pm2: `dashboard`).

## چیستی و معماری
مغز مدیریتی همه‌ی محصولات: مارکتینگ/اتریبیوشن، پشتیبانی (سرچ + تایم‌لاین کاربر)، مالی، و در PRهای بعدی فانل/کد تخفیف/A-B تست. Node ≥20 ESM + better-sqlite3 + `node:http` خام (بدون فریمورک وب، بدون build step، بدون هیچ منبع خارجی در HTML). فارسی RTL.

**مدل داده — مهم‌ترین قرارداد:**
- هر ربات صاحب DB خودش می‌ماند. داشبورد دیتای ربات‌ها را با **اتصال readonly کوتاه‌عمر per-request** می‌خواند (`lib/bots.js: withDb`) — هیچ تراکنش خواندن بلند، همه‌جا LIMIT (WAL ربات‌ها بلاک نمی‌شود).
- نوشتن در DB ربات فقط برای config (از PR کد تخفیف به بعد) با `withWritableDb` + `assertColumns` (**گارد schema**: قبل از هر INSERT ستون‌های واقعی با مورد انتظار diff می‌شوند؛ mismatch = امتناع با خطای واضح).
- دیتای خود داشبورد در `data/platform.db`: جدول‌های `campaigns` (code یکتای base62 پنج‌حرفی، bot، source، medium، name، notes، is_active)، `settings` (key/value — از جمله `username:<bot>` برای ساخت لینک)، `audit_log` (هر write و هر export CSV). ربات‌ها هرگز platform.db را نمی‌خوانند.
- Backup شبانه خودکار platform.db را هم می‌گیرد (glob `bots/*/data/*.db`)؛ `Ops db-query` با app=`dashboard` هم کار می‌کند.

## امنیت (بازطراحی پس از نقد متخصص‌ها — پایین نیاوردنی)
- سرور فقط روی `127.0.0.1:8787` گوش می‌دهد؛ **هیچ پورت inbound روی سرور باز نمی‌شود**. دسترسی بیرونی فقط از **Cloudflare Tunnel** (سرویس systemd به نام `dash-tunnel` که deploy.yml می‌سازد): با secret اختیاری `CLOUDFLARE_TUNNEL_TOKEN` → named tunnel (آدرس ثابت روی دامنه)؛ بدون آن → quick tunnel رایگان trycloudflare (آدرس بعد از هر ری‌استارت عوض می‌شود؛ deploy آدرس فعلی را به تلگرام مالک می‌فرستد؛ `Ops → tunnel-url` هم همان را چاپ می‌کند).
- ورود: فرم توکن (secret `DASHBOARD_TOKEN`، مقایسه‌ی زمان-ثابت روی hash) → کوکی سشن `HttpOnly + SameSite=Strict` (+`Secure` پشت تونل). سشن‌ها in-memory (ری‌استارت = ورود دوباره — قابل قبول برای تک‌ادمین). **توکن هرگز در URL نمی‌رود.**
- ضد CSRF: هر POST باید `Origin` (یا Referer) هم‌میزبان داشته باشد (`sameOrigin`) — تست با curl نیازمند هدر Origin است.
- rate-limit ورود: ۵ تلاش/دقیقه per IP. همه‌ی write ها و export ها در `audit_log` ثبت و در پایین صفحه‌ی مالی نمایش داده می‌شوند.
- `robots: noindex`؛ هیچ ورودی کاربر در SQL interpolate نمی‌شود (فقط prepared).

## صفحات
| مسیر | چیست |
|------|------|
| `/` | نمای کلی per ربات: کاربر/جدید/DAU/WAU (از events)، درآمد امروز/۳۰روز/کل (per پروفایلِ مالی، **مرز روز = تهران**، ریال tabir به تومان و پرداخت تستی حذف)، صف رسید معلق، حجم DB+WAL + ویجت رویدادهای خارج از واژه‌نامه |
| `/marketing` | ساخت لینک کمپین (`t.me/<bot>?start=c_<code>`) + جدول کمپین‌ها با قیف تا-درآمد (استارت کل / کاربر جدید first-touch / **کلیک برگشتی** / first_value / پی‌وال / خریدار+درآمد) + مقایسه‌ی چنل‌ها (کمپین/رفرال/ارگانیک از `users.first_source`) + فرم یوزرنیم ربات‌ها |
| `/support` | سرچ id/username در همه‌ی instance ها (id مرجع است؛ username فقط hint) → پروفایل (همه‌ی ستون‌های users بجز session_json) + **تایم‌لاین معکوس** merge شده: events + payments + readings (tarot) + usage_log/voice_flows (voice2text) + generations (resume-tailor) |
| `/finance` | پرداخت‌های همه‌ی ربات‌ها با فیلتر ربات/وضعیت/بازه + جمع per وضعیت + CSV (با ثبت در audit) + جدول audit_log + **راهنمای معنی وضعیت‌ها** + **دکمه‌ی تأیید/رد رسید** (فقط روی رسیدِ «منتظر تأیید» ربات‌های `receiptQueue`): داشبورد پول را دست نمی‌زند، اقدام را در جدول `admin_actions` خود ربات enqueue می‌کند (`financeAction`؛ گارد: فقط رسیدِ pending، ضد دوبار enqueue) و sweepِ ۶۰ثانیه‌ایِ ربات با منطق واقعی (اعتبار + پیام به کاربر) اجرا می‌کند؛ تا اجرا، ستون اقدام «در صف» را نشان می‌دهد |
| `/experiments` | چرخه‌ی کامل A/B (بالا در CLAUDE.md ریشه، بند ۲الف): ساخت (کلید باید در کد ربات با `variant()` پیاده شده باشد) → شروع → drain/kill → تصمیم+آرشیو. نتایج: exposures/تبدیل/lift/CTW بیزی (Monte Carlo قطعی، `lib/stats.js`) + بازه‌ی ۹۵٪ + چک SRM + گاردریل‌ها + فانل per variant + برچسب‌های «کم‌نمونه» و «شواهد ضعیف switchover» و هشدار همپوشانی کمپین |
| `/retention` | مثلث ریتنشن هفتگی per ربات (کوهورت = هفته‌ی ورود؛ فعالیت از events؛ هفته‌های شنبه‌محور تهران) + lifecycle (فعال/جدید/خفته) |
| `/journal` | ژورنال محصول: `product_versions` + `insights` (با لینک به آزمایش) در platform.db |
| `/funnels` | per ربات: **قیف رویدادی** (کاربر یکتا per مرحله، ٪ نسبت به مرحله‌ی اول، دراپ نسبت به قبلی) با breakdown چنل (همه/ارگانیک/رفرال/کمپین) + **فیلتر «کوهورت نسخه»** (فقط کاربرانی که با یک `PRODUCT_VERSION` مشخص وارد شده‌اند — `users.first_version`؛ مقایسه‌ی قبل/بعدِ انتشار) + قیف شارژ + نقطه‌ی رها کردن شارژ (payments.step روی ناتمام‌ها) + **توزیع وضعیت رکوردهای قطعی** (readings/voice_flows — بدون بایاس snapshot؛ شامل کاربران قبل از آنالیتیکس؛ فیلتر نسخه رویشان اعمال نمی‌شود). هیچ عددی از `users.state` ساخته نمی‌شود. تعریف قیف‌ها: `routes/funnels.js` (`FUNNELS`) |
| `/discounts` | ساخت/غیرفعال‌سازی کد تخفیف با **درج مستقیم در `discount_codes` خود ربات** (validate خود ربات‌ها دست‌نخورده): tarot با `only_user_id`؛ voice2text با سگمنت‌ها (`V2T_SEGMENTS` — آینه‌ی SEGMENTS خود ربات) و `allowed_user_ids` (عدد یا یوزرنیم lowercase). کد uppercase ذخیره می‌شود؛ `created_by=0` = ساخته‌ی داشبورد. بدون سگمنت/کاربر → خودکار `all` (قاعده‌ی v2t: خالی = هیچ‌کس). هر write با `assertColumns` گارد می‌شود + آمار مصرف از `discount_uses` |

نکته‌ی تحلیلی: «درآمد» = `SUM(amount)` یعنی پول واقعاً پرداخت‌شده بعد از تخفیف (همان قرارداد /stats خود ربات‌ها)؛ `original_amount` مبلغ شارژ کیف‌پول است.

## instance ها و «پروفایل schema» (مهم‌ترین قرارداد افزودن ربات)
هر فایل db یک instance است: `voice2text:bot.db`، `tarot:bot-fa.db` (per locale)، `tabir-khab:tabir_telegram.db` و بقیه‌ی فایل‌های per زبان. رجیستری در `lib/bots.js` (`BOTS`). id ها هرگز مستقیم به مسیر تبدیل نمی‌شوند (ضد path traversal).

**هیچ route ای مقدار schema را hardcode نمی‌کند** — همه از پروفایلِ هر ربات می‌آید تا افزودن ربات = یک ردیف رجیستری باشد:
| فیلد پروفایل | چیست | پیش‌فرض |
|------|------|--------|
| `userPk` | ستون کلید کاربر | `telegram_id` (tabir: `user_id`) |
| `userNameCol` | ستون نام نمایشی (پشتیبانی) | `name` (tabir: `first_name`) |
| `userCreatedKind` | فرمت `users.created_at` | `unix` (tabir: `iso`) |
| `money` | `{table, amountCol, successStatus, pendingStatus, unit, createdKind, testFilter}` | `MONEY_WALLET` (payments/amount/approved/waiting_review/تومان/unix). tabir: transactions/amount_rial/paid/pending/ریال/iso/حذفِ charge_id تستی |
| `dataDir` + `envDir` | مسیر db (نسبی یا مطلقِ سرور + env override) | نسبی `../<name>/data`؛ tabir مطلق `/home/ubuntu/tabir_khab` + `TABIR_DB_DIR` |
| `idFromFile` | برچسب instance از نام فایل (locale/platform) | — |
| `abSupport` | ربات `variant()` را صدا می‌زند؟ (فقط این‌ها در صفحه‌ی تست‌ها) | false (tarot: true) |
| `receiptQueue` | ربات جدول `admin_actions` + sweep دارد؟ (دکمه‌ی تأیید/رد رسید از داشبورد فعال) | false (voice2text/tarot: true) |

helperها: `userPk`, `userNameCol`, `userCreatedExpr`, `moneyOf`, `unixOf`, `toToman` (ریال→تومان برای نمایش یکنواخت)، `revenueWhere`, `abSupported`, `receiptQueueSupported`. جدول `events` همه‌جا یکسان است (created_at همیشه unix) → کوئری events هرگز پروفایل نمی‌خواهد. راهنمای کامل: بند ۵ CLAUDE.md ریشه.

## env
`DASHBOARD_TOKEN`* (توکن ورود — همان Secret)، `PORT` (پیش‌فرض 8787). Secrets مرتبط دیپلوی: `DASHBOARD_TOKEN`*, `CLOUDFLARE_TUNNEL_TOKEN` (اختیاری)، `OWNER_TELEGRAM_ID` (گیرنده‌ی آدرس تونل).

## تست لوکال
```
cd bots/dashboard && npm install
DASHBOARD_TOKEN=test PORT=8790 node index.js
# لاگین: curl -c cj -X POST -H "Origin: http://127.0.0.1:8790" -d 'token=test' http://127.0.0.1:8790/login
```
فیکسچر دیتا: جدول‌های ربات را در `bots/<bot>/data/` بساز (شبیه تست‌های PR) — داشبورد فقط می‌خواند.
