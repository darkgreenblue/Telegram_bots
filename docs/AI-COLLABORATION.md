# AI collaboration log

این فایل handoff مشترک Claude Code و Codex است. هدفش حذف حدس، جلوگیری از تداخل، و باقی‌ماندنِ زمینه‌ی عملیاتی بین سشن‌هاست؛ جایگزین `CLAUDE.md` یا مستندات اختصاصی هر بات نیست.

## قاعدهٔ ثبت

پیش از push هر branch، یک ردیف برای تغییر اضافه یا به‌روزرسانی کن. برای کارِ در حال انجام، همان ابتدا ردیف `In progress` بساز؛ بعد از handoff، نتیجه را در همان ردیف کامل کن. دادهٔ حساس، token، محتوای واقعی کاربر و خروجی `.env` هرگز در این فایل نمی‌آید.

| تاریخ | وضعیت | عامل | branch / commit | محدوده | تغییر و دلیل | تست/اعتبارسنجی | ریسک و rollback | اقدام بعدی |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 2026-09-17 | In progress | Claude Code | `claude/tarot-language-strategy-3lteky` | `bots/tarot` (locale-ctx, reading-core, verdict, chat-core, repair, ganjineh, locale-boot, index)، `tools/check-locale-ctx` و چهار چکِ به‌روزشده، `ci.yml` | زیرساختِ «زبان per کاربر» برای رباتِ واحدِ چندزبانه: AsyncLocalStorage + Proxyِ `L` (۵۵۷ نقطه دست‌نخورده)، ستونِ افزایشیِ `users.lang`، و per-زبان شدنِ جدولِ دانشِ کارت، `langdata`، گاردهای ضعفِ زبانی، حکمِ قاطع، گاردهای گفتگو، گنجینه و مرزِ روز. برچسب‌های `bot.hears` به اتحادِ همه‌ی زبان‌ها رفتند. | `check-locale-ctx` (۳۹ ادعا، ۱۰ جهش) + کلِ سوییتِ چک‌های ریپو سبز (`check-daily-brief` روی main هم قرمز است، dep محلی) + بوتِ واقعی روی دیتابیسِ واقعی (fa) و probeِ چندزبانه‌ی موازی (ru/pt/es) | رباتِ زنده: `LANGS` ست‌نشده = رفتارِ بیت‌به‌بیتِ قبلی، پس فارسی و پرتغالی لمس نمی‌شوند؛ `PRODUCT_VERSION` بامپ نشد چون هیچ رفتارِ رو-به-کاربری عوض نشده. rollback = `git revert` (ستونِ `lang` افزایشی و بی‌ضرر می‌ماند). | PRهای بعدی: locale انگلیسی، انتخابگرِ زبان، دورهای آزمایشگاه، و کات‌اوورِ رباتِ روسی |
| 2026-09-15 | Done | Codex | `feat/voice2text-metis-routing` | `voice2text`، deploy و CI | سوییچ فقط-مالکِ `❌/✅ برای کافه‌بازار` افزوده شد: قرمز/سبز و تمام‌عرض؛ فقط همان فلو را بین OpenRouter و wrapper Gemini متیس جابه‌جا می‌کند. Secret جدید فقط به env همین بات می‌رود. | `node --check`، تست قرارداد Metis، تست نگه‌داشتن style سبز در Telegraf، `check-deploy-env`، `check-undefined`، analytics و support سبز. نصب کامل محلی با Node 26 به‌دلیل native build قدیمی `better-sqlite3` ممکن نیست؛ CI از Node 20 استفاده می‌کند. | بات زنده: مسیر پیش‌فرض بدون تغییر است؛ Metis fallback به OpenRouter ندارد تا هزینه جابه‌جا نشود. rollback = revert PR؛ خاموش‌کردن سوییچ = حذف Secret + deploy. | push، CI، merge در پنجره امن deploy؛ سپس یک تست دستی مالک با ویس کوتاه |
| 2026-09-15 | Done | Codex | `docs/ai-collaboration-protocol` | مستندات ریشه | افزوده‌شدن قرارداد مشترک Claude Code و Codex؛ هیچ کد محصول، schema، secret یا تنظیم deploy تغییر نکرده است. | بازبینی لینک‌های داخلی و وضعیت گیت | ریسک عملیاتی ندارد؛ rollback = revert این commit | push branch، بازکردن PR، و merge پس از review |

## قالب برای ردیف‌های بعدی

`YYYY-MM-DD | In progress/Done/Blocked | Claude Code یا Codex | branch و commit | بات/فایل‌ها | چه چیزی و چرا | دستور و نتیجهٔ تست | ریسک، guardrail و rollback | مالک/عامل بعدی چه کند`

## چک‌لیست handoff

- آیا `git status` تمیز است و branch با remote همگام شده؟
- آیا مستندات لازم (`CLAUDE.md` ریشه و CLAUDE بات) همراه تغییر به‌روز شده‌اند؟
- آیا تست مرتبط اجرا و نتیجه در ردیف ثبت شده است؟
- آیا تغییر روی بات زنده است؟ اگر بله، migration افزایشی، سازگاری callback/پرداخت، `PRODUCT_VERSION`، rollout و rollback را طبق `CLAUDE.md` بررسی کن.
- آیا merge/deploy فقط بعد از CI سبز و طبق پنجره و workflow تعریف‌شده انجام می‌شود؟
