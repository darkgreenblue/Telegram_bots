# Telegram Bots — مونوریپو

خانه‌ی همه‌ی ربات‌های تلگرامِ این مجموعه. هر ربات در پوشه‌ی مستقل خودش زیر `bots/` قرار دارد، با `package.json`، `.env` و دیتابیس `data/` جداگانه — تا پروژه‌ها هرگز با هم قاطی نشوند و هزینه‌ی هرکدام جدا اندازه‌گیری شود.

## ربات‌ها
| پوشه | پروسه‌ی pm2 | توضیح |
|------|------------|-------|
| [`bots/voice2text`](bots/voice2text) | `voice2text` | ویس → متن (Gemini از طریق OpenRouter)، کیف‌پول و پرداخت |
| [`bots/resume-tailor`](bots/resume-tailor) | `resume-tailor` | ساخت رزومه‌ی استاندارد انگلیسیِ کاستومایز برای هر آگهی شغلی |

## ساختار
```
ecosystem.config.cjs   ← تعریف همه‌ی ربات‌ها برای PM2 (cwd هر ربات جدا)
.github/workflows/
  ci.yml               ← چک سینتکس و نصب وابستگی هر ربات (matrix)
  deploy.yml           ← دیپلوی خودکار روی VPS با pm2 (روی push به main)
bots/<name>/           ← هر ربات: index.js, package.json, .env, data/
```

## افزودن یک ربات جدید
1. پوشه‌ی `bots/<name>/` را با `index.js`, `package.json` (ESM, Node ≥ 20) و `.env.example` بسازید.
2. یک اپ به `ecosystem.config.cjs` اضافه کنید:
   ```js
   { name: '<name>', cwd: 'bots/<name>', script: 'index.js' },
   ```
3. نام ربات را به ماتریس `bot:` در `.github/workflows/ci.yml` اضافه کنید.
4. در `deploy.yml` یک بلوک نصب/استارت مشابه `resume-tailor` اضافه کنید (با گارد وجود `.env`).
5. روی VPS فایل `~/voice2text/bots/<name>/.env` را با توکن تلگرام و کلید OpenRouter **مخصوص همان ربات** بسازید.

## دیپلوی
- روی هر push به `main`، workflowِ `Deploy` با SSH به VPS متصل می‌شود، `git pull` می‌کند، وابستگی‌ها را per-bot نصب و با `pm2 startOrReload ecosystem.config.cjs` ربات‌ها را به‌روز می‌کند.
- هر ربات فقط در صورت وجود `.env` خودش روی سرور استارت می‌شود؛ نبودِ `.env` یک ربات، بقیه را تحت تأثیر قرار نمی‌دهد.

> نکته: ریشه‌ی کلون روی VPS به‌دلایل تاریخی `~/voice2text` است (همان مونوریپو).
