# CLAUDE.md — tarot (فال تاروت فارسی 🔮 — 🟢 زنده از ۱۴۰۵/۰۴/۲۰)

> **این ربات زنده است** (تبلیغات فعال؛ کاربر واقعی/پولی): «قوانین تغییر ربات زنده» بند ۲ج CLAUDE.md ریشه در هر PR اجباری است. این فایل باید با هر PR که رفتار ربات را عوض می‌کند به‌روز شود. از `shared/` (logger, errors) استفاده می‌کند.
> `PRODUCT_VERSION` (بالای index.js، فعلاً `1.0.0`): با هر تغییر رفتاریِ رو-به-کاربر در همان PR بامپ شود — کوهورت `users.first_version` از همین پر می‌شود.

## چیستی
بازسازی سفر مشتری یک تاروت‌خوان حرفه‌ای در ۵ پرده: پیش‌جلسه (پرسشنامه تمرکز + سؤال متنی/ویسی) → فضاسازی (مدیریت انتظار + تمرین تنفس) → خوانش (بُر با توقف کاربر → انتخاب از گرید ۲۴تایی → **پی‌وال دقیقاً قبل از افشا** → افشای مرحله‌ای spoiler + حلقه‌ی بازخورد وسط خوانش) → پایان‌بندی (روایت + ۳ قدم عملی) → قلاب بازگشت (مدیاگروپ یادگاری، milestone، کد تخفیف کارت روز، رفرال). مغز: تک‌فراخوانی LLM per فال با prefetch بعد از انتخاب کارت آخر.

## اعداد بیزینس (ابتدای index.js)
- **هدیه‌ی خوش‌آمد ندارد** (مسیر رایگان فقط کارت روز است) و **حداقل مبلغ شارژ هم ندارد** (هر عدد مثبتی پذیرفته می‌شود). `REFERRAL_BONUS=10٬000` دوطرفه. `FIRST_RECHARGE_DISCOUNT=35٪ تا سقف 100٬000` — **خودکار** (بدون کد) روی اولین شارژ موفق هر کاربر اعمال می‌شود (`hasRecharged` = دارد approve شده‌ای؟)؛ در `paywallShort` هم قبل از اولین شارژ تبلیغ می‌شود. `MILESTONE_DAYS=14`، پوش حداکثر هفته‌ای یک‌بار.
- **هدیه‌ی شارژ پلکانی** (`RECHARGE_BONUS`): شارژ ≥۲۰۰k → +۳۰k، ≥۱۰۰k → +۱۰k (روی مبلغ اصلی قبل از تخفیف، هنگام approve).
- **استریک کارت روز**: روزهای پیاپی (تقویم تهران، ستون `users.daily_streak`)؛ از روز ۲ نمایش، هر ۷ روز پیاپی +۵٬۰۰۰ اعتبار.
- **قانون قیمت: هر کارت ۱۰٬۰۰۰ تومان** (`price = size × PER_CARD` در spreads.js — قیمت دستی per فال ننویس). فعلی: daily رایگان (روزی یک‌بار، تقویم تهران) | yesno ۲کارتی ۲۰k | three ۳۰k | فال‌های موضوعی ۵کارتی (love/career/money/inner/family/migration) و choice هرکدام ۵۰k | celtic ۱۰کارتی ۱۰۰k.
- **قیمت در آخرین لحظه نمایش داده می‌شود**: نه روی دکمه‌های کاتالوگ، نه بعد از انتخاب فال؛ فقط در پی‌وال (بعد از انتخاب کارت‌ها، روی دکمه‌ی «باز کردن کارت‌ها»).
- **فال موضوعی vs عمومی**: فال‌های دارای فیلد `focus` در spreads.js (عشق/کار/پول/درون/خانواده/مهاجرت) مرحله‌ی «حول چه موضوعی؟» را رد می‌کنند و مستقیم به سؤال می‌روند؛ فقط فال‌های عمومی (three/yesno/choice/celtic) حوزه را می‌پرسند. حوزه‌ی هر خوانش در `readings.focus_area` (از `session.focusKey`) ذخیره و به LLM داده می‌شود؛ نام فال‌های موضوعی با نام حوزه‌ها در پرسشنامه یکی است.
- رفرال: `/start ref_<id>`؛ **هیچ واریزی لحظه‌ی ورود نیست** (فقط پیام وعده). بعد از **اولین فال deliver شده‌ی** گیرنده (که با حذف هدیه‌ی خوش‌آمد عملاً یعنی بعد از اولین پرداختش): هر دو طرف ۱۰k واریز + به هر دو اطلاع داده می‌شود. دکمه‌ی «📤 دعوت دوستان» در کیبورد اصلی: لینک اختصاصی قابل‌کپی + دکمه‌ی `t.me/share/url` (پیام آماده + لینک با یک تاچ؛ switch_inline_query عمداً حذف شد چون کاربر ناآشنا فقط @botname را می‌فرستاد).
- کارت: همان کارت voice2text. کد ۱۰۰٪ = تأیید خودکار بدون رسید. `/newcode CODE PERCENT DAYS [USER_ID]`، `/stats` (شامل قیف کانورژن: readings به تفکیک status). پیام رد رسید = ادبیات voice2text با راه تماس `@alireza_oliya`.
- **ادمین‌ها از env:** `ADMIN_IDS` (کامای چند آی‌دی که deploy از `OWNER_TELEGRAM_ID` upsert می‌کند؛ پیش‌فرض `100257975`)، `OWNER_ID = ADMIN_IDS[0]`. رسید تأیید/رد به **همه‌ی ADMIN_IDS** می‌رود (هشدارِ per-bot، نه cross-bot).
- **صف تأیید داشبوردی + یادآوری رسید:** جدول `admin_actions` (داشبورد تأیید/رد را enqueue می‌کند) + ستون `payments.reminded_at`. جاروی پرداختِ ۶۰ثانیه‌ای (fail-safe): درین `admin_actions` با `approvePayment`/`rejectPaymentDb` + پیام کاربر، و یادآوریِ رسیدهای `waiting_review` قدیمی‌تر از ۲ ساعت به ادمین‌ها با دکمه‌ی فعال (throttle `reminded_at` هر ۴ ساعت). `wipeUser` جدول `admin_actions` را هم پاک می‌کند.
- **معماری پرداخت قابل‌تعویض** (برای Stars/زرین‌پال در آینده): کل ریل پرداخت فقط در این نقاط است: اکشن `recharge` + `setRechargeAmount` + هندلرهای رسید (photo/text در state `pay_receipt`) + `approvePayment` + `afterApproval`. پی‌وال و unlock هرگز با ریل پرداخت کاری ندارند؛ فقط با `balance` (کیف‌پول) حرف می‌زنند. تعویض درگاه = جایگزینی همین چند تابع؛ جدول `payments` و `credit/deduct` ثابت می‌مانند.
- CTA دوگانه در استارت (به این ترتیب): «کارت امروزم رو ببینم (رایگان)» اول، «فال گذشته/حال/آینده (محبوب‌ترین)» دوم.
- **آنبوردینگ نام (قدم صفر):** اولین کار بعد از /start، پرسیدن **نام فارسیِ خودِ کاربر** است (state `onboard_name`) قبل از هر توضیح؛ چون `first_name` تلگرام ممکن است انگلیسی/نامفهوم باشد و مدل آن را در متن فال/خوش‌آمد تکرار کند. نام در ستون `users.display_name` ذخیره می‌شود (جدا از `name` که همان نام تلگرام برای ادمین است). helper `dispName(user)` منبعِ همه‌ی متن‌های رو-به-کاربر و **تنها نامی که به LLM می‌رود** است (نام تلگرام هرگز به مدل نمی‌رود). ورودی با `cleanName` پاک می‌شود (خط اول، بدون ایموجی، ≤۳۲ کاراکتر).
- **🌀 فال با موضوع آزاد** (`OPEN_TOPIC_ENABLED` بالای index.js): دکمه‌ی «موضوع دلخواه» بالای کاتالوگ + در پیشنهادهای پایان فال؛ کاربر عمق (open3/open5) را انتخاب و موضوعش را خودش می‌نویسد (ویس هم کار می‌کند). چیدمان‌های `open3`/`open5` در `spreads.js` (فقط `SPREAD_BY_ID`، نه در کاتالوگ/suggestSpreads)، `focusKey='open'`. هدف: سیگنالِ «درباره‌ی هر چیزی می‌تونی فال بگیری» بدون تغییر فرمت پاسخ‌دهی. **Rollback فوری:** `OPEN_TOPIC_ENABLED=false` → دکمه/کپی‌ها محو و رفتار دقیقاً مثل قبل (فال‌های open ثبت‌شده بی‌ضرر می‌مانند).

## LLM
- `FLASH = google/gemini-2.5-flash`؛ فالبک `deepseek/deepseek-v3.2`؛ برنامه‌ی retry: `[FLASH×3, DeepSeek×2]` با validate خروجی JSON (`orChatResilient`).
- **همه‌ی پرامپت‌ها در `locales/fa.js`** — هیچ متن فارسی رو-به-کاربر در index.js مجاز نیست (قرارداد چندزبانگی).
- **کپی انسانی:** هیچ «—» یا «--» در متن‌های رو-به-کاربر؛ در هر سه پرامپت (خوانش/روزانه/بازخورد) هم صریح به مدل ممنوع شده (بند ۱۰ ریشه).
- شکست کامل LLM بعد از پرداخت → **REFUND خودکار** + دکمه‌ی تلاش مجدد (لاگ: `REFUND path`).
- سقف هزینه‌ی قبل از پرداخت: prefetch فقط با موجودی کافی + سقف ۱۵/روز؛ ویس سؤال ≤۱۲۰s و ≤3MB.
- حافظه‌ی انباشتی: `users.memory_json` (شناخت سوم‌شخص، سقف ۱۲۰۰ کاراکتر) با هر فال به‌روز می‌شود + **ریکال کامل ارزان**: ۴ فال deliver شده‌ی آخر (نوع/خلاصه/بازخورد) مستقیم به کانتکست تزریق می‌شود — RAG لازم نیست، هزینه‌ی اضافه ناچیز.
- کارت روز در `daily_texts` **دائمی** کش می‌شود (کلید: کارت×جهت×تمرکز، بدون نام کاربر).

## دیتابیس (`data/bot-<LOCALE>.db`)
`users` (balance، state، focus_area، session_json، memory_json، milestone/push، **first_source/first_payload** اتریبیوشن write-once)، `readings` (منبع حقیقت فال: seed، cards_json، llm_json، status: pending_payment/started/delivered/canceled/refunded)، `payments` (+ `reminded_at`)، `admin_actions` (صف تأیید/رد رسید از داشبورد)، `discount_codes`، `discount_uses`، `referrals`، `card_files` (کش file_id تصاویر)، `daily_texts`، **`events`** (آنالیتیکس مشترک — پایین).

## آنالیتیکس و اتریبیوشن (shared/analytics.js)
- `ensureAnalytics(db)` بعد از migration ها؛ `captureStart` در `handleStart`: رویداد `start` برای **هر** /start (props: payload/kind/code/new/v) + `first_source` و `first_version` (از `PRODUCT_VERSION`) فقط برای کاربر جدید (write-once). قرارداد payload: `c_<code>` کمپین (لینک از داشبورد)، `ref_<id>` رفرال (الگوی موجود)، خالی = organic.
- رویدادهای ثبت‌شده (ثابت‌های `EVENTS` + اختصاصی‌ها): `start`, `onboard_done`, `daily_card`, `first_value` (once)، `spread_selected`, `question_submitted`, `cards_picked`, `paywall_shown` (props: can_afford)، `reading_started`, `product_delivered`, `refund`, `recharge_started`, `receipt_submitted`, `payment_approved`, `payment_rejected`, `feedback`, `reset`.
- `wipeUser` جدول‌های `events` و `ab_exposures` را هم پاک می‌کند (قرارداد ریست تست). خطای track هرگز فلو را نمی‌شکند (fail-safe).
- **A/B تست (shared/ab.js):** `ensureAb(db)` در boot؛ آزمایش فعال: `onboard_cta_order` — variant `reading_first` ترتیب دو دکمه‌ی CTA پایان آنبوردینگ را برعکس می‌کند (فال اول). تا وقتی آزمایش از داشبورد running نشود، `variant()` همیشه control برمی‌گرداند (رفتار عیناً قبلی). config آزمایش‌ها را داشبورد در جدول `experiments` همین DB می‌نویسد.

## ماشین حالت (users.state)
`new → onboard_name → onboard_focus → idle → choose_spread → confirm_focus → await_question → breathing → shuffling → picking → confirm_pay → revealing → feedback` + `pay_amount/pay_receipt/pay_discount`. دک با seed قطعی (sha256+mulberry32، `REVERSAL_PROB=0.3`). گارد race در `pick:` (قفل سینکرون قبل از await). شارژ وسط فال → بعد از approve ادمین، فال خودکار ادامه می‌یابد (`afterApproval`). **آیین تطبیقی**: مشتری ثابت (۲+ فال کامل) فضاسازی کوتاه‌تر می‌گیرد.

## پس‌زمینه و in-memory
- `prefetches` Map با کلید `{readingId, promise}` (نه فقط uid) — تا نتیجه‌ی فالِ دیگری به فالِ جاری تزریق نشود؛ حقیقت در `readings.llm_json`.
- `recoverOrphanReadings` در بوت: فالِ `started` با `llm_json` خالی (یتیمِ ری‌استارتِ وسطِ LLM) → refund + دکمه‌ی تلاش مجدد.
- بازیابیِ رسید: هندلر photo اگر state گم شده باشد، پرداختِ `pending`/`step=receipt` (پنجره‌ی ۳ روز) را بازیابی می‌کند.
- `claimAmount` اتمیک (`WHERE step='amount'`) ضد دابل‌تپِ دو مبلغ؛ `countAutoDiscount` ضد چندبار گرفتن تخفیفِ اولِ خودکار با pendingهای هم‌زمان.
- جاروی ساعتی milestone: یادآوری ۱۴روزه با خلاصه‌ی فال قبل (سقف ۲۰/ساعت، cooldown هفتگی).

## چندزبانگی
هر زبان = اپ pm2 جدا از همین پوشه: `locales/<LOCALE>.js` + `ENV_FILE=.env.<locale>` + دیتابیس جدا. زبان جدید: فایل locale بساز + اپ در ecosystem.

## وضعیت لانچ (فاز تست تمام شد)
`TEST_PHASE=false` از ۱۴۰۵/۰۴/۲۰: دکمه‌ی ریست از کیبورد حذف شده؛ `/reset` فقط برای OWNER مانده (wipeUser سر جایش است). دیتای دوره‌ی تست با اسکریپت یک‌باره‌ی `tools/launch-wipe-tarot.mjs` در دیپلوی لانچ پاک شد (بکاپ `bot-*.db.pre-launch.bak` روی سرور؛ marker: `data/.launch-wipe-done`) — فقط ردیف‌های ادمین‌ها ماندند.
- دکمه‌ی دعوت با `t.me/share/url` کار می‌کند و نیازی به `/setinline` ندارد (هندلر inline_query صرفاً باقی مانده و بی‌ضرر است).

## env
`BOT_TOKEN`*, `OPENROUTER_API_KEY`*, `LOCALE` (پیش‌فرض fa), `ENV_FILE` (اختیاری)، `ADMIN_IDS` (کامای آی‌دی‌ها؛ deploy از `OWNER_TELEGRAM_ID` upsert می‌کند).
