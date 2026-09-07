#!/usr/bin/env bash
# انتشارِ روزانه‌ی فالِ کانال برای **هر چهار زبان**، از روی خودِ VPS و بدونِ هیچ
# وابستگی به GitHub Actions.
#
# چرا وجود دارد: سقفِ دقیقه‌ی Actions ریپوی خصوصی تمام‌شدنی است و وقتی تمام شود
# هیچ workflow ای اجرا نمی‌شود، پس انتشارِ روزانه هم می‌ایستد (۲۲ تا ۲۶ مرداد ۱۴۰۵
# دقیقاً همین‌طور از دست رفت). VPS نه سقفِ دقیقه دارد، نه به بیلینگِ گیت‌هاب وصل است،
# و از قبل ۲۴ ساعته روشن است. پس مسیرِ بحرانیِ روزانه اینجا می‌نشیند نه آنجا.
#
# نصب: با هر Deploy به‌صورت idempotent در crontab کاربر ubuntu می‌نشیند (deploy.yml).
# اجرا: هر ساعت سرِ دقیقه‌ی ۳۰. خودِ اسکریپت تصمیم می‌گیرد که آیا وقتش هست یا نه.
#
# ⚠️ «۱۰ صبح» per زبان است، نه یک لحظه‌ی مشترک: هر کانال ساعتِ ۱۰ صبحِ **منطقه‌ی
# جغرافیاییِ خودش** منتشر می‌شود، دقیقاً ۱۲ ساعت قبل از یادآوریِ شبانه‌ی ساعت ۲۲ همان
# ربات (`REMINDER_HOUR` در index.js). جدولِ منطقه‌ها همان جدولِ `TZ_BY_LOCALE` ربات است.
#
# سه گاردِ مهم (per زبان و مستقل از هم):
#   ۱) ساعتِ محلی را خودش حساب می‌کند (TZ سرور هرچه باشد فرقی نمی‌کند).
#   ۲) مارکرِ روز per زبان؛ پس اجرای ساعتی هرگز یک روز را دوبار منتشر نمی‌کند.
#   ۳) روزِ بدونِ فایل بی‌صدا رد می‌شود (قرارِ صریحِ مالک: روزِ جامانده جبران نمی‌شود)،
#      ولی کم‌بودنِ بافر جداگانه هشدار می‌دهد تا قبل از خالی‌شدن خبر برسد.

set -uo pipefail

REPO="${REPO_DIR:-$HOME/voice2text}"
STATE="$HOME/.cache/taroot-daypost"
PUBLISH_HOUR=10          # ساعتِ هدف، به وقتِ محلیِ هر زبان
LOW_BUFFER_AT=4          # زیرِ این تعداد روزِ آماده، هشدار می‌رود

# زبان → منطقه‌ی زمانی | فایلِ env | نامِ نمایشیِ کانال
LOCALES=(fa ru pt es)
tz_of()   { case "$1" in fa) echo Asia/Tehran;; ru) echo Europe/Moscow;; pt) echo America/Sao_Paulo;; es) echo America/Mexico_City;; esac; }
env_of()  { case "$1" in fa) echo "$REPO/bots/tarot/.env";; *) echo "$REPO/bots/tarot/.env.$1";; esac; }

mkdir -p "$STATE"
cd "$REPO" 2>/dev/null || { echo "❌ مسیرِ ریپو پیدا نشد: $REPO"; exit 1; }

# تازه‌ترین محتوا را یک بار برای همه بگیر. اگر شبکه/گیت مشکل داشت، با همان چیزی که
# روی دیسک هست ادامه بده (شاید فایلِ امروز از دیپلویِ قبلی آنجا باشد).
git pull --ff-only -q 2>/dev/null || echo "⚠️ git pull نشد؛ با نسخه‌ی روی دیسک ادامه می‌دهم"

# هشدارِ تلگرامی همیشه از رباتِ فارسی می‌رود (مالک آن‌جا را می‌خواند)، حتی وقتی مشکل
# مالِ زبانِ دیگری است؛ وگرنه باید چهار جا را چک کند.
ALERT_ENV="$REPO/bots/tarot/.env"
ALERT_TOKEN=""; ADMINS=""
if [ -f "$ALERT_ENV" ]; then
  ALERT_TOKEN="$(grep -m1 '^BOT_TOKEN=' "$ALERT_ENV" | cut -d= -f2-)"
  ADMINS="$(grep -m1 '^ADMIN_IDS=' "$ALERT_ENV" | cut -d= -f2-)"
fi

tg() {  # tg <متن>
  [ -n "$ALERT_TOKEN" ] && [ -n "$ADMINS" ] || return 0
  local msg="$1" id
  IFS=',' read -ra IDS <<< "$ADMINS"
  for id in "${IDS[@]}"; do
    id="$(echo "$id" | tr -d '[:space:]')"; [ -n "$id" ] || continue
    curl -fsS -X POST "https://api.telegram.org/bot${ALERT_TOKEN}/sendMessage" \
      -d chat_id="$id" --data-urlencode text="$msg" >/dev/null 2>&1 || true
  done
}

LOW_REPORT=""

for LOC in "${LOCALES[@]}"; do
  TZL="$(tz_of "$LOC")"
  TODAY="$(TZ="$TZL" date +%F)"
  HOUR="$(TZ="$TZL" date +%-H)"
  ENV_FILE="$(env_of "$LOC")"

  # زبانی که هنوز .env ندارد (سکرتش ست نشده) اصلاً وجود ندارد؛ بی‌صدا رد شود.
  [ -f "$ENV_FILE" ] || continue
  TOKEN="$(grep -m1 '^BOT_TOKEN=' "$ENV_FILE" | cut -d= -f2-)"
  [ -n "$TOKEN" ] || { echo "⚠️ [$LOC] BOT_TOKEN خالی است؛ رد شد"; continue; }

  DAY_FILE="marketing/tarot/posts/$LOC/${TODAY}-day.json"

  # ——— انتشارِ روز ———
  if [ "$HOUR" -ge "$PUBLISH_HOUR" ] && [ ! -f "$STATE/posted-$LOC-$TODAY" ]; then
    if [ -f "$DAY_FILE" ]; then
      echo "📤 [$LOC] انتشارِ روزِ $TODAY (ساعتِ محلی $HOUR)"
      if TELEGRAM_TOKEN="$TOKEN" node tools/marketing/publish-day.mjs --file "$DAY_FILE"; then
        touch "$STATE/posted-$LOC-$TODAY"
        echo "✅ [$LOC] روزِ $TODAY منتشر شد"
      else
        echo "❌ [$LOC] انتشارِ روزِ $TODAY شکست خورد"
        if [ ! -f "$STATE/failed-$LOC-$TODAY" ]; then
          touch "$STATE/failed-$LOC-$TODAY"
          tg "⚠️ انتشارِ فالِ روزانه شکست خورد — زبانِ $LOC، روزِ $TODAY. لاگ: ~/taroot-daypost.log"
        fi
      fi
    else
      # روزِ جامانده عمداً جبران نمی‌شود؛ فقط یک بار در روز ثبت می‌شود
      [ -f "$STATE/nofile-$LOC-$TODAY" ] || { touch "$STATE/nofile-$LOC-$TODAY"; echo "⏭ [$LOC] فایلِ روزِ $TODAY نیست؛ رد شد"; }
    fi
  fi

  # ——— شمارشِ بافر (روزی یک بار per زبان) ———
  if [ ! -f "$STATE/buffercheck-$LOC-$TODAY" ]; then
    touch "$STATE/buffercheck-$LOC-$TODAY"
    AHEAD=0
    for f in "marketing/tarot/posts/$LOC/"*-day.json; do
      [ -f "$f" ] || continue
      d="$(basename "$f" -day.json)"
      [[ "$d" > "$TODAY" ]] && AHEAD=$((AHEAD+1))
    done
    echo "📦 [$LOC] بافر: $AHEAD روزِ آینده آماده است"
    [ "$AHEAD" -le "$LOW_BUFFER_AT" ] && LOW_REPORT="${LOW_REPORT}
• $LOC: $AHEAD روز"
  fi
done

# یک هشدارِ جمع‌بندی‌شده به‌جای چهار پیامِ جدا (هشدارِ پرتکرار = هشدارِ بی‌معنی)
if [ -n "$LOW_REPORT" ]; then
  tg "📦 بافرِ فالِ کانال رو به اتمام است:${LOW_REPORT}
به Claude بگو «بافر فال رو پر کن»."
fi
