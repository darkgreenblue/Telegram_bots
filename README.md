# Telegram Bots — مونوریپو

خانه‌ی همه‌ی ربات‌های تلگرامِ این مجموعه. هر ربات در پوشه‌ی مستقل خودش زیر `bots/` قرار دارد، با `package.json`، `.env` و دیتابیس `data/` جداگانه — تا پروژه‌ها هرگز با هم قاطی نشوند و هزینه‌ی هرکدام جدا اندازه‌گیری شود.

> 📖 **معماری کامل، زیرساخت استقرار، قرارداد کلیدها و گردش‌کار در [`CLAUDE.md`](CLAUDE.md) مستند شده است. جزئیات هر ربات در `bots/<name>/CLAUDE.md` خودش.**

## مدیریت کلیدها
تک‌منبعِ حقیقت = **GitHub Secrets** (`Settings → Secrets and variables → Actions`). دیپلوی، فایل `.env` هر ربات را روی سرور از روی Secrets می‌سازد. قرارداد: `<BOT>_BOT_TOKEN` و `<BOT>_OPENROUTER_KEY`. کاربر هیچ نیازی به SSH ندارد.

## ربات‌ها
| پوشه | پروسه‌ی pm2 | توضیح |
|------|------------|-------|
| [`bots/voice2text`](bots/voice2text) | `voice2text` | ویس → متن (Gemini از طریق OpenRouter)، کیف‌پول و پرداخت — **زنده و درآمدزا** |
| [`bots/resume-tailor`](bots/resume-tailor) | `resume-tailor` | ساخت رزومه‌ی استاندارد انگلیسیِ کاستومایز برای هر آگهی شغلی |
| [`bots/tarot`](bots/tarot) | `tarot` | فال تاروت فارسی — سفر مشتری تاروت‌خوان حرفه‌ای، کیف‌پول + کارت‌به‌کارت |
| [`bots/tabir-khab`](bots/tabir-khab) | — (systemd) | تعبیر خواب (بله + تلگرام) — پایتون؛ استثنای مونوریپو: venv + systemd به‌جای pm2 |

## ساختار
```
ecosystem.config.cjs   ← تعریف همه‌ی ربات‌ها برای PM2 (cwd هر ربات جدا)
shared/                ← کد مشترک (logger, LLM caller, reset, error handlers) — import نسبی
bots/_template/        ← اسکلت استاندارد ربات جدید
.github/workflows/
  ci.yml               ← نصب + چک سینتکس + تست دود boot هر ربات (matrix)
  deploy.yml           ← دیپلوی انتخابی روی VPS با pm2 (فقط ربات‌های تغییرکرده)
  health.yml           ← پایش سلامت هر ۳۰ دقیقه + Issue + هشدار تلگرام
  ops.yml              ← دیباگ on-demand: status/logs/restart/env-check/db-query
  backup.yml           ← بکاپ شبانه‌ی دیتابیس‌ها به‌عنوان artifact (۳۰ روز)
  tabir-khab-*.yml     ← دیباگ/گزارش ربات tabir-khab (استثنای systemd)
bots/<name>/           ← هر ربات: index.js, package.json, CLAUDE.md, .env, data/
```

## افزودن یک ربات جدید
1. `cp -r bots/_template bots/<name>` و طبق `bots/_template/README.md` کامل کن.
2. یک اپ به `ecosystem.config.cjs` و نام ربات به ماتریس `ci.yml` اضافه کن.
3. در `deploy.yml` بلوک‌های `env`/`write_env`/`deploy_bot` مشابه بقیه اضافه کن.
4. دو Secret بساز: `<NAME>_BOT_TOKEN` و `<NAME>_OPENROUTER_KEY` — `.env` روی سرور خودکار ساخته می‌شود.

چک‌لیست کامل: بند ۵ [`CLAUDE.md`](CLAUDE.md).

## دیپلوی
- روی هر push به `main`، workflow «Deploy» با SSH به VPS متصل می‌شود، `git pull` می‌کند و **فقط ربات‌هایی که تغییر کرده‌اند** را per-bot نصب و reload می‌کند (merge یک ربات، بقیه را ری‌استارت نمی‌کند).
- هر ربات فقط در صورت وجود `.env` خودش استارت می‌شود؛ نبودِ `.env` یک ربات، بقیه را تحت تأثیر قرار نمی‌دهد.
- دیپلوی اجباری همه: اجرای دستی «Deploy» با `force_all=true`.

> نکته: ریشه‌ی کلون روی VPS به‌دلایل تاریخی `~/voice2text` است (همان مونوریپو).
