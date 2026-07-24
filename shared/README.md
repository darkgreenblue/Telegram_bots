# shared/ — ماژول‌های مشترک ربات‌ها

کد مشترکی که هر ربات با **import نسبی** استفاده می‌کند (بدون npm publish و بدون workspace):

```js
import { log, logErr } from '../../shared/logger.js';
import { createOpenRouter, parseJsonLoose } from '../../shared/llm.js';
import { registerAdminReset, adminResetRow } from '../../shared/reset.js';
import { registerGlobalErrorHandlers } from '../../shared/errors.js';
```

## قوانین (مهم — رعایت نشود ربات‌ها روی سرور می‌شکنند)
1. **هیچ import از پکیج npm در ماژول‌های shared مجاز نیست** (فقط built-in های Node و globalها مثل `fetch`).
   دلیل: resolution پکیج‌ها از `node_modules` کنارِ فایلِ importکننده انجام می‌شود و در ریشه‌ی ریپو `node_modules` وجود ندارد.
2. هر چیزی که به وابستگی نیاز دارد (مثل دیتابیس better-sqlite3 یا instance تلگراف) را **به‌صورت پارامتر بگیر** (dependency injection) — نمونه: `registerAdminReset(bot, { isAdmin, wipe, after })` (دکمه‌ی ریستِ فقط-ادمین).
3. تغییر در `shared/` = دیپلویِ همه‌ی ربات‌ها (deploy.yml این را خودکار تشخیص می‌دهد). پس backward-compatible تغییر بده.
4. **voice2text از shared استفاده نمی‌کند و نباید بکند** (قانون «ربات زنده دست نخورد»). ربات‌های جدید و ربات‌های در حال راه‌اندازی از shared استفاده می‌کنند.

## ماژول‌ها
| فایل | خروجی | شرح |
|------|-------|-----|
| `logger.js` | `ts, log, logErr` | لاگر استاندارد با timestamp — همان قراردادی که pm2 در out/error log نگه می‌دارد |
| `llm.js` | `createOpenRouter, parseJsonLoose` | فراخوانی OpenRouter با timeout + retry + مدل فالبک (الگوی جاافتاده‌ی tarot) |
| `reset.js` | `RESET_TEST_BTN, registerTestReset` | دکمه‌ی «🔄 ریست ربات (تست)» طبق قرارداد بند ۶ب CLAUDE.md |
| `support.js` | `SUPPORT, SUPPORT_CONTACT, SUPPORT_BTN, BOT_CODES, supportRow, registerSupport, supportLink, supportCode, parseSupportCode` | دکمه‌ی «🆘 پشتیبانی» + **تک‌منبعِ حسابِ پشتیبانی**: لینکِ `t.me/<user>?text=` با پیامِ آماده‌ی حاویِ کدِ پیگیریِ `#<BOT>-<user_id>` (بند ۶ج CLAUDE.md). voice2text کپیِ خودکفا و tabir-khab پورتِ `support.py` دارد؛ CI سینک می‌کند (`tools/check-support-sync.mjs`) |
| `errors.js` | `registerGlobalErrorHandlers, makeBotCatch` | bot.catch سراسری + هندلر unhandledRejection/uncaughtException |
| `analytics.js` | `EVENTS, ANALYTICS_SCHEMA_VERSION, ensureAnalytics, track, trackOnce, captureStart, parseStartPayload` | جدول events + اتریبیوشن استارت (first_source write-once + رویداد start برای هر /start)؛ همه fail-safe — voice2text کپی محلی و tabir-khab پورت پایتونی هم‌قرارداد دارند (چک CI سینک می‌کند) |
| `ab.js` | `ensureAb, variant, AB_STATUSES, AB_SCHEMA_VERSION` | موتور A/B: هش قطعی + exposure در ab_exposures (منبع حقیقت sticky)؛ چرخه‌ی draft→running→draining→stopped (drain = خروج نرم، stopped = kill فوری به control)؛ کش ۶۰ثانیه‌ای config؛ هر خطا → control. config توسط داشبورد نوشته می‌شود |

ربات جدید را از روی `bots/_template/` کپی کن — همه‌ی این‌ها از قبل سیم‌کشی شده‌اند.
