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
- `handlers.py` — منطقِ اصلیِ ربات (بله + تلگرام)
- `config.py` — همه‌ی ثابت‌ها و فلگ‌ها (از جمله `FORCE_FALLBACK_FOR_TEST`)
- `db.py` — دیتابیس SQLite (دو فایلِ جدا برای بله و تلگرام)
- `locales/` — متن‌های چندزبانه

## فلگ‌های مهم در config.py
- `FORCE_FALLBACK_FOR_TEST` — وقتی `True`، همه‌ی خواب‌ها از مسیرِ فال‌بک می‌روند (برای تست). بعد از تست باید `False` بشود.
- `SKIP_PAYMENT` — وقتی `True`، پرداخت شبیه‌سازی می‌شود (محیطِ تست).
- `SKIP_DAILY_LIMIT` — وقتی `True`، محدودیتِ روزانه برداشته می‌شود.
