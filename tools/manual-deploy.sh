#!/usr/bin/env bash
# 🛟 دیپلویِ دستی روی خودِ سرور — وقتی GitHub Actions در دسترس نیست.
#
# چرا این فایل هست: در ۲۰ آگوست ۲۰۲۶ کلِ Actionsِ حساب از کار افتاد (بیلینگ) و
# چون تنها مسیرِ رساندنِ کد به سرور همان `deploy.yml` بود، لانچِ آماده روی زمین ماند.
# این اسکریپت همان کاری را می‌کند که جابِ deploy می‌کرد، ولی از داخلِ خودِ سرور.
#
# ── چرا هیچ سکرتی لازم ندارد ──────────────────────────────────────────────────
# دو چیز از قبل روی سرور هستند و این اسکریپت به هیچ‌کدام دست نمی‌زند:
#   • credentialِ گیت (خودِ deploy.yml هم فقط `git pull --ff-only` می‌زند)
#   • فایل‌های `bots/*/.env` (دیپلوی فقط وقتی بازنویسی‌شان می‌کند که Secret ست باشد)
# پس این‌جا نه توکن لازم است نه کلید. همین باعث می‌شود اجرایش از کنسولِ ارائه‌دهنده‌ی
# VPS بی‌خطر باشد: هیچ رازی روی صفحه چاپ نمی‌شود.
#
# ── اجرا ─────────────────────────────────────────────────────────────────────
#   cd ~/voice2text && git pull --ff-only && bash tools/manual-deploy.sh
#
# آرگومان اختیاری: نامِ ربات‌هایی که باید ری‌لود شوند (پیش‌فرض: فقط tarot).
#   bash tools/manual-deploy.sh tarot voice2text
set -euo pipefail

cd "$(dirname "$0")/.."
BOTS=("$@")
[ ${#BOTS[@]} -eq 0 ] && BOTS=(tarot)

echo "📍 $(pwd)  ·  HEAD=$(git rev-parse --short HEAD)"

# ── ۱) مهاجرتِ یک‌باره‌ی موجودیِ تومانی به الماس ──────────────────────────────
# ⚠️ باید **قبل از** بالا آمدنِ کدِ جدید اجرا شود: کدِ جدید همان ستونِ balance را واحدِ
# الماس می‌خواند، پس اگر عقب بیفتد کاربری که ۳۰٬۰۰۰ تومان دارد «۳ الماس» می‌بیند نه ۵.
# ربات عمداً متوقف می‌شود چون اسکریپت اول همه‌ی موجودی‌ها را می‌خواند و بعد می‌نویسد،
# پس یک واریزِ هم‌زمان (کارت شانس، تأییدِ رسید) می‌توانست بینِ خواندن و نوشتن گم شود.
# marker باعث می‌شود اجرای دوباره‌ی این اسکریپت پولِ کسی را دو بار تبدیل نکند.
if [ -f bots/tarot/.env ] && [ ! -f bots/tarot/data/.coin-migration-done ]; then
  echo "💎 مهاجرتِ موجودی به الماس (ربات موقتاً متوقف می‌شود)..."
  pm2 stop tarot 2>/dev/null || true
  if ZERO_USER="409581917" node tools/coin-migration-tarot.mjs bots/tarot/data --apply; then
    echo "✅ مهاجرت انجام شد"
  else
    echo "❌ مهاجرت شکست خورد — ربات را برمی‌گردانم و متوقف می‌شوم"
    pm2 start ecosystem.config.cjs --only tarot 2>/dev/null || true
    exit 1
  fi
else
  echo "⏭ مهاجرت لازم نیست (قبلاً انجام شده یا .env نیست)"
fi

# ── ۲) وابستگی‌ها و ری‌لود ────────────────────────────────────────────────────
for b in "${BOTS[@]}"; do
  if [ ! -f "bots/$b/.env" ]; then
    echo "⏭ bots/$b/.env نیست — $b رد شد"
    continue
  fi
  npm ci --prefix "bots/$b" --omit=dev
  pm2 startOrReload ecosystem.config.cjs --update-env --only "$b"
  echo "✅ $b دیپلوی شد"
done
pm2 save || true

echo
echo "---- وضعیت ----"
pm2 list
echo
echo "🎯 قدمِ بعدی (فقط بعد از تأییدِ چشمیِ وضعیتِ بالا):"
echo "   node tools/announce-tarot.mjs bots/tarot/data          # dry-run"
echo "   node tools/announce-tarot.mjs bots/tarot/data --send   # ارسالِ واقعی"
