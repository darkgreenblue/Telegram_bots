# AI collaboration log

این فایل handoff مشترک Claude Code و Codex است. هدفش حذف حدس، جلوگیری از تداخل، و باقی‌ماندنِ زمینه‌ی عملیاتی بین سشن‌هاست؛ جایگزین `CLAUDE.md` یا مستندات اختصاصی هر بات نیست.

## قاعدهٔ ثبت

پیش از push هر branch، یک ردیف برای تغییر اضافه یا به‌روزرسانی کن. برای کارِ در حال انجام، همان ابتدا ردیف `In progress` بساز؛ بعد از handoff، نتیجه را در همان ردیف کامل کن. دادهٔ حساس، token، محتوای واقعی کاربر و خروجی `.env` هرگز در این فایل نمی‌آید.

| تاریخ | وضعیت | عامل | branch / commit | محدوده | تغییر و دلیل | تست/اعتبارسنجی | ریسک و rollback | اقدام بعدی |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 2026-09-15 | Done | Codex | `docs/ai-collaboration-protocol` | مستندات ریشه | افزوده‌شدن قرارداد مشترک Claude Code و Codex؛ هیچ کد محصول، schema، secret یا تنظیم deploy تغییر نکرده است. | بازبینی لینک‌های داخلی و وضعیت گیت | ریسک عملیاتی ندارد؛ rollback = revert این commit | push branch، بازکردن PR، و merge پس از review |

## قالب برای ردیف‌های بعدی

`YYYY-MM-DD | In progress/Done/Blocked | Claude Code یا Codex | branch و commit | بات/فایل‌ها | چه چیزی و چرا | دستور و نتیجهٔ تست | ریسک، guardrail و rollback | مالک/عامل بعدی چه کند`

## چک‌لیست handoff

- آیا `git status` تمیز است و branch با remote همگام شده؟
- آیا مستندات لازم (`CLAUDE.md` ریشه و CLAUDE بات) همراه تغییر به‌روز شده‌اند؟
- آیا تست مرتبط اجرا و نتیجه در ردیف ثبت شده است؟
- آیا تغییر روی بات زنده است؟ اگر بله، migration افزایشی، سازگاری callback/پرداخت، `PRODUCT_VERSION`، rollout و rollback را طبق `CLAUDE.md` بررسی کن.
- آیا merge/deploy فقط بعد از CI سبز و طبق پنجره و workflow تعریف‌شده انجام می‌شود؟
