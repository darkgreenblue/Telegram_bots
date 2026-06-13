# tabir-khab — راهنمای Claude Code

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
