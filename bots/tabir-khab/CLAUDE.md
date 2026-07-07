# tabir-khab — راهنمای Claude Code

> این ربات از ریپوی مستقل `darkgreenblue/tabir-khab` به این مونوریپو (زیر `bots/tabir-khab/`) منتقل شده.
> ریپوی قدیمی فقط آرشیو است و deploy آن غیرفعال شده — **توسعه فقط اینجا.**
> این ربات **استثنای مونوریپوست**: پایتون + venv + systemd، نه Node/pm2 (در `ecosystem.config.cjs` نیست).

## قانون کار با این پروژه (همیشه رعایت کن)

هر تغییری که commit و push می‌کنی، **بلافاصله** باید مرج و دیپلوی هم بشه — بدون اینکه صاحب پروژه جداگانه بگه.
جریان استاندارد برای هر PR:
1. commit + push به branch
2. PR بساز (draft)
3. **بلافاصله squash-merge به main** (نیازی به تأیید جداگانه نیست)
4. **دیپلوی خودکار است** — همین مرج به `main` کافی است.

> دلیل: پروژه در مرحله‌ی تست شخصی است، کاربر فعال ندارد، و صاحب پروژه می‌خواهد هر تغییر را فوری روی سرور ببیند.
> ⚠️ ولی چون این ریپو ربات‌های زنده‌ی دیگری هم دارد (به‌خصوص voice2text)، قبل از merge حتماً CI سبز باشد
> و تغییرت فقط داخل `bots/tabir-khab/` (و در صورت نیاز workflowهای مربوط به خودش) باشد.

### دیپلوی چطور کار می‌کند (مهم — وقت SSH دستی تلف نکن)
دیپلوی **کاملاً خودکار** است: جابِ `deploy-tabir-khab` در `.github/workflows/deploy.yml` (ریشه‌ی مونوریپو).
هر `push` به `main` باعث می‌شود runnerِ گیت‌هاب محتوای `bots/tabir-khab` را با
`git archive | tar -x` روی `/home/ubuntu/tabir_khab` سرور overlay کند، بعد
`pip install` + `systemctl restart tabir-khab`. کلید SSH = secretِ `VPS_SSH_KEY` (مشترک با بقیه‌ی ربات‌ها).
`.env` و `*.db` و `logs/` و `.venv/` روی سرور در overlay دست نمی‌خورند.
نکته: فایل‌هایی که از ریپو *حذف* می‌کنی از سرور خودکار پاک نمی‌شوند — اگر حذفشان از سرور مهم است، یک `rm` یک‌باره در اسکریپت دیپلوی بگذار.

- **خودت از این محیط SSH نزن** — پورت ۲۲ از محیطِ ابریِ Claude بسته است و کلیدی هم اینجا نیست.
  SSH دستی timeout می‌خورد. لازم هم نیست.
- برای دیپلوی فقط **به `main` مرج کن**، بعد با `actions_list` رویِ `deploy.yml` مطمئن شو
  آخرین run با `conclusion: success` تمام شده — همان یعنی ربات روی سرور آپدیت شد.
- **لاگ/وضعیت سرور:** workflowِ `Tabir-khab logs` را dispatch کن (ورودی: `lines`, `grep`) و خروجی را از لاگ جاب بخوان.
- **گزارش مدیریتی (کاربر/خواب/درآمد):** workflowِ `Tabir-khab report` را dispatch کن.

---

## سرور پروداکشن
- **IP:** `185.204.171.170`
- **یوزر:** `ubuntu`
- **پوشه‌ی ربات:** `/home/ubuntu/tabir_khab`
- **سرویس:** `tabir-khab` (systemd)

### دستورات پرکاربرد روی سرور
```bash
sudo systemctl restart tabir-khab          # ری‌استارت
sudo systemctl status tabir-khab           # وضعیت
tail -f /home/ubuntu/tabir_khab/logs/bot.log  # لاگ زنده
# کدِ جدید با جاب deploy-tabir-khab (push به main) می‌رسد — git pull روی سرور دیگر معنا ندارد
```

## معماری سریع
- `ai.py` — لایه‌ی هوش مصنوعی (Gemini Flash اصلی، DeepSeek+STT فال‌بک)
- `handlers.py` — منطقِ اصلیِ ربات (مشترک بین همه‌ی ربات‌ها)
- `config.py` — همه‌ی ثابت‌ها و فلگ‌ها (از جمله `FORCE_FALLBACK_FOR_TEST`) + `bot_instances()`
- `db.py` — دیتابیس SQLite (هر ربات فایلِ جدا؛ سوییچ با ContextVar per polling-loop)
- `locales/` — متن‌های چندزبانه (تک‌منبعِ حقیقتِ همه‌ی کپی/پرامپت‌ها)

## معماری چند-رباته (یک ربات per زبان — مهم)
- **مرحله‌ی انتخاب زبان حذف شده.** هر زبان یک رباتِ تلگرامِ مستقل با توکن و آیدیِ خودش دارد
  (برای مارکتینگِ جدا)؛ فارسی علاوه بر تلگرام، بله هم دارد. کلید OpenRouter بین همه مشترک است.
- همه در **یک پروسه** اجرا می‌شوند (همان سرویسِ systemd) — `bot.py` برای هر instance با توکنِ
  ست‌شده یک polling-loop می‌سازد؛ توکنِ خالی = آن ربات غیرفعال (راه‌اندازی تدریجی).
- **کد همچنان چندزبانه است**: هر تغییرِ رفتار/متن از `locales/` و کدِ مشترک یک‌جا روی همه‌ی
  زبان‌ها اعمال می‌شود. زبانِ هر instance ثابت است (`bale.locale`) و `_lang_of` همان را برمی‌گرداند.
- **زبان جدید**: فقط `locales/<code>.py` بساز + به `LANG_ORDER` اضافه کن — instance و DB و
  گزارش خودکار تعریف می‌شوند؛ بعد secret توکنش را بساز و به deploy.yml اضافه کن.
- **دیتابیس‌ها**: `tabir_bale.db` (بله‌ی فارسی)، `tabir_telegram.db` (تلگرامِ فارسی — نامِ تاریخی،
  داده‌های قبلی حفظ شده)، `tabir_telegram_<lang>.db` برای بقیه.
- **توکن‌ها در .env سرور**: `BALE_BOT_TOKEN`، `TELEGRAM_BOT_TOKEN_FA` (فالبک: `TELEGRAM_BOT_TOKEN`)،
  `TELEGRAM_BOT_TOKEN_{EN,AR,RU,ES,PT}`. جابِ deploy این‌ها را از GitHub Secrets با نام‌های
  `TABIR_TELEGRAM_BOT_TOKEN_<LANG>` (و `TABIR_BALE_BOT_TOKEN`) upsert می‌کند — فقط کلیدهای
  ست‌شده؛ بقیه‌ی .env دست نمی‌خورد. برای اعمالِ secret جدید بدون کامیت: workflow ِ Deploy را
  dispatch کن.
- **پرونده‌ی باز پرداخت**: `payment_methods_for(lang)` در config — به‌زودی باید per-language
  کاستومایز شود (زرین‌پال برای فارسی، Stars/کریپتو بقیه).
- برچسبِ لاگ هر ربات `platform:locale` است (مثل `telegram:en`) — برای grep در `logs/bot.log`.

## فلگ‌های مهم در config.py
- `FORCE_FALLBACK_FOR_TEST` — وقتی `True`، همه‌ی خواب‌ها از مسیرِ فال‌بک می‌روند (برای تست). بعد از تست باید `False` بشود.
- `SKIP_PAYMENT` — وقتی `True`، پرداخت شبیه‌سازی می‌شود (محیطِ تست).
- `SKIP_DAILY_LIMIT` — وقتی `True`، محدودیتِ روزانه برداشته می‌شود.
