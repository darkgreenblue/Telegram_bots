# CLAUDE.md — voice2text (ربات زنده و درآمدزا 🔴)

> **قانون طلایی: این ربات هرگز نباید بشکند.** کاربر پولی دارد. هر تغییر باید کمینه و افزایشی باشد؛ refactor بزرگ ممنوع مگر با تصمیم صریح کاربر. این ربات عمداً از `shared/` استفاده **نمی‌کند** — کدش خودکفاست.
> این فایل باید با هر PR که رفتار ربات را عوض می‌کند به‌روز شود (قرارداد «تعریفِ تمام‌شدن» در CLAUDE.md ریشه).

## چیستی
ویس/فایل صوتی → متن با ۵ حالت پردازش (📝 کامل، ✂️ مفید، 📌 خلاصه، 📋 صورت‌جلسه، 🤖 پرامپت هوش مصنوعی) روی مدل‌های Gemini از OpenRouter. «پرامپت هوش مصنوعی» = ویس را که یک درخواست خطاب به AI است، با پرامپت‌اینجینیرینگ ملایم و **حفظ کامل زبان/هدف/جزئیات** به یک پرامپت استاندارد و آماده‌ی کپی‌پیست تبدیل می‌کند (فقط ساختار عوض می‌شود، نه محتوا). کیف‌پول تومانی، شارژ کارت‌به‌کارت با تأیید ادمین، کد تخفیف سگمنت‌محور، whitelist مدل Pro، ارسال به Notion (فقط مالک). Long-polling، تک‌فایل `index.js` (~۲۷۰۰ خط).

## ثابت‌های کلیدی (ابتدای index.js)
- `ADMIN_IDS` از env (`process.env.ADMIN_IDS`، کامای چند آی‌دی که deploy از `OWNER_TELEGRAM_ID` upsert می‌کند؛ پیش‌فرض `100257975`)؛ `OWNER_ID = ADMIN_IDS[0]` (کارهای مخرب مثل ریست فقط مالک). قرارداد یکپارچه‌ی همه‌ی ربات‌ها. پشتیبانی `@alireza_oliya`
- کارت: `6219861904145405` (بلوبانک) — `MIN_RECHARGE=50٬000`، `WELCOME_GIFT=10٬000` تومان
- `RECHARGE_PRESETS = [50k, 100k, 200k, 500k]` — دکمه‌های مبلغ پیش‌فرض شارژ (+ «مبلغ دیگر»). پارس مبلغ مقاوم است: جداکننده/تومان/ارقام فارسی حذف و فقط رقم‌ها می‌مانند.
- مدل‌ها (`MODEL_CONFIG`): flash-lite «سبک» ۳۰۰ت/دقیقه، flash «حرفه‌ای» ۹۰۰ت/دقیقه (پیش‌فرض)، pro ۳۰۰۰ت/دقیقه (فقط whitelist). فالبک: `openai/gpt-audio-mini` (بعد از ۳ تلاش، تبدیل به mp3 با ffmpeg).
- هزینه = `round(دقیقه × قیمت‌دقیقه)`؛ فقط در موفقیت کسر می‌شود؛ ادمین‌ها رایگان (برآورد USD می‌بینند).
- سقف‌ها: `MAX_CONCURRENT_JOBS=10`، `MAX_ACTIVE_FLOWS=10`، دانلود ۲۰MB، `FLOW_TTL=15min`، `RETRIES=3`، timeout ده دقیقه.
- صورت‌جلسه حداقل با Flash اجرا می‌شود (`MEETING_MIN_MODEL` — باگ flash-lite).

## دیتابیس (`data/bot.db`, WAL)
| جدول | نقش |
|------|-----|
| `users` | balance (تومان)، model انتخابی، پروفایل |
| `usage_log` | هر پردازش: مدل، ثانیه، هزینه، type، success |
| `payments` | شارژها: amount نهایی، original_amount قبل تخفیف، status: pending→waiting_review→approved/rejected (و `reversed` در برگشتِ رسیدِ فیک)، step |
| `discount_codes` | کد، درصد، سقف مبلغ، انقضا، سقف مصرف per user، سگمنت‌ها/لیست کاربر مجاز، آمار |
| `discount_uses` | دفتر مصرف کدها |
| `pro_whitelist` | دسترسی مدل Pro |
| `voice_flows` | چرخه‌ی حیات هر فلو: active/completed/cancelled/expired/failed + `reserved` (مبلغِ رزروشده برای refund در ری‌استارت) |
| `admin_actions` | صف تأیید/رد رسید که **داشبورد** enqueue می‌کند؛ sweep ربات با منطق واقعی درین می‌کند (payment_id, action, source, done_at) |
| `events` | آنالیتیکس کمینه (کپی محلی هم‌قرارداد `shared/analytics.js` — پایین) |

`payments.reminded_at`: آخرین یادآوریِ رسیدِ معطل به ادمین (برای throttle یادآوری دوره‌ای). `users.pay_distrust`: کاربرِ بی‌اعتماد بعد از برگشتِ رسیدِ فیک (ایجنت دیگر برایش خودکار تصمیم نمی‌گیرد).

## ایجنتِ رسیدِ کارت‌به‌کارت + auto-approve + برگشت/بی‌اعتمادی (`cardpay.js` — کپیِ محلی، خودکفا)
`cardpay.js` دوقلوی نودیِ `bots/tabir-khab/cardpay/agent.py` است (همان قرارداد؛ کپیِ محلی چون این ربات از `shared/` استفاده نمی‌کند و برای ایزوله‌ماندنِ دیپلوی). هر رسید (عکس/متن) اول از `processReceipt` رد می‌شود که `analyzeReceipt` (Gemini Flash از OpenRouter، `RECEIPT_MODEL='google/gemini-2.5-flash'`) را صدا می‌زند:
- **approve** → `approvePaymentAuto` (گذارِ اتمیکِ `finalizeFromOpen` از pending، همان منطقِ پولِ `approvePaymentDb` + دفترِ تخفیف، در `db.transaction`) + پیام به کاربر + اطلاع به ادمین با دکمه‌ی «🚫 پیامکش نیومده».
- **reject** با `reason_code=not_a_receipt` → فقط راهنمایی و پرداخت باز می‌ماند (خطای کاربر، نه شکستِ پرداخت)؛ سایرِ reject → `rejectPaymentAuto` + پیام با دلیل + یادداشت به ادمین.
- **review** → مسیرِ قدیمیِ `sendReceiptToAdmin` (تصمیمِ انسانی با دکمه‌های approve/reject).
- fail-safe: هر خطای دانلود/شبکه/JSON → review (هرگز auto approve/reject در خطا).
- **توابعِ سنّتیِ `approvePaymentDb`/`rejectPaymentDb` دست‌نخورده‌اند** (فقط waiting_review؛ برای callbackِ ادمین و صفِ داشبورد). مسیرِ auto جدا و اتمیک است.
- **تجربه‌ی انسانی + گاردِ مبلغ (نسخه 1.1.1):** کاربر نباید حسِ دخالتِ AI بگیرد. فلو: پیامِ اولِ انسانی («فیشت رسید، برای بررسی و تأیید فرستاده شد») → **تأخیرِ تصادفیِ ۳ تا ۱۰ ثانیه** (`sleep`) → نتیجه. هیچ «دارم بررسی می‌کنم» نمی‌رود. **گاردِ قطعیِ مبلغ (`decideReceipt`):** ردِ اشتباهِ «مبلغ کم» وقتی پرداختی ≥ موردانتظار → override به approve + یادداشتِ overpay به ادمین (اگر ≥۱۰٪ بیشتر). کلِ `processReceipt` در try/catch است (شبکه‌ی ایمنیِ نهایی → sendReceiptToAdmin) تا کاربر بی‌جواب و پول در هوا نماند؛ ردِ ایجنت هم حتماً به کاربر اطلاع می‌دهد.
- **فقط دو پیامِ نهایی به کاربر (نسخه 1.1.2 — قاعده‌ی سراسریِ ماژول):** بعد از فیش، کاربر همیشه فقط یکی از دو پیام می‌گیرد: تأیید (`notifyApproved`) یا `REJECT_MSG` (رد یکپارچه، بدونِ دلیل، پیگیری با `SUPPORT_CONTACT=@Efficient_Support`). فقط approve و reject (مبلغِ اکیداً کمتر) خودکارند؛ `not_a_receipt`/بی‌کیفیت/مشکوک → `sendReceiptToAdmin`. پیامِ «فیش نبود» حذف شد؛ ردِ ادمین (`notifyRejected`) هم همان `REJECT_MSG` را می‌دهد.
- **قاعده‌ی سراسری: دکمه‌ی «📋 کپی شماره کارت»** (`cardCopyRow()`، Telegram `copy_text`) زیرِ همه‌ی فاکتورهای کارت‌به‌کارت (`applyRechargeAmount` + مسیرهای ثبت/حذفِ کد تخفیف).

**کلیدِ خاموشیِ `RECEIPT_AI_AUTO_APPROVE`** (env، پیش‌فرض روشن): خاموش → همه‌ی رسیدها دستی به ادمین. **کاربرِ بی‌اعتماد** (`pay_distrust=1`) هم همیشه دستی می‌رود. Rollback فوری بدونِ دیپلوی: Secret `RECEIPT_AI_AUTO_APPROVE=false` + `Deploy force_all`.

**شبکه‌ی ایمنیِ برگشت (رسیدِ فیک):** روی هر پرداختِ auto-approveشده دکمه‌ی «🚫 پیامکش نیومده» → تأیید دوم (`cardsms` با یادآوریِ چکِ اپِ بانکی) → `cardrev` = `reversePayment`: گذارِ اتمیکِ `approved→reversed` (ضدِ دوبار)، کسرِ اعتبارِ ناشی از این پرداخت با `clawback` (کفِ صفر؛ مصرف‌شده اشکالی ندارد؛ voice2text بدونِ هدیه‌ی شارژ)، `pay_distrust=1`، پیام به کاربر و ادمین. `cardrevno` = انصراف. رویداد `payment_reversed` (props: payment_id/amount/clawed).

## فلوها و state های in-memory
- `sessions` (token→سشن ویس)، `userStates` (فلوی شارژ)، `adminStates` (پنل تخفیف)، `notionStates`, `activeJobs`. ری‌استارت = پاک‌شدن این‌ها (فلوهای وسط کار می‌میرند) — دلیل اصلی دیپلوی انتخابی.
- فلوی ویس: دریافت → گارد فلوهای فعال/سایز/موجودی → طول (native یا ffprobe) → انتخاب نوع پردازش → **رزرو اتمیکِ هزینه** (`deductIf` با `WHERE balance>=cost` در شروع job، نه بعد از موفقیت — ضد مصرفِ رایگانِ چند فلوی هم‌زمان) → LLM با retry/فالبک → خروجی (>۴۰۰۰ کاراکتر: پیام تکه‌تکه یا فایل). شکستِ LLM = **refund کامل رزرو**؛ ری‌استارتِ وسطِ کار = `recoverOrphanFlows` در بوت رزروِ یتیم را برمی‌گرداند. کال‌بک‌های فلو (ptype/switchflow/setmodelflow/output) مالکیت `session.userId` را چک می‌کنند (ضد اکسپلویت گروه). → (مالک: پیشنهاد Notion).
- **بازیابیِ رسید:** هندلر photo اگر state حافظه‌ای گم شده باشد (ری‌استارت/`/start` بعد از فاکتور)، پرداختِ `pending` با `step='receipt'` (پنجره‌ی ۳ روز) را از DB بازیابی و رسید را به همان وصل می‌کند (وگرنه فیش در سیاه‌چاله می‌افتاد). «انصراف» روی رسیدِ `waiting_review` رد می‌شود (لغو دروغین قبلاً پول را معلق می‌گذاشت).
- شارژ: مبلغ → فاکتور با شماره کارت → کد تخفیف اختیاری → رسید (عکس/متن) → **ایجنتِ رسید (auto-approve/reject/review؛ بخشِ «ایجنتِ رسید» بالا)**. تخفیف ۱۰۰٪ = تأیید خودکار.
- سگمنت‌های تخفیف: all, new(<7d), no_balance, inactive(>30d), loyal(≥5پرداخت), premium, first_charge, high_usage(≥10), low_balance.
- پنل ادمین دکمه‌ای: داشبورد (کاربر/درآمد/موجودی OpenRouter — هشدار زیر $1)، CRUD کد تخفیف، پیام promo قابل‌فوروارد.
- جاروی ۶۰ثانیه‌ای: انقضای فلوهای رهاشده، پاک‌سازی سشن‌های >۲h و notionStates >۱h.
- جاروی پرداختِ ۶۰ثانیه‌ای (جدا، fail-safe): (۱) درین `admin_actions` (تأیید/رد enqueue‌شده‌ی داشبورد → `approvePaymentDb`/`rejectPaymentDb` + پیام به کاربر)؛ (۲) یادآوریِ per-bot رسیدهای `waiting_review` قدیمی‌تر از ۲ ساعت با دکمه‌های تأیید/رد فعال، به **همه‌ی ADMIN_IDS** (throttle با `reminded_at` هر ۴ ساعت). یادآوری رسید دیگر از Health/cross-bot نمی‌آید.

## Notion (فقط OWNER + نیازمند NOTION_TOKEN)
بعد از هر رونویسی موفق: پیشنهاد ارسال («بله بفرست») → **سه مقصد سریعِ ثابت** (نه مرور صفحات) → عنوان فارسی خودکار (flash-lite) → ساخت یک صفحه‌ی جدید داخل زیرصفحه‌ی «Voice Inbox»ِ مقصد (بلوک‌های ۲۰۰۰کاراکتری، سقف ۱۰۰).
- مقصدها در `NOTION_QUICK_TARGETS` هاردکد شده‌اند: `{icon, title, inbox}` که `inbox` = آی‌دیِ صفحه‌ی «Voice Inbox» داخل هر صفحه‌ی اصلی. عنوان/آیکونِ دکمه‌ها باید **دقیقاً** با صفحه‌ی متناظر در Notion یکی باشد: ✏️ منشی شخصی، 🥎 صف پرامپت‌ها، 🎤 Meetings. اگر مالک یکی از این صفحات را rename/آیکون‌عوض کرد یا Voice Inbox را جابه‌جا کرد، این آرایه باید دستی به‌روز شود.
- callbackها: `ntn:start` (نمایش سه دکمه) و `ntn:quick:<index>` (ساخت در inbox). فلوی قدیمیِ مرور صفحات (`ntn:nav`/`ntn:sel`/`ntn:back`) حذف شد؛ helperهای `notionGetRootPages`/`notionGetChildPages`/`notionPageTitle` فعلاً بلااستفاده‌اند.
- **پیش‌نیاز دسترسی:** سه صفحه‌ی اصلی (و در نتیجه زیرصفحه‌ی Voice Inbox آن‌ها) باید با همان Integrationِ `NOTION_TOKEN` ربات share شده باشند، وگرنه ساخت صفحه با خطای دسترسی/۴۰۴ برمی‌گردد.

## دیباگ‌پذیری
- `bot.catch` سراسری + `unhandledRejection` (فقط لاگ) + `uncaughtException` (لاگ + exit برای ری‌استارت pm2) — انتهای فایل.
- پیشوندهای قابل‌grep: `❌ GLOBAL`, `❌ UNHANDLED_REJECTION`, `❌ UNCAUGHT_EXCEPTION`, `CreditError`, `RATE_LIMIT`.
- خطاهای کاربرپسند نگاشت‌شده: اعتبار تمام (CreditError، هرگز retry نمی‌شود)، rate-limit، تبدیل، TIMEOUT، شبکه.

## آنالیتیکس کمینه (اتریبیوشن)
- این ربات از shared استفاده نمی‌کند؛ **کپی محلی** هم‌قرارداد `shared/analytics.js` (بلوک `ANALYTICS_SCHEMA_VERSION = 2` بعد از voice_flows در index.js). چک CI (`tools/check-analytics-sync.mjs`) سینک بودن را تضمین می‌کند — تغییر قرارداد در shared باید همین‌جا هم اعمال شود.
- جدول `events` + ستون‌های write-once `users.first_source/first_payload/first_version`. `captureStart` در `bot.start` (payload: `c_<code>` کمپین از داشبورد / خالی organic؛ نسخه از ثابت `PRODUCT_VERSION` بالای فایل — با هر تغییر رفتاری bump شود، بند ۲ج ریشه). رویدادهای ثبت‌شده (فقط ثبت — هیچ اثری روی فلو): `start`، `product_delivered` (job موفق)، `receipt_submitted`، `payment_approved` (approve ادمین/ایجنت + تخفیف ۱۰۰٪ خودکار؛ props: via=ai در auto)، `payment_rejected` (props: via=ai)، `payment_reversed` (برگشتِ رسیدِ فیک؛ props: payment_id/amount/clawed). track fail-safe است (فقط logErr). این رویدادهای اضافه فقط prop/نامِ جدید اضافه می‌کنند و قرارداد schema (`ANALYTICS_SCHEMA_VERSION`) را عوض نمی‌کنند.

## ریست حساب ادمین (بند ۶ب ریشه)
دکمه‌ی `🔄 ریست حساب (ادمین)` (`RESET_TEST_BTN`) **برای هر دو آی‌دیِ ADMIN_IDS، همیشه**: حذف ردیف‌های همان ادمین از ۷ جدول (users, usage_log, payments, discount_uses, pro_whitelist, voice_flows, events) + `admin_actions` مرتبط (subquery) + پاک‌سازی state های in-memory، بعد معرفی مثل کاربر جدید (`upsertUser` → هدیه‌ی خوش‌آمد از نو). کدهای تخفیف (discount_codes) پاک نمی‌شوند. برچسبِ قدیمیِ `🔄 ریست ربات (تست)` هم هنوز match می‌شود. توجه: ادمینِ voice2text عمداً متمایز است (مصرف رایگان + مدل Pro)، پس ریست بیشتر برای پاک‌کردنِ دیتای تستِ خودِ ادمین است.

## پشتیبانی (بند ۶ج ریشه)
دکمه‌ی `💬 پشتیبانی` در منوی پایین، برای **همه‌ی کاربران** (هم کاربرِ عادی، هم ادمین) + دستور `/support`. پیام: کدِ پیگیریِ `#V2T-<user_id>` به‌صورت قابلِ کپی + دکمه‌ی `💬 باز کردن چت پشتیبانی` که `t.me/Efficient_Support?text=…` را باز می‌کند و کادرِ تایپِ کاربر را با همان کد + «کد را پاک نکنید» پر می‌کند.
چون voice2text از `shared/` ایمپورت نمی‌کند، بلوکِ `SUPPORT_*` بالای `index.js` **کپیِ خودکفا**ی `shared/support.js` است و CI با `tools/check-support-sync.mjs` سینکشان را قفل کرده (عوض کردنِ حساب = هر دو جا). هندلر قبل از `bot.on('text')` ثبت شده، پس متنِ دکمه هیچ‌وقت به‌عنوان «مبلغ شارژ» بلعیده نمی‌شود؛ و چون فقط یک پیامِ اطلاعاتی است، `userStates` و فاکتورِ باز دست‌نخورده می‌ماند و کاربر از همان‌جا ادامه می‌دهد. رول‌بک: `SUPPORT_ENABLED = false`.

## env
`BOT_TOKEN`*, `OPENROUTER_API_KEY`*, `NOTION_TOKEN` (اختیاری)، `ADMIN_IDS` (کامای آی‌دی‌ها؛ deploy از `OWNER_TELEGRAM_ID` upsert می‌کند — حتی روی .env دستیِ سرور)، `RECEIPT_AI_AUTO_APPROVE` (اختیاری، پیش‌فرض روشن؛ `false` = خاموش‌کردنِ auto-approveِ ایجنتِ رسید بدونِ دیپلوی)، `OPENROUTER_API_KEY_PERSONAL` (اختیاری؛ از Secret `VOICE2TEXT_OPENROUTER_KEY_PERSONAL_USED`؛ `apiKeyFor(uid)` فقط برای `OWNER_ID` — اولین `ADMIN_IDS`، پیش‌فرض `100257975` — به‌جای `OPENROUTER_API_KEY` این کلید را در فراخوانی اصلیِ رونویسی/`callAI` استفاده می‌کند؛ ست‌نشده = مثل قبل، همه از کلید مشترک). نیازمند ffmpeg/ffprobe روی سرور.
