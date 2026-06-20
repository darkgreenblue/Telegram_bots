# tabir-khab — راهنمای Claude Code

## قانون کار با این پروژه (همیشه رعایت کن)

هر تغییری که commit و push می‌کنی، **بلافاصله** باید مرج و دیپلوی هم بشه — بدون اینکه صاحب پروژه جداگانه بگه.
جریان استاندارد برای هر PR:
1. commit + push به branch
2. PR بساز (draft)
3. **بلافاصله squash-merge به main** (نیازی به تأیید جداگانه نیست)
4. **دیپلوی خودکار است** — همین مرج به `main` کافی است.

> دلیل: پروژه در مرحله‌ی تست شخصی است، کاربر فعال ندارد، و صاحب پروژه می‌خواهد هر تغییر را فوری روی سرور ببیند.

### دیپلوی چطور کار می‌کند (مهم — وقت SSH دستی تلف نکن)
دیپلوی **کاملاً خودکار** است از طریق GitHub Action در `.github/workflows/deploy.yml`.
هر `push` به `main` (یا به برنچِ فعال) خودش runnerِ گیت‌هاب را وادار می‌کند که به سرور SSH بزند و
`git pull` + `pip install` + `systemctl restart tabir-khab` را اجرا کند. کلیدِ SSH به‌صورتِ
secretهای `SSH_HOST` و `SSH_PRIVATE_KEY` در خودِ گیت‌هاب ذخیره است.

- **خودت از این محیط SSH نزن** — پورت ۲۲ از محیطِ ابریِ Claude بسته است و کلیدی هم اینجا نیست.
  SSH دستی timeout می‌خورد. لازم هم نیست.
- برای دیپلوی فقط **به `main` مرج کن**، بعد با `actions_list` رویِ `deploy.yml` مطمئن شو
  آخرین run با `conclusion: success` تمام شده — همان یعنی ربات روی سرور آپدیت شد.

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
cd /home/ubuntu/tabir_khab && git pull     # کشیدن کدِ جدید
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
