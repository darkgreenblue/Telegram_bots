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

## آنالیتیکس مونوریپو (analytics.py)
- پورت پایتونیِ هم‌قرارداد `shared/analytics.js` (نسخه در `ANALYTICS_SCHEMA_VERSION`؛ چک CI ریشه `tools/check-analytics-sync.mjs` سینک بودن را تضمین می‌کند — تغییر قرارداد در shared باید این‌جا هم بیاید).
- `ensure_analytics` در `db.init_db` (per فایل DB): جدول `events` + ستون‌های write-once `users.first_source/first_payload/first_version`.
- `capture_start` در `_handle_start` (رویداد `start` برای هر /start + first_source/first_version فقط کاربر جدید؛ نسخه از `PRODUCT_VERSION` در config.py — با هر تغییر رفتاری bump شود؛ payload: `c_<code>` کمپین / `ref_<id>` رفرال / خالی organic). رویدادهای دیگر: `product_delivered` + `first_value` (تحویل تعبیر)، `payment_approved` (props: simulated برای SKIP/SIMULATED). همه fail-safe.
- **در داشبورد ادمین وصل است**: رجیستری `bots/dashboard/lib/bots.js` با پروفایلِ خودش (userPk=`user_id`، userNameCol=`first_name`، created_at ISO، money=`transactions`/`amount_rial`/`paid`/ریال با حذف پرداخت تستی SKIP/SIMULATED). مسیر DB مطلق `/home/ubuntu/tabir_khab` (override با env `TABIR_DB_DIR` برای تست لوکال). A/B هنوز ندارد (فقط رویدادها).

## ادمین‌ها (config.py — قرارداد یکپارچه‌ی همه‌ی ربات‌ها)
- `ADMIN_IDS` از env `ADMIN_IDS` (کامای چند آی‌دی که deploy از `OWNER_TELEGRAM_ID` upsert می‌کند)؛ `ADMIN_USER_ID = ADMIN_IDS[0]`؛ `is_admin(uid)` عضویت را چک می‌کند. دستورهای ادمین (مثل `/simulate_pay`) هم `ADMIN_USER_ID` و هم `ADMIN_IDS` را می‌پذیرند. هشدار/گزارش هر ربات per-bot می‌ماند (نه cross-bot).

## فلگ‌های مهم در config.py
- `FORCE_FALLBACK_FOR_TEST` — وقتی `True`، همه‌ی خواب‌ها از مسیرِ فال‌بک می‌روند (برای تست). فعلاً `False`.
- `SKIP_PAYMENT` — وقتی `True`، پرداخت شبیه‌سازی می‌شود (محیطِ تست). فعلاً `True` (درگاه واقعی هنوز وصل نیست).
- `SKIP_DAILY_LIMIT` — **`False`** (سخت‌سازی پیش‌لانچِ ربات‌های همسایه): سقفِ «هر شب یک رویا» فعال است تا غریبه‌ای که به این ربات برسد نتواند مصرفِ LLM بی‌سقف بتراشد (چون پرداخت هنوز شبیه‌سازی است).
- `RESET_BUTTON_ENABLED` — **`False`**: دکمه‌ی ریست خاموش (وگرنه هر کاربر تریالِ مجانیِ بی‌نهایت می‌گرفت).
- `SYMBOL_FINDER_ENABLED` — روشن/خاموشِ «نمادیاب خواب» (پایین). `False` = rollback فوری (دکمه‌ها و callback ها محو؛ رفتار عیناً قبلی).
- **بلاکرهای لانچِ خودِ tabir (برای بعد):** درگاه واقعی + Stars واقعی به‌جای simulate، `SKIP_PAYMENT=False`، اعتبارسنجی pre_checkout، `BALE_PAYMENT_TOKEN` واقعی، روشن‌کردن verify گواهی TLS (فعلاً `*_SSL_NO_VERIFY=True` برای تلگرام/OpenRouter هم هست — ریسک MITM)، راه تماس پشتیبانی در پیام مالی.

## نمادیاب خواب (مسیر رایگان بدون LLM — قلاب اینگیجمنت)
- **چیستی:** مرور رایگانِ ~۴۰۰+ نمادِ خواب per حرف الفبا با تعبیرِ کوتاهِ پرسونا-محور. **صفر هزینه‌ی runtime**: هیچ فراخوانی LLM ندارد؛ محتوا استاتیک در `symbols/fa/g1..g8.py` (تولید یک‌باره؛ ویرایش فقط از طریق PR).
- **دیتا:** هر نماد `{word, letter, tafsir:{religious, traditional, psychological}}` — سه متن مستقل با رفرنس‌های واقعیِ همان پرسونا (مذهبی: ابن سیرین/امام صادق ع/رمزهای قرآنی؛ سنتی: مطیعی تهرانی/باور عامیانه؛ روانشناختی: یونگ/فروید). لودر و API: `symbols/__init__.py` (ایندکس در حافظه هنگام import؛ زبان بدون دیتا = فیچر غیرفعال برای آن ربات). اعتبارسنجی بعد از هر تغییر دیتا: `python3 tools/validate_symbols.py` (طول/تکرار/پرسونای خالی/«—» ممنوع/کاراکتر Markdown-شکن).
- **UX:** دکمه‌ی کیبورد «🔍 نمادیاب خواب (رایگان)» (فقط زبان‌های دارای دیتا) → گرید حروف → لیست صفحه‌بندی‌شده (۱۰تایی، ادیت روی همان پیام) → تعبیر کوتاه با پرسونای کاربر + خط CTA (`sym.cta_line`) + دکمه‌ی «✨ خوابم رو کامل تعریف کنم» (→ فلوی عادی خواب). **نقطه‌ی ورود دوم:** ردیف آخر کیبورد پی‌وال (`sym:open`) تا کاربرِ بدون‌پول به جای ترک، درگیر بماند. callback ها: `sym:home|l|p|w|dream|open` (در `texts.py` مستند است). متن‌ها در بخش `sym` هر locale.
- **جستجوی متنی (فاز ۱٫۵):** داخلِ نمادیاب، تایپِ نامِ نماد هم کار می‌کند. چون به‌طور پیش‌فرض «هر متن = خواب» است، این با یک فلگِ سبکِ `sym_browse` در `users.profile` (JSON) گِیت می‌شود: ورود به نمادیاب آن را روشن و «خواب جدید»/CTA خاموشش می‌کند (`db.set_sym_browse`/`is_sym_browse`). در حالتِ نمادیاب فقط **متنِ کوتاه** (≤۲۴ کاراکتر، ≤۳ کلمه: `_looks_like_symbol_query`) = کوئری؛ متنِ بلندتر = روایتِ خواب و خروجِ خودکار از حالت (ضدِ بلعیده‌شدنِ خواب). خارج از نمادیاب رفتار **عیناً قبلی** است. جستجو (`SYM.search`) با نرمال‌سازیِ ی/ك/آ و پرانتزِ ابهام‌زدا کار می‌کند: یک نتیجه → مستقیم، چند نتیجه → لیست، صفر → پیام صادقانه + پیشنهاد (`SYM.suggest`) + CTA خواب. پیامِ «نتیجه نداشت» با `parse_mode=None` می‌رود (کوئریِ خام کاربر).
- **آنالیتیکس:** `symbol_opened` (props: via=keyboard/paywall)، `symbol_viewed` (letter/word/persona؛ props `via=search` برای هیتِ جستجو)، `symbol_cta_dream`، `symbol_search` (props: n)، `symbol_not_found` (props: query — منبعِ فازِ گسترشِ دیتا: کوئری‌هایی که نماد ندارند). قیف: symbol_opened → symbol_viewed → symbol_cta_dream → product_delivered.
- **فلوی اصلی تعریف خواب هیچ تغییری نکرده** — نمادیاب فقط نقطه‌ی ورود اضافه می‌کند؛ جستجوی متنی هم فقط داخلِ حالتِ `sym_browse` فعال است و بیرونش صفرْ اثر دارد.
