# CLAUDE.md — voice2text (ربات زنده و درآمدزا 🔴)

> **قانون طلایی: این ربات هرگز نباید بشکند.** کاربر پولی دارد. هر تغییر باید کمینه و افزایشی باشد؛ refactor بزرگ ممنوع مگر با تصمیم صریح کاربر. این ربات عمداً از `shared/` استفاده **نمی‌کند** — کدش خودکفاست.
> این فایل باید با هر PR که رفتار ربات را عوض می‌کند به‌روز شود (قرارداد «تعریفِ تمام‌شدن» در CLAUDE.md ریشه).

## چیستی
ویس/فایل صوتی → متن با ۵ حالت پردازش (📝 کامل، ✂️ مفید، 📌 خلاصه، 📋 صورت‌جلسه، 🤖 پرامپت هوش مصنوعی) روی مدل‌های Gemini از OpenRouter. «پرامپت هوش مصنوعی» = ویس را که یک درخواست خطاب به AI است، با پرامپت‌اینجینیرینگ ملایم و **حفظ کامل زبان/هدف/جزئیات** به یک پرامپت استاندارد و آماده‌ی کپی‌پیست تبدیل می‌کند (فقط ساختار عوض می‌شود، نه محتوا). کیف‌پول تومانی، شارژ کارت‌به‌کارت با تأیید ادمین، کد تخفیف سگمنت‌محور، whitelist مدل Pro، ارسال به Notion (فقط مالک). Long-polling، تک‌فایل `index.js` (~۲۷۰۰ خط).

## ثابت‌های کلیدی (ابتدای index.js)
- `OWNER_ID = ADMIN_IDS = [100257975]` — مالک: علیرضا اولیا، پشتیبانی `@alireza_oliya`
- کارت: `6219861904145405` (بلوبانک) — `MIN_RECHARGE=50٬000`، `WELCOME_GIFT=10٬000` تومان
- مدل‌ها (`MODEL_CONFIG`): flash-lite «سبک» ۳۰۰ت/دقیقه، flash «حرفه‌ای» ۹۰۰ت/دقیقه (پیش‌فرض)، pro ۳۰۰۰ت/دقیقه (فقط whitelist). فالبک: `openai/gpt-audio-mini` (بعد از ۳ تلاش، تبدیل به mp3 با ffmpeg).
- هزینه = `round(دقیقه × قیمت‌دقیقه)`؛ فقط در موفقیت کسر می‌شود؛ ادمین‌ها رایگان (برآورد USD می‌بینند).
- سقف‌ها: `MAX_CONCURRENT_JOBS=10`، `MAX_ACTIVE_FLOWS=10`، دانلود ۲۰MB، `FLOW_TTL=15min`، `RETRIES=3`، timeout ده دقیقه.
- صورت‌جلسه حداقل با Flash اجرا می‌شود (`MEETING_MIN_MODEL` — باگ flash-lite).

## دیتابیس (`data/bot.db`, WAL)
| جدول | نقش |
|------|-----|
| `users` | balance (تومان)، model انتخابی، پروفایل |
| `usage_log` | هر پردازش: مدل، ثانیه، هزینه، type، success |
| `payments` | شارژها: amount نهایی، original_amount قبل تخفیف، status: pending→waiting_review→approved/rejected، step |
| `discount_codes` | کد، درصد، سقف مبلغ، انقضا، سقف مصرف per user، سگمنت‌ها/لیست کاربر مجاز، آمار |
| `discount_uses` | دفتر مصرف کدها |
| `pro_whitelist` | دسترسی مدل Pro |
| `voice_flows` | چرخه‌ی حیات هر فلو: active/completed/cancelled/expired/failed |
| `events` | آنالیتیکس کمینه (کپی محلی هم‌قرارداد `shared/analytics.js` — پایین) |

## فلوها و state های in-memory
- `sessions` (token→سشن ویس)، `userStates` (فلوی شارژ)، `adminStates` (پنل تخفیف)، `notionStates`, `activeJobs`. ری‌استارت = پاک‌شدن این‌ها (فلوهای وسط کار می‌میرند) — دلیل اصلی دیپلوی انتخابی.
- فلوی ویس: دریافت → گارد فلوهای فعال/سایز/موجودی → طول (native یا ffprobe) → انتخاب نوع پردازش → LLM با retry/فالبک → خروجی (>۴۰۰۰ کاراکتر: پیام تکه‌تکه یا فایل) → کسر هزینه → (مالک: پیشنهاد Notion).
- شارژ: مبلغ → فاکتور با شماره کارت → کد تخفیف اختیاری → رسید (عکس/متن) → ادمین approve/reject. تخفیف ۱۰۰٪ = تأیید خودکار.
- سگمنت‌های تخفیف: all, new(<7d), no_balance, inactive(>30d), loyal(≥5پرداخت), premium, first_charge, high_usage(≥10), low_balance.
- پنل ادمین دکمه‌ای: داشبورد (کاربر/درآمد/موجودی OpenRouter — هشدار زیر $1)، CRUD کد تخفیف، پیام promo قابل‌فوروارد.
- جاروی ۶۰ثانیه‌ای: انقضای فلوهای رهاشده، پاک‌سازی سشن‌های >۲h و notionStates >۱h.

## Notion (فقط OWNER + نیازمند NOTION_TOKEN)
بعد از هر رونویسی موفق: پیشنهاد ارسال → مرور صفحات ریشه/فرزند → عنوان فارسی خودکار (flash-lite) → ساخت صفحه (بلوک‌های ۲۰۰۰کاراکتری، سقف ۱۰۰).

## دیباگ‌پذیری
- `bot.catch` سراسری + `unhandledRejection` (فقط لاگ) + `uncaughtException` (لاگ + exit برای ری‌استارت pm2) — انتهای فایل.
- پیشوندهای قابل‌grep: `❌ GLOBAL`, `❌ UNHANDLED_REJECTION`, `❌ UNCAUGHT_EXCEPTION`, `CreditError`, `RATE_LIMIT`.
- خطاهای کاربرپسند نگاشت‌شده: اعتبار تمام (CreditError، هرگز retry نمی‌شود)، rate-limit، تبدیل، TIMEOUT، شبکه.

## آنالیتیکس کمینه (اتریبیوشن)
- این ربات از shared استفاده نمی‌کند؛ **کپی محلی** هم‌قرارداد `shared/analytics.js` (بلوک `ANALYTICS_SCHEMA_VERSION = 1` بعد از voice_flows در index.js). چک CI (`tools/check-analytics-sync.mjs`) سینک بودن را تضمین می‌کند — تغییر قرارداد در shared باید همین‌جا هم اعمال شود.
- جدول `events` + ستون‌های write-once `users.first_source/first_payload`. `captureStart` در `bot.start` (payload: `c_<code>` کمپین از داشبورد / خالی organic). رویدادهای ثبت‌شده (فقط ثبت — هیچ اثری روی فلو): `start`، `product_delivered` (job موفق)، `payment_approved` (approve ادمین + تخفیف ۱۰۰٪ خودکار)، `payment_rejected`. track fail-safe است (فقط logErr).

## ریست تست (بند ۶ب ریشه)
`RESET_TEST_BTN` **فقط برای OWNER** (کاربر پولی نباید تصادفاً پاک شود): حذف ردیف‌های مالک از ۷ جدول (users, usage_log, payments, discount_uses, pro_whitelist, voice_flows, events) + پاک‌سازی state های in-memory. کدهای تخفیف (discount_codes) پاک نمی‌شوند.

## env
`BOT_TOKEN`*, `OPENROUTER_API_KEY`*, `NOTION_TOKEN` (اختیاری). نیازمند ffmpeg/ffprobe روی سرور.
