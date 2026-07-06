#!/bin/bash
# استقرارِ سریع — روی سرور اجرا کن:  bash deploy/deploy.sh [branch]
set -e

BRANCH=${1:-main}
BOT_DIR="/home/ubuntu/tabir_khab"
SERVICE="tabir-khab"

echo ">>> شاخه: $BRANCH"
cd "$BOT_DIR"

git fetch origin
git checkout "$BRANCH"
git pull origin "$BRANCH"

.venv/bin/pip install -q -r requirements.txt

sudo systemctl restart "$SERVICE"
sleep 2
sudo systemctl status "$SERVICE" --no-pager | head -20
echo ""
echo ">>> تمام. لاگ زنده:"
tail -f logs/bot.log
