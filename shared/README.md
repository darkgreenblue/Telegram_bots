# shared/ — ماژول‌های مشترک ربات‌ها

کد مشترکی که هر ربات با **import نسبی** استفاده می‌کند (بدون npm publish و بدون workspace):

```js
import { log, logErr } from '../../shared/logger.js';
import { createOpenRouter, parseJsonLoose } from '../../shared/llm.js';
import { RESET_TEST_BTN, registerTestReset } from '../../shared/reset.js';
import { registerGlobalErrorHandlers } from '../../shared/errors.js';
```

## قوانین (مهم — رعایت نشود ربات‌ها روی سرور می‌شکنند)
1. **هیچ import از پکیج npm در ماژول‌های shared مجاز نیست** (فقط built-in های Node و globalها مثل `fetch`).
   دلیل: resolution پکیج‌ها از `node_modules` کنارِ فایلِ importکننده انجام می‌شود و در ریشه‌ی ریپو `node_modules` وجود ندارد.
2. هر چیزی که به وابستگی نیاز دارد (مثل دیتابیس better-sqlite3 یا instance تلگراف) را **به‌صورت پارامتر بگیر** (dependency injection) — نمونه: `registerTestReset(bot, {...})`.
3. تغییر در `shared/` = دیپلویِ همه‌ی ربات‌ها (deploy.yml این را خودکار تشخیص می‌دهد). پس backward-compatible تغییر بده.
4. **voice2text از shared استفاده نمی‌کند و نباید بکند** (قانون «ربات زنده دست نخورد»). ربات‌های جدید و ربات‌های در حال راه‌اندازی از shared استفاده می‌کنند.

## ماژول‌ها
| فایل | خروجی | شرح |
|------|-------|-----|
| `logger.js` | `ts, log, logErr` | لاگر استاندارد با timestamp — همان قراردادی که pm2 در out/error log نگه می‌دارد |
| `llm.js` | `createOpenRouter, parseJsonLoose` | فراخوانی OpenRouter با timeout + retry + مدل فالبک (الگوی جاافتاده‌ی tarot) |
| `reset.js` | `RESET_TEST_BTN, registerTestReset` | دکمه‌ی «🔄 ریست ربات (تست)» طبق قرارداد بند ۶ب CLAUDE.md |
| `errors.js` | `registerGlobalErrorHandlers, makeBotCatch` | bot.catch سراسری + هندلر unhandledRejection/uncaughtException |

ربات جدید را از روی `bots/_template/` کپی کن — همه‌ی این‌ها از قبل سیم‌کشی شده‌اند.
