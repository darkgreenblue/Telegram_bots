# secretary — منشیِ شخصیِ صوتی 🗂

منشیِ تلگرامیِ صوتی-محور و تک‌کاربره. ویس (یا متن) می‌فرستی، نیت‌هایت را درمی‌آورد و هرکدام را جای درستش می‌گذارد:

- **جلسه/قرارِ زمان‌دار → Google Calendar** (با کارت تأیید پیش از ثبت).
- **کار / خواندنی / فکرِ نیمه‌تمام → TickTick**، همه در یک لیستِ واحد به اسم «منشی».
- **حرف عادی → هیچ ثبتی** (فقط شاید کمی بهترت می‌شناسد).

یک پیام می‌تواند چند نیت داشته باشد؛ همه جدا استخراج می‌شوند. ویس‌های بلند (تا ~۱ ساعت) خودکار قطعه‌بندی و رونویسی می‌شوند.

## راه‌اندازی (فقط Secrets در گیت‌هاب)
| Secret | کاربرد |
|--------|--------|
| `SECRETARY_BOT_TOKEN`* | توکن ربات از BotFather |
| `SECRETARY_OPENROUTER_KEY`* | کلید OpenRouter |
| `SECRETARY_GOOGLE_SA_KEY_B64` | base64 کلید JSON یک Service Account (Calendar API فعال، تقویم با ایمیل SA share شده) |
| `SECRETARY_GOOGLE_CALENDAR_ID` | آیدی تقویم مقصد (معمولاً ایمیل مالک) |
| `SECRETARY_TICKTICK_CLIENT_ID` / `SECRETARY_TICKTICK_CLIENT_SECRET` | اپِ OAuth از developer.ticktick.com (redirect: `http://localhost:8976/callback`) |

ستاره‌دارها اجباری‌اند؛ بقیه اختیاری‌اند و قابلیتِ مربوطه تا ست‌شدنشان خاموش می‌ماند. بعد از دیپلوی، داخل ربات یک‌بار `/ticktick` را بزن و کد را با `/ticktick_code` بفرست.

## تست لوکال
```
cd bots/secretary && npm install
BOT_TOKEN=xxx OPENROUTER_API_KEY=yyy ADMIN_IDS=<آیدی‌ات> node index.js
```

جزئیات کامل معماری، جدول‌ها و قراردادها: `bots/secretary/CLAUDE.md`.
