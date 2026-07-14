# CLAUDE.md — secretary (منشیِ شخصیِ صوتی 🗂)

> این فایل با هر PR که رفتار ربات را عوض می‌کند به‌روز شود (قرارداد بند ۲ب ریشه).
> **استیت: 🧪 تست شخصی** (فقط مالک؛ `TEST_PHASE=true`). تا زنده‌نشدن، تغییرات آزادند.

## چیستی
منشیِ شخصیِ **صوتی-محور**: مالک هر لحظه ویس یا متن می‌فرستد، ربات نیت‌ها را درمی‌آورد و هرکدام را جای درستش می‌فرستد:
- **جلسه/قرارِ زمان‌دار → Google Calendar** (با کارت تأیید، چون پرریسک است).
- **کار / خواندنی / فکرِ نیمه‌تمام → TickTick**، همه در یک لیستِ واحد به اسم **«منشی»** (مالک خودش می‌بیند و دسته‌بندی می‌کند).
- **حرف عادی/درددل → هیچ آیتمی** (فقط شاید یک مشاهده در حافظه).

یک پیام می‌تواند چند نیت از جنس‌های مختلف داشته باشد؛ همه جدا استخراج می‌شوند. **فاز ۱: بدون یادآوریِ داخلیِ ربات** (یادآوری کار خودِ TickTick/Calendar است؛ «یادم بنداز ساعت ۳...» می‌شود یک تسکِ TickTick با سررسید).

## تصمیم‌های محصولی (پاسخ به سؤالات بند ۱۱ ریشه)
- **جنس محصول:** ابزاری (سرعت و «نگذاشتنِ چیزی از قلم» = ارزش)، با لحنِ گرمِ منشی.
- **اولین ارزش در چند ثانیه:** یک ویس بفرست، بلافاصله رسیدِ ثبت می‌گیری.
- **پی‌وال:** ندارد (ابزار شخصیِ مالک، رایگان).
- **قلاب بازگشت:** خودِ نیازِ روزمره (هر فکر/کار که نمی‌خواهی گم شود).
- **اعتماد:** تک‌کاربره؛ داده فقط پیش خودِ مالک و در سرویس‌های خودش (تقویم/تیک‌تیکِ خودش).
- **اگر پروسه restart شود:** هر capture ناتمام از همان مرحله ادامه می‌یابد (kick در بوت). in-memory فقط editStates و شمارنده‌ی جاب (بازسازی‌پذیر).
- **اگر LLM جواب ندهد:** پلن fallback؛ در نهایت capture=failed با دکمه‌ی «دوباره» (متن محفوظ می‌ماند).
- **دکمه‌ی دوبار/دیر:** گذارِ گارددارِ سینکرون روی status قبل از هر await.
- **ورودی خصمانه:** گیتِ فقط-ادمین (صفر LLM برای غیرادمین)، سقف حجم/مدت، پیشوند ضد prompt-injection در پرامپت.

## معماری و پایپ‌لاین
`captured → transcribing → transcribed → extracting → extracted → routed | partial | failed` (روی جدول `captures`).
1. **دریافت:** هندلر تلگراف فقط ردیف capture می‌سازد + ack می‌دهد + جاب async را بدون await کیک می‌زند (مصون از `handlerTimeout`).
2. **رونویسی** (`audio.js`): دانلود (۳ تلاش، سقف 20MB)، ffprobe مدت، **قطعه‌بندی** برای بلندتر از ۲۰۰s: قطعه‌های ۱۸۰ثانیه‌ای با ۱۰s همپوشانی هر طرف (ضد قطع وسط کلمه)، هر قطعه mp3 (`-ar 16000 -ac 1 -b:a 64k`) و رونویسیِ مقاومِ فقط-صوتی `[flash, flash, pro]`. هر قطعه در `chunks` ذخیره می‌شود (کرش = ادامه از قطعه‌ی pending). merge با dedupِ درز (رانِ توکنیِ ≥۴).
3. **استخراج** (`extract.js`): یک فراخوانی `chatResilient` با پلن `[pro, pro, flash, flash, deepseek]` → JSON سخت‌گیرانه `items[] + memory_observations[]`. بلوکِ زمانِ تهران (میلادی ISO + شمسیِ امروز) در پرامپت تزریق می‌شود؛ مدل خودش «فردا/پنجم مرداد» را حل می‌کند و همیشه ISO میلادی با `+03:30` می‌دهد (JS هرگز شمسی را parse نمی‌کند).
4. **مسیریابی** (`index.js`): ریسک در کد تعیین می‌شود (نه LLM): `event` یا `confidence<0.6` یا تاریخِ عجیب → **high** (کارت تأیید)؛ بقیه → **low** (ثبتِ فوری + دکمه‌ی برگردان/اصلاح).
5. **حافظه** (`memory.js`): اگر مشاهده بود، یک فراخوانی ارزانِ flash → merge در `users.memory_json` (سقف ۱۲۰۰، fail-safe).

## جدول‌ها (`data/bot.db`, WAL — `db.js`)
| جدول | نقش |
|------|-----|
| `users` | + ستون `memory_json` (حافظه‌ی منشی درباره‌ی مالک؛ نه فهرست کارها) |
| `settings` | key/value: توکن TickTick، id پروژه‌ی «منشی»، state، آخرین هشدار توکن |
| `captures` | هر ورودی (ویس/متن/فوروارد): وضعیت، transcript، status_msg_id |
| `chunks` | قطعه‌های رونویسی per capture (کرش‌سیف) |
| `items` | هر نیتِ استخراج‌شده: kind، title/body/url، due_at/end_at/all_day، risk، status، dest، external_id، quote |
| `events` | آنالیتیکس مشترک (`shared/analytics.js`) |

`items.status`: `proposed → confirmed → delivering → delivered | undone | failed | dismissed`. external_id: برای gcal = eventId قطعی (`sec`+id)؛ برای ticktick = `projectId:taskId`.

## اتصال‌ها
### Google Calendar (`gcal.js`) — Service Account، بدون npm
JWT RS256 با `node:crypto` → access token (کش ۵۵ دقیقه) → REST v3 insert/delete. event id **قطعی** از item.id (idempotent؛ 409 → PATCH، هم retryِ کرش هم ویرایش را می‌پوشاند). نبودِ env = خاموش (نه کرش).
- Secrets: `SECRETARY_GOOGLE_SA_KEY_B64` (base64 کل JSON کلید SA)، `SECRETARY_GOOGLE_CALENDAR_ID`.
- راه‌اندازی مالک: پروژه‌ی GCP + فعال‌سازی Calendar API + Service Account + کلید JSON (base64) + share تقویم با ایمیل SA («Make changes to events»).

### TickTick (`ticktick.js`) — OAuth2
اتصال یک‌باره داخل خود ربات: `/ticktick` → لینک authorize → مالک بعد از grant، آدرس/کد را با `/ticktick_code <...>` می‌فرستد → exchange → توکن در `settings`. همه‌ی آیتم‌ها به پروژه‌ی **«منشی»** (find-or-create، id در settings). انقضا (401/403 یا عمر >۱۷۰ روز) → DM اتصال مجدد؛ آیتمِ ناموفق با دکمه‌ی «🔁 دوباره بفرست».
- Secrets: `SECRETARY_TICKTICK_CLIENT_ID`, `SECRETARY_TICKTICK_CLIENT_SECRET`. redirect ثبتی: `http://localhost:8976/callback` (هرگز serve نمی‌شود).

## دستورها و UX
- `/start` معرفی، `/ticktick` و `/ticktick_code` اتصال، `/memory` نمایش حافظه، `🔄 ریست ربات (تست)` / `/reset`.
- ویسِ بلند: پیام ack با «(قطعه X از Y)» به‌روز می‌شود (throttle ۴s). بیش از ۲ آیتم: اول یک جمع‌بندی.
- فقط-لینک → مستقیم read_later بدون LLM. فوروارد → مارکرِ «متن فوروارد شده».

## سقف‌ها
`MAX_VOICE_SEC=3900` (~۶۵min)، سقف 20MB تلگرام (پیام صادقانه)، متن ۸۰۰۰ کاراکتر، بودجه‌ی روزانه ۱۲۰ دقیقه صوت (مرز روز تهران)، `MAX_CONCURRENT_JOBS=2` (مازاد در DB، jarو برمی‌دارد).

## آنالیتیکس
هسته: `start`، `onboard_done` (اولین capture)، `first_value` (اولین آیتمِ delivered)، `product_delivered` (per capture مسیریابی‌شده). اختصاصی: `capture_received`، `items_extracted` (شمار per kind)، `item_delivered`، `item_undone`، `item_confirm_shown`. بدون payments (رجیستری داشبورد بدون `money`).

## env
`BOT_TOKEN`*, `OPENROUTER_API_KEY`*، `GOOGLE_SA_KEY_B64`، `GOOGLE_CALENDAR_ID`، `TICKTICK_CLIENT_ID`، `TICKTICK_CLIENT_SECRET`، `ADMIN_IDS` (deploy از `OWNER_TELEGRAM_ID` upsert می‌کند). نیازمند ffmpeg/ffprobe روی سرور (deploy نصب می‌کند).

## چک‌لیست خروج از فاز تست (وقتی خواستی عمومی/چندکاربره شود)
`TEST_PHASE=false` → معماری چندکاربره: فلوی OAuth per-user برای گوگل/تیک‌تیک (الان تک‌توکنِ مالک در env/DB) → ذخیره‌ی امن توکن per کاربر → `PRODUCT_VERSION` بامپ. فاز ۲ (بیرون از این PR): دایجست صبحگاهی، مرور هفتگی، فایل >20MB با Bot API محلی، دعوت مهمان تقویم (نیازمند OAuth)، A/B.
