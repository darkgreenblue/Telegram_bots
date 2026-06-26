# CLAUDE.md — راهنمای فنی پروژه voice2text

این فایل برای Claude Code نوشته شده و باید در شروع هر سشن خوانده شود.

---

## Admin API Pattern

هر پروژه در این ریپو یک **HTTPS** Admin API دارد که Claude Code می‌تواند از هر سشن به آن وصل شود.
این pattern باید در همه پروژه‌های فعلی و آینده پیاده شود.

> ⚠️ **چرا HTTPS اجباری است:** محیط اجرای Claude Code فقط از طریق یک پروکسیِ HTTPS
> (CONNECT tunnel) به اینترنت دسترسی دارد. HTTP ساده از آن محیط **قابل دسترسی نیست**
> (timeout می‌شود). پس Admin API حتماً باید TLS داشته باشد وگرنه من نمی‌توانم به آن وصل شوم.

### آدرس سرور
```
VPS:       185.204.171.170
Admin API: https://185.204.171.170:3001
```

### احراز هویت
همه درخواست‌ها نیاز به هدر زیر دارند:
```
Authorization: Bearer <ADMIN_API_TOKEN>
```
مقدار `ADMIN_API_TOKEN` در فایل `.env` روی VPS قرار دارد.

### نحوه‌ی اتصال من (Claude) به API
چون cert سلف‌ساین است، باید آن را pin کنم. cert عمومی در ریپو ذخیره شده:
`admin-api-cert.pem` (فقط بخش عمومی — محرمانه نیست).

```bash
# توکن را از کاربر بگیر و در متغیر بذار:
TOKEN="<از کاربر بپرس>"

curl -s --cacert admin-api-cert.pem \
  -H "Authorization: Bearer $TOKEN" \
  https://185.204.171.170:3001/admin/stats | python3 -m json.tool
```

اگر pin با `--cacert admin-api-cert.pem` خطای cert داد (مثلاً پروکسی TLS را
re-terminate کرده)، یک بار با CA باندل پروکسی امتحان کن:
```bash
curl -s --cacert /root/.ccr/ca-bundle.crt -H "Authorization: Bearer $TOKEN" \
  https://185.204.171.170:3001/admin/stats
```

---

## Endpoints

> در مثال‌ها `--cacert admin-api-cert.pem` و هدر توکن لازم است (برای اختصار حذف شده).

### `GET /admin/stats`
آمار کلی: تعداد کاربران، کاربران فعال امروز، درآمد امروز/کل، تعداد و مدت و هزینه کل پردازش‌ها.

### `GET /admin/users`
لیست همه کاربران با: آیدی تلگرام، نام، یوزرنیم، موجودی، مدل، تعداد پردازش، هزینه کل، دقیقه‌ی کل.

### `GET /admin/users/:id`
جزئیات یک کاربر خاص + ۵۰ پردازش اخیر + ۲۰ پرداخت اخیر.
```bash
curl -s --cacert admin-api-cert.pem -H "Authorization: Bearer $TOKEN" \
  https://185.204.171.170:3001/admin/users/100257975 | python3 -m json.tool
```

### `POST /admin/users/:id/credit`
شارژ کیف پول (مبلغ به تومان).
```bash
curl -s --cacert admin-api-cert.pem -X POST \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"amount": 50000}' \
  https://185.204.171.170:3001/admin/users/123456789/credit | python3 -m json.tool
```

### `POST /admin/users/:id/deduct`
کسر از کیف پول (مبلغ به تومان). همان فرمت بالا با endpoint `/deduct`.

### `GET /admin/payments?status=pending&limit=50`
لیست پرداخت‌ها. پارامترها: `status` (pending/approved/cancelled)، `limit` (max 200).

### `GET /admin/flows?status=active&limit=50`
لیست فلوهای پردازش صوتی. وضعیت‌ها: `active`, `completed`, `cancelled`, `failed`, `expired`.

---

## راه‌اندازی اولیه (one-time setup روی VPS)

```bash
cd ~/voice2text

# ۱. ساخت توکن تصادفی قوی
echo "ADMIN_API_TOKEN=$(openssl rand -hex 32)" >> .env

# ۲. ساخت گواهی self-signed با SAN روی IP سرور (اعتبار ۱۰ سال)
openssl req -x509 -newkey rsa:2048 -nodes \
  -keyout data/admin-api-key.pem -out data/admin-api-cert.pem \
  -days 3650 -subj "/CN=185.204.171.170" \
  -addext "subjectAltName=IP:185.204.171.170"

# ۳. مسیر گواهی‌ها در .env
echo "ADMIN_API_CERT=$HOME/voice2text/data/admin-api-cert.pem" >> .env
echo "ADMIN_API_KEY=$HOME/voice2text/data/admin-api-key.pem"   >> .env

# ۴. باز کردن پورت در فایروال
sudo ufw allow 3001/tcp comment "voice2text admin api"

# ۵. ری‌استارت ربات
pm2 restart voice2text && pm2 logs voice2text --lines 5

# ۶. تست محلی (روی خود سرور)
TOKEN=$(grep ADMIN_API_TOKEN .env | cut -d= -f2)
curl -sk -H "Authorization: Bearer $TOKEN" https://localhost:3001/admin/stats

# ۷. محتوای cert عمومی را به Claude بده تا در ریپو ذخیره کند:
cat data/admin-api-cert.pem
```

> `data/admin-api-key.pem` (کلید خصوصی) هرگز نباید از سرور خارج یا commit شود.
> فولدر `data/` در `.gitignore` است. فقط بخش **عمومی** cert در ریپو ذخیره می‌شود
> (`admin-api-cert.pem` در ریشه‌ی پروژه) تا من بتوانم pin کنم.

---

## متغیرهای محیطی

| متغیر | پیش‌فرض | توضیح |
|---|---|---|
| `ADMIN_API_TOKEN` | — | اجباری. توکن Bearer |
| `ADMIN_API_CERT` | — | اجباری. مسیر cert عمومی (PEM) |
| `ADMIN_API_KEY` | — | اجباری. مسیر کلید خصوصی (PEM) |
| `ADMIN_API_PORT` | `3001` | پورت HTTPS |
| `BOT_TOKEN` | — | توکن ربات تلگرام |
| `OPENROUTER_API_KEY` | — | کلید API مدل‌های زبانی |
| `NOTION_TOKEN` | — | توکن integration نوشن (اختیاری) |

اگر هر سه متغیر `ADMIN_API_TOKEN`/`ADMIN_API_CERT`/`ADMIN_API_KEY` ست نباشند، Admin API غیرفعال می‌شود.

---

## اضافه کردن به پروژه جدید

۱. بخش `/* ===== Admin API ===== */` را از `index.js` این پروژه کپی کن
۲. `import https from 'https'` را به ابتدای فایل اضافه کن
۳. Query های مربوط به DB را با schema پروژه جدید تطبیق بده
۴. setup سرور را اجرا کن (توکن + cert + پورت در فایروال)
۵. cert عمومی را در ریپوی آن پروژه ذخیره کن و در CLAUDE.md همان پروژه مستند کن

---

## معماری پروژه

```
index.js              — تمام منطق ربات (single-file)
admin-api-cert.pem    — گواهی عمومی Admin API (برای pin کردن؛ محرمانه نیست)
data/bot.db           — SQLite database (WAL mode)  [gitignored]
data/admin-api-*.pem  — cert/key سرور  [gitignored — key هرگز commit نشود]
.env                  — متغیرهای محیطی (روی VPS، در ریپو نیست)
.github/workflows/
  ci.yml              — چک سینتکس (node --check)
  deploy.yml          — deploy خودکار به VPS بعد از merge به main
```

### جداول DB
- `users` — کاربران (telegram_id, balance, model, ...)
- `usage_log` — لاگ هر پردازش (model, duration_sec, cost, type, success, ...)
- `payments` — تراکنش‌های شارژ کیف پول (status: pending/approved/cancelled)
- `voice_flows` — فلوهای پردازش صوتی با وضعیت
- `discount_codes` / `discount_uses` — سیستم کد تخفیف
- `pro_whitelist` — کاربران با دسترسی به مدل‌های پیشرفته

---

## نکات مهم توسعه

- **سشن‌ها** (`sessions` Map): در حافظه، نگه‌دارنده‌ی `audioBuffer` تا کاربر حالت پردازش انتخاب کند. TTL: ۱۵ دقیقه.
- **فلوهای همزمان**: حداکثر ۲ فلو فعال per user. اسلات synchronously رزرو می‌شود تا race condition نباشد.
- **OWNER_ID=100257975**: برای integration نوشن. مستقل از `ADMIN_IDS`.
- **Meeting bump**: صورت جلسه همیشه حداقل با `google/gemini-2.5-flash` پردازش می‌شود.
- **ffprobe**: برای تشخیص مدت داکیومنت‌های صوتی که تلگرام duration ندارد.
- **deploy**: فقط push به `main` → GitHub Actions → ssh به VPS → git pull + npm ci + pm2 restart.
- **دسترسی من (Claude)**: فقط از طریق HTTPS Admin API. SSH و HTTP ساده از محیط من کار نمی‌کنند.
