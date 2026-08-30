#!/usr/bin/env bash
# انتشارِ روزانه‌ی فالِ کانال، **از روی خودِ VPS** و بدونِ هیچ وابستگی به GitHub Actions.
#
# چرا وجود دارد: سقفِ دقیقه‌ی Actions ریپوی خصوصی تمام‌شدنی است و وقتی تمام شود
# هیچ workflow ای اجرا نمی‌شود، پس انتشارِ روزانه هم می‌ایستد (۲۲ تا ۲۶ مرداد ۱۴۰۵
# دقیقاً همین‌طور از دست رفت). VPS نه سقفِ دقیقه دارد، نه به بیلینگِ گیت‌هاب وصل است،
# و از قبل ۲۴ ساعته روشن است. پس مسیرِ بحرانیِ روزانه اینجا می‌نشیند نه آنجا.
#
# نصب: با هر Deploy به‌صورت idempotent در crontab کاربر ubuntu می‌نشیند (deploy.yml).
# اجرا: هر ساعت سرِ دقیقه‌ی ۳۰. خودِ اسکریپت تصمیم می‌گیرد که آیا وقتش هست یا نه.
#
# سه گاردِ مهم:
#   ۱) ساعتِ تهران را خودش حساب می‌کند (TZ سرور هرچه باشد فرقی نمی‌کند).
#   ۲) مارکرِ روز؛ پس اجرای ساعتی هرگز یک روز را دوبار منتشر نمی‌کند.
#   ۳) روزِ بدونِ فایل بی‌صدا رد می‌شود (قرارِ صریحِ مالک: روزِ جامانده جبران نمی‌شود)،
#      ولی کم‌بودنِ بافر جداگانه هشدار می‌دهد تا قبل از خالی‌شدن خبر برسد.

set -uo pipefail

REPO="${REPO_DIR:-$HOME/voice2text}"
STATE="$HOME/.cache/taroot-daypost"
PUBLISH_HOUR=10          # ساعتِ هدف به وقتِ تهران
LOW_BUFFER_AT=4          # زیرِ این تعداد روزِ آماده، هشدار می‌رود

mkdir -p "$STATE"
cd "$REPO" 2>/dev/null || { echo "❌ مسیرِ ریپو پیدا نشد: $REPO"; exit 1; }

TODAY="$(TZ=Asia/Tehran date +%F)"
HOUR="$(TZ=Asia/Tehran date +%-H)"

# هنوز وقتش نشده
[ "$HOUR" -lt "$PUBLISH_HOUR" ] && exit 0
# امروز قبلاً منتشر شده
[ -f "$STATE/posted-$TODAY" ] && exit 0

# تازه‌ترین محتوا را بگیر. اگر شبکه/گیت مشکل داشت، با همان چیزی که هست ادامه بده
# (شاید فایلِ امروز از دیپلویِ قبلی روی دیسک باشد).
git pull --ff-only -q 2>/dev/null || echo "⚠️ git pull نشد؛ با نسخه‌ی روی دیسک ادامه می‌دهم"

ENV_FILE="$REPO/bots/tarot/.env"
[ -f "$ENV_FILE" ] || { echo "❌ .env تاروت نیست: $ENV_FILE"; exit 1; }
TOKEN="$(grep -m1 '^BOT_TOKEN=' "$ENV_FILE" | cut -d= -f2-)"
ADMINS="$(grep -m1 '^ADMIN_IDS=' "$ENV_FILE" | cut -d= -f2-)"
[ -n "$TOKEN" ] || { echo "❌ BOT_TOKEN در .env تاروت خالی است"; exit 1; }

tg() {  # tg <متن>
  [ -n "$ADMINS" ] || return 0
  local msg="$1" id
  IFS=',' read -ra IDS <<< "$ADMINS"
  for id in "${IDS[@]}"; do
    id="$(echo "$id" | tr -d '[:space:]')"; [ -n "$id" ] || continue
    curl -fsS -X POST "https://api.telegram.org/bot${TOKEN}/sendMessage" \
      -d chat_id="$id" --data-urlencode text="$msg" >/dev/null 2>&1 || true
  done
}

DAY_FILE="marketing/tarot/posts/${TODAY}-day.json"
if [ -f "$DAY_FILE" ]; then
  echo "📤 انتشارِ روزِ $TODAY"
  if TELEGRAM_TOKEN="$TOKEN" node tools/marketing/publish-day.mjs --file "$DAY_FILE"; then
    touch "$STATE/posted-$TODAY"
    echo "✅ روزِ $TODAY منتشر شد"
  else
    echo "❌ انتشارِ روزِ $TODAY شکست خورد"
    # فقط یک بار در روز هشدار بده، وگرنه هر ساعت پیام می‌آید
    if [ ! -f "$STATE/failed-$TODAY" ]; then
      touch "$STATE/failed-$TODAY"
      tg "⚠️ انتشارِ فالِ روزانه روی سرور شکست خورد (روزِ $TODAY). لاگ: journalctl یا ~/taroot-daypost.log"
    fi
    exit 1
  fi
else
  # روزِ جامانده عمداً جبران نمی‌شود؛ فقط یک بار در روز ثبت می‌شود
  [ -f "$STATE/nofile-$TODAY" ] || { touch "$STATE/nofile-$TODAY"; echo "⏭ فایلِ روزِ $TODAY نیست؛ رد شد"; }
fi

# ——— هشدارِ کم‌بودنِ بافر (روزی یک بار) ———
if [ ! -f "$STATE/buffercheck-$TODAY" ]; then
  touch "$STATE/buffercheck-$TODAY"
  AHEAD=0
  for f in marketing/tarot/posts/*-day.json; do
    [ -f "$f" ] || continue
    d="$(basename "$f" -day.json)"
    [[ "$d" > "$TODAY" ]] && AHEAD=$((AHEAD+1))
  done
  echo "📦 بافر: $AHEAD روزِ آینده آماده است"
  if [ "$AHEAD" -le "$LOW_BUFFER_AT" ]; then
    tg "📦 بافرِ فالِ کانال رو به اتمام است: فقط $AHEAD روزِ آینده محتوا دارد.
به Claude بگو «بافر فال رو پر کن»."
  fi
fi
