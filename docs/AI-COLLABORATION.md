# AI collaboration log

این فایل handoff مشترک Claude Code و Codex است. هدفش حذف حدس، جلوگیری از تداخل، و باقی‌ماندنِ زمینه‌ی عملیاتی بین سشن‌هاست؛ جایگزین `CLAUDE.md` یا مستندات اختصاصی هر بات نیست.

## قاعدهٔ ثبت

پیش از push هر branch، یک ردیف برای تغییر اضافه یا به‌روزرسانی کن. برای کارِ در حال انجام، همان ابتدا ردیف `In progress` بساز؛ بعد از handoff، نتیجه را در همان ردیف کامل کن. دادهٔ حساس، token، محتوای واقعی کاربر و خروجی `.env` هرگز در این فایل نمی‌آید.

| تاریخ | وضعیت | عامل | branch / commit | محدوده | تغییر و دلیل | تست/اعتبارسنجی | ریسک و rollback | اقدام بعدی |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 2026-09-15 | Done | Codex | `feat/voice2text-metis-routing` | `voice2text`، deploy و CI | سوییچ فقط-مالکِ `❌/✅ برای کافه‌بازار` افزوده شد: قرمز/سبز و تمام‌عرض؛ فقط همان فلو را بین OpenRouter و wrapper Gemini متیس جابه‌جا می‌کند. Secret جدید فقط به env همین بات می‌رود. | `node --check`، تست قرارداد Metis، تست نگه‌داشتن style سبز در Telegraf، `check-deploy-env`، `check-undefined`، analytics و support سبز. نصب کامل محلی با Node 26 به‌دلیل native build قدیمی `better-sqlite3` ممکن نیست؛ CI از Node 20 استفاده می‌کند. | بات زنده: مسیر پیش‌فرض بدون تغییر است؛ Metis fallback به OpenRouter ندارد تا هزینه جابه‌جا نشود. rollback = revert PR؛ خاموش‌کردن سوییچ = حذف Secret + deploy. | push، CI، merge در پنجره امن deploy؛ سپس یک تست دستی مالک با ویس کوتاه |
| 2026-09-18 | In progress | Claude Code | `claude/quirky-maxwell-rh24ox` | `bots/tarot` (گفتگوی پس از فال، فقط-ادمین)، locale هر چهار زبان، `tools/check-chat.mjs` و `check-kb-rev.mjs` | v3.95.0 — هفت موردِ بازخوردِ تستِ دستیِ مالک: دکمه‌ی سؤالِ پیشنهادی از فیلدِ تازه‌ی `follow_up` (با نقلِ‌قولِ سؤال و ادعای اتمیکِ یک‌بارمصرف)، دکمه‌ی «پایان مکالمه» که کیبوردِ ماندگار را هم برمی‌گرداند، بازپخشِ نیت روی گاردِ گفتگو، دکمه‌ی ☰ با `setMyCommands`/`setChatMenuButton`، و سه‌راهیِ نیت در پرامپت (لنگرِ مشروط + دعوتِ ادامه + متنِ فالِ تازه). | `check-chat` ۴۶۲ ادعا با **۲۱ جهشِ تأییدشده**، `check-kb-rev` ۸۰ ادعا، کلِ ۸۵ چکِ CI سبز، بوتِ واقعی روی دیتابیسِ اسکیمای قدیمی (سه ستونِ افزایشی)، `chat-lab --fake` سبز، و تستِ دودِ گاردِ ENV. | فیچر همچنان **فقط-ادمین** است، پس هیچ کاربرِ واقعی نمی‌بیندش. رول‌بک چهار پله‌ی مستقل: `CHAT_FOLLOWUP` / `CHAT_END_BUTTON` / `CHAT_MENU_BUTTON` = false، و `git revert`. ستون‌ها طبق بند ۲ج/۱ می‌مانند. | مرج در پنجره‌ی امنِ ۰۸:۰۰–۰۹:۵۹ تهران، بعد تستِ دستیِ مالک با «ریست حساب (ادمین)» |
| 2026-09-15 | Done | Codex | `docs/ai-collaboration-protocol` | مستندات ریشه | افزوده‌شدن قرارداد مشترک Claude Code و Codex؛ هیچ کد محصول، schema، secret یا تنظیم deploy تغییر نکرده است. | بازبینی لینک‌های داخلی و وضعیت گیت | ریسک عملیاتی ندارد؛ rollback = revert این commit | push branch، بازکردن PR، و merge پس از review |

## قالب برای ردیف‌های بعدی

`YYYY-MM-DD | In progress/Done/Blocked | Claude Code یا Codex | branch و commit | بات/فایل‌ها | چه چیزی و چرا | دستور و نتیجهٔ تست | ریسک، guardrail و rollback | مالک/عامل بعدی چه کند`

## چک‌لیست handoff

- آیا `git status` تمیز است و branch با remote همگام شده؟
- آیا مستندات لازم (`CLAUDE.md` ریشه و CLAUDE بات) همراه تغییر به‌روز شده‌اند؟
- آیا تست مرتبط اجرا و نتیجه در ردیف ثبت شده است؟
- آیا تغییر روی بات زنده است؟ اگر بله، migration افزایشی، سازگاری callback/پرداخت، `PRODUCT_VERSION`، rollout و rollback را طبق `CLAUDE.md` بررسی کن.
- آیا merge/deploy فقط بعد از CI سبز و طبق پنجره و workflow تعریف‌شده انجام می‌شود؟
