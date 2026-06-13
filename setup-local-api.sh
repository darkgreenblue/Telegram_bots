#!/bin/bash
# Local Telegram Bot API server setup — raises download limit from 20MB to ~2GB.
# Run on the VPS:  bash ~/voice2text/setup-local-api.sh
set -e

APP_DIR="$HOME/voice2text"
ENV_FILE="$APP_DIR/.env"
PORT=8081

# Public api_id/api_hash from the open-source Telegram Desktop client.
# Override by exporting TELEGRAM_API_ID / TELEGRAM_API_HASH before running.
API_ID="${TELEGRAM_API_ID:-2040}"
API_HASH="${TELEGRAM_API_HASH:-b18441a1ff607e10a989891a5462e627}"

echo ""
echo "======================================"
echo "   Local Bot API Server — Setup"
echo "======================================"

# 1) ffmpeg (needed for audio conversion + chunking)
if ! command -v ffmpeg &>/dev/null; then
  echo "▶ Installing ffmpeg..."
  sudo apt-get update -y &>/dev/null
  sudo apt-get install -y ffmpeg &>/dev/null
fi
echo "✅ ffmpeg $(ffmpeg -version | head -1 | awk '{print $3}')"

# 2) Docker
if ! command -v docker &>/dev/null; then
  echo "▶ Installing Docker..."
  curl -fsSL https://get.docker.com | sudo sh &>/dev/null
fi
echo "✅ Docker $(sudo docker --version | awk '{print $3}' | tr -d ,)"

# 3) Swap (1GB RAM server needs breathing room for large files)
if ! sudo swapon --show | grep -q .; then
  echo "▶ Creating 2GB swap..."
  sudo fallocate -l 2G /swapfile 2>/dev/null || sudo dd if=/dev/zero of=/swapfile bs=1M count=2048 &>/dev/null
  sudo chmod 600 /swapfile
  sudo mkswap /swapfile &>/dev/null
  sudo swapon /swapfile
  grep -q '/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab >/dev/null
  echo "✅ Swap enabled"
else
  echo "✅ Swap already present"
fi

# 4) BOT_TOKEN from .env
BOT_TOKEN=$(grep -E '^BOT_TOKEN=' "$ENV_FILE" | cut -d= -f2-)
if [ -z "$BOT_TOKEN" ]; then echo "❌ BOT_TOKEN در $ENV_FILE پیدا نشد"; exit 1; fi

# 5) Stop bot and log it out of the CLOUD Bot API (one-time migration step)
echo "▶ Stopping bot and migrating from cloud to local..."
pm2 stop voice2text &>/dev/null || true
curl -s "https://api.telegram.org/bot${BOT_TOKEN}/logOut" >/dev/null || true
sleep 3

# 6) Start the local Bot API server container
echo "▶ Starting local Bot API server on port ${PORT}..."
sudo docker rm -f telegram-bot-api &>/dev/null || true
sudo docker run -d --name telegram-bot-api --restart unless-stopped \
  -p ${PORT}:8081 \
  -e TELEGRAM_API_ID="${API_ID}" \
  -e TELEGRAM_API_HASH="${API_HASH}" \
  -v telegram-bot-api-data:/var/lib/telegram-bot-api \
  aiogram/telegram-bot-api:latest --local &>/dev/null

# 7) Point the bot at the local server
if grep -q '^TELEGRAM_API_ROOT=' "$ENV_FILE"; then
  sed -i "s|^TELEGRAM_API_ROOT=.*|TELEGRAM_API_ROOT=http://localhost:${PORT}|" "$ENV_FILE"
else
  echo "TELEGRAM_API_ROOT=http://localhost:${PORT}" >> "$ENV_FILE"
fi

# 8) Wait for the server to log in, then restart the bot
echo "▶ Waiting for the API server to come up..."
sleep 10
pm2 restart voice2text --update-env &>/dev/null

echo ""
echo "======================================"
echo "✅ سرور محلی بالا آمد — سقف دانلود حالا ~۲ گیگابایت است."
echo ""
echo "لاگ سرور:  sudo docker logs -f telegram-bot-api"
echo "لاگ ربات:  pm2 logs voice2text"
echo "======================================"
