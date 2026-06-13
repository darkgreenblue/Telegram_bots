# استقرار روی سرور (Ubuntu)

این ربات با long-polling کار می‌کند (نه webhook)، پس فقط به دسترسی اینترنتِ خروجی نیاز دارد؛ نیازی به دامنه/پورتِ باز نیست. هر دو پلتفرم (بله + تلگرام) در یک پروسه اجرا می‌شوند.

## نکته‌ی هم‌زیستی با رباتِ دیگر روی همان سرور
این ربات در پوشه‌ی مستقلِ `/home/ubuntu/tabir_khab`، با venv و `.env` و سرویسِ systemd مستقل (`tabir-khab`) اجرا می‌شود؛ هیچ تداخلی با رباتِ دیگر ندارد (توکن‌ها و env جدا هستند).

## پیش‌نیاز
```bash
sudo apt update
sudo apt install -y python3 python3-venv python3-pip git
```

## استقرار
```bash
cd /home/ubuntu
git clone <REPO_URL> tabir_khab
cd tabir_khab
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt

# ساختِ .env از روی نمونه و پرکردنِ کلیدها
cp .env.example .env
nano .env        # توکن‌ها و کلیدها را بگذار
```

## سرویس systemd
```bash
sudo cp deploy/tabir-khab.service /etc/systemd/system/tabir-khab.service
sudo systemctl daemon-reload
sudo systemctl enable --now tabir-khab
```

## مدیریت
```bash
sudo systemctl status tabir-khab      # وضعیت
journalctl -u tabir-khab -f           # لاگِ زنده‌ی systemd
tail -f /home/ubuntu/tabir_khab/logs/bot.log   # لاگِ فایلیِ برنامه
sudo systemctl restart tabir-khab     # ری‌استارت
```

## به‌روزرسانیِ کد
```bash
cd /home/ubuntu/tabir_khab
git pull
.venv/bin/pip install -r requirements.txt   # اگر requirements عوض شد
sudo systemctl restart tabir-khab
```
