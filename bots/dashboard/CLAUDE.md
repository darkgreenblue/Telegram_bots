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
| `/` | نمای کلی per ربات: کاربر/جدید/DAU/WAU (از events)، درآمد امروز/۳۰روز/کل (payments approved، **مرز روز = تهران** با `tehranDayStart`)، صف رسید waiting_review، حجم DB+WAL |
| `/marketing` | ساخت لینک کمپین (`t.me/<bot>?start=c_<code>`) + جدول کمپین‌ها با قیف تا-درآمد (استارت کل / کاربر جدید first-touch / **کلیک برگشتی** / first_value / پی‌وال / خریدار+درآمد) + مقایسه‌ی چنل‌ها (کمپین/رفرال/ارگانیک از `users.first_source`) + فرم یوزرنیم ربات‌ها |
| `/support` | سرچ id/username در همه‌ی instance ها (id مرجع است؛ username فقط hint) → پروفایل (همه‌ی ستون‌های users بجز session_json) + **تایم‌لاین معکوس** merge شده: events + payments + readings (tarot) + usage_log/voice_flows (voice2text) + generations (resume-tailor) |
| `/finance` | پرداخت‌های همه‌ی ربات‌ها با فیلتر ربات/وضعیت/بازه + جمع per وضعیت + CSV (با ثبت در audit) + جدول audit_log |
| `/funnels`, `/discounts` | placeholder — PR بعدی |

نکته‌ی تحلیلی: «درآمد» = `SUM(amount)` یعنی پول واقعاً پرداخت‌شده بعد از تخفیف (همان قرارداد /stats خود ربات‌ها)؛ `original_amount` مبلغ شارژ کیف‌پول است.

## instance ها
هر فایل db یک instance است: `voice2text:bot.db`، `tarot:bot-fa.db` (per locale)، `resume-tailor:bot.db`. رجیستری در `lib/bots.js` (`BOTS`) — ربات جدید = یک خط آن‌جا. id ها هرگز مستقیم به مسیر تبدیل نمی‌شوند (ضد path traversal). tabir-khab فاز بعد (`TABIR_DB_GLOB`).

## env
`DASHBOARD_TOKEN`* (توکن ورود — همان Secret)، `PORT` (پیش‌فرض 8787). Secrets مرتبط دیپلوی: `DASHBOARD_TOKEN`*, `CLOUDFLARE_TUNNEL_TOKEN` (اختیاری)، `OWNER_TELEGRAM_ID` (گیرنده‌ی آدرس تونل).

## تست لوکال
```
cd bots/dashboard && npm install
DASHBOARD_TOKEN=test PORT=8790 node index.js
# لاگین: curl -c cj -X POST -H "Origin: http://127.0.0.1:8790" -d 'token=test' http://127.0.0.1:8790/login
```
فیکسچر دیتا: جدول‌های ربات را در `bots/<bot>/data/` بساز (شبیه تست‌های PR) — داشبورد فقط می‌خواند.
