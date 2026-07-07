# CLAUDE.md — tarot (فال تاروت فارسی 🔮 — فاز تست)

> این فایل باید با هر PR که رفتار ربات را عوض می‌کند به‌روز شود. از `shared/` (logger, errors) استفاده می‌کند.

## چیستی
بازسازی سفر مشتری یک تاروت‌خوان حرفه‌ای در ۵ پرده: پیش‌جلسه (پرسشنامه تمرکز + سؤال متنی/ویسی) → فضاسازی (مدیریت انتظار + تمرین تنفس) → خوانش (بُر با توقف کاربر → انتخاب از گرید ۲۴تایی → **پی‌وال دقیقاً قبل از افشا** → افشای مرحله‌ای spoiler + حلقه‌ی بازخورد وسط خوانش) → پایان‌بندی (روایت + ۳ قدم عملی) → قلاب بازگشت (مدیاگروپ یادگاری، milestone، تخفیف اولین خرید، رفرال). مغز: تک‌فراخوانی LLM per فال با prefetch بعد از انتخاب کارت آخر.

## اعداد بیزینس (ابتدای index.js)
- `WELCOME_GIFT=30٬000` (دقیقاً قیمت فال ۳کارتی — «فال اول مهمان ما»)، `MIN_RECHARGE=50٬000`، `REFERRAL_BONUS=10٬000` دوطرفه، `FIRST_PAID_DISCOUNT=20٪/72h` (کد شخصی تک‌مصرف بعد از اولین فال پولی)، `MILESTONE_DAYS=14`، پوش حداکثر هفته‌ای یک‌بار.
- **هدیه‌ی شارژ پلکانی** (`RECHARGE_BONUS`): شارژ ≥۲۰۰k → +۳۰k، ≥۱۰۰k → +۱۰k (روی مبلغ اصلی قبل از تخفیف، هنگام approve).
- **استریک کارت روز**: روزهای پیاپی (تقویم تهران، ستون `users.daily_streak`)؛ از روز ۲ نمایش، هر ۷ روز پیاپی +۵٬۰۰۰ اعتبار.
- **قانون قیمت: هر کارت ۱۰٬۰۰۰ تومان** (`price = size × PER_CARD` در spreads.js — قیمت دستی per فال ننویس). فعلی: daily رایگان (روزی یک‌بار، تقویم تهران) | yesno ۲کارتی ۲۰k | three ۳۰k | فال‌های موضوعی ۵کارتی (love/career/money/inner/family/migration) و choice هرکدام ۵۰k | celtic ۱۰کارتی ۱۰۰k.
- **قیمت در آخرین لحظه نمایش داده می‌شود**: نه روی دکمه‌های کاتالوگ، نه بعد از انتخاب فال؛ فقط در پی‌وال (بعد از انتخاب کارت‌ها، روی دکمه‌ی «باز کردن کارت‌ها»).
- **فال موضوعی vs عمومی**: فال‌های دارای فیلد `focus` در spreads.js (عشق/کار/پول/درون/خانواده/مهاجرت) مرحله‌ی «حول چه موضوعی؟» را رد می‌کنند و مستقیم به سؤال می‌روند؛ فقط فال‌های عمومی (three/yesno/choice/celtic) حوزه را می‌پرسند. حوزه‌ی هر خوانش در `readings.focus_area` (از `session.focusKey`) ذخیره و به LLM داده می‌شود؛ نام فال‌های موضوعی با نام حوزه‌ها در پرسشنامه یکی است.
- رفرال: `/start ref_<id>`؛ **هیچ واریزی لحظه‌ی ورود نیست** (فقط پیام وعده). بعد از **اولین فال deliver شده‌ی** گیرنده (فال رایگانِ با هدیه هم شمرده می‌شود): هر دو طرف ۱۰k واریز + به هر دو اطلاع داده می‌شود. دکمه‌ی «📤 دعوت دوستان» در کیبورد اصلی: لینک اختصاصی قابل‌کپی + دکمه‌ی `t.me/share/url` (پیام آماده + لینک با یک تاچ؛ switch_inline_query عمداً حذف شد چون کاربر ناآشنا فقط @botname را می‌فرستاد).
- کارت: همان کارت voice2text. کد ۱۰۰٪ = تأیید خودکار بدون رسید. `/newcode CODE PERCENT DAYS [USER_ID]`، `/stats` (شامل قیف کانورژن: readings به تفکیک status). پیام رد رسید = ادبیات voice2text با راه تماس `@alireza_oliya`.
- **معماری پرداخت قابل‌تعویض** (برای Stars/زرین‌پال در آینده): کل ریل پرداخت فقط در این نقاط است: اکشن `recharge` + `setRechargeAmount` + هندلرهای رسید (photo/text در state `pay_receipt`) + `approvePayment` + `afterApproval`. پی‌وال و unlock هرگز با ریل پرداخت کاری ندارند؛ فقط با `balance` (کیف‌پول) حرف می‌زنند. تعویض درگاه = جایگزینی همین چند تابع؛ جدول `payments` و `credit/deduct` ثابت می‌مانند.
- CTA دوگانه در استارت: کارت روز (مزه‌ی سریع) + فال ۳کارتی کامل رایگان با هدیه (قلاب اصلی).

## LLM
- `FLASH = google/gemini-2.5-flash`؛ فالبک `deepseek/deepseek-v3.2`؛ برنامه‌ی retry: `[FLASH×3, DeepSeek×2]` با validate خروجی JSON (`orChatResilient`).
- **همه‌ی پرامپت‌ها در `locales/fa.js`** — هیچ متن فارسی رو-به-کاربر در index.js مجاز نیست (قرارداد چندزبانگی).
- **کپی انسانی:** هیچ «—» یا «--» در متن‌های رو-به-کاربر؛ در هر سه پرامپت (خوانش/روزانه/بازخورد) هم صریح به مدل ممنوع شده (بند ۱۰ ریشه).
- شکست کامل LLM بعد از پرداخت → **REFUND خودکار** + دکمه‌ی تلاش مجدد (لاگ: `REFUND path`).
- سقف هزینه‌ی قبل از پرداخت: prefetch فقط با موجودی کافی + سقف ۱۵/روز؛ ویس سؤال ≤۱۲۰s و ≤3MB.
- حافظه‌ی انباشتی: `users.memory_json` (شناخت سوم‌شخص، سقف ۱۲۰۰ کاراکتر) با هر فال به‌روز می‌شود + **ریکال کامل ارزان**: ۴ فال deliver شده‌ی آخر (نوع/خلاصه/بازخورد) مستقیم به کانتکست تزریق می‌شود — RAG لازم نیست، هزینه‌ی اضافه ناچیز.
- کارت روز در `daily_texts` **دائمی** کش می‌شود (کلید: کارت×جهت×تمرکز، بدون نام کاربر).

## دیتابیس (`data/bot-<LOCALE>.db`)
`users` (balance، state، focus_area، session_json، memory_json، milestone/push)، `readings` (منبع حقیقت فال: seed، cards_json، llm_json، status: pending_payment/started/delivered/canceled/refunded)، `payments`، `discount_codes`، `discount_uses`، `referrals`، `card_files` (کش file_id تصاویر)، `daily_texts`.

## ماشین حالت (users.state)
`new → onboard_focus → idle → choose_spread → confirm_focus → await_question → breathing → shuffling → picking → confirm_pay → revealing → feedback` + `pay_amount/pay_receipt/pay_discount`. دک با seed قطعی (sha256+mulberry32، `REVERSAL_PROB=0.3`). گارد race در `pick:` (قفل سینکرون قبل از await). شارژ وسط فال → بعد از approve ادمین، فال خودکار ادامه می‌یابد (`afterApproval`). **آیین تطبیقی**: مشتری ثابت (۲+ فال کامل) فضاسازی کوتاه‌تر می‌گیرد.

## پس‌زمینه و in-memory
- `prefetches` Map (فقط بهینه‌سازی — حقیقت در `readings.llm_json`).
- جاروی ساعتی milestone: یادآوری ۱۴روزه با خلاصه‌ی فال قبل (سقف ۲۰/ساعت، cooldown هفتگی).

## چندزبانگی
هر زبان = اپ pm2 جدا از همین پوشه: `locales/<LOCALE>.js` + `ENV_FILE=.env.<locale>` + دیتابیس جدا. زبان جدید: فایل locale بساز + اپ در ecosystem.

## فاز تست
`TEST_PHASE=true` (index.js): دکمه‌ی ریست برای همه؛ `wipeUser` = حذف از users/readings/payments/discount_uses/referrals (کیف‌پول هم صفر می‌شود — در فاز تست فقط پول هدیه است). **قبل از انتشار عمومی false شود**؛ `/reset` برای OWNER می‌ماند.
- ⚠️ پیش‌نیاز دکمه‌ی دعوت: روی BotFather برای این ربات `/setinline` فعال باشد.

## env
`BOT_TOKEN`*, `OPENROUTER_API_KEY`*, `LOCALE` (پیش‌فرض fa), `ENV_FILE` (اختیاری).
