#!/bin/bash
set -e

echo ""
echo "======================================"
echo "   Voice2Text Bot — Setup Script"
echo "======================================"
echo ""

# Node.js 20
if ! command -v node &>/dev/null || [[ $(node -v | cut -d. -f1 | tr -d v) -lt 20 ]]; then
  echo "▶ Installing Node.js 20..."
  curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash - &>/dev/null
  sudo apt install -y nodejs &>/dev/null
  echo "✅ Node.js $(node -v) installed"
else
  echo "✅ Node.js $(node -v) already installed"
fi

# PM2
if ! command -v pm2 &>/dev/null; then
  echo "▶ Installing PM2..."
  sudo npm install -g pm2 &>/dev/null
  echo "✅ PM2 installed"
else
  echo "✅ PM2 already installed"
fi

# Clone or update repo
REPO_URL="https://github.com/darkgreenblue/voice2text.git"
APP_DIR="$HOME/voice2text"

if [ -d "$APP_DIR" ]; then
  echo "▶ Updating existing repo..."
  git -C "$APP_DIR" pull --ff-only
else
  echo "▶ Cloning repo..."
  git clone "$REPO_URL" "$APP_DIR"
fi

cd "$APP_DIR"

# Install dependencies
echo "▶ Installing npm packages..."
npm install --omit=dev &>/dev/null
echo "✅ Packages installed"

# Env file
if [ ! -f .env ]; then
  echo ""
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo "  لطفاً مقادیر زیر را وارد کنید:"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  read -rp "BOT_TOKEN: " BOT_TOKEN
  read -rp "GEMINI_API_KEY: " GEMINI_API_KEY
  read -rp "OPENROUTER_API_KEY (اگه ندارید Enter بزنید): " OPENROUTER_API_KEY

  cat > .env <<EOF
BOT_TOKEN=${BOT_TOKEN}
GEMINI_API_KEY=${GEMINI_API_KEY}
OPENROUTER_API_KEY=${OPENROUTER_API_KEY}
EOF
  echo "✅ .env ساخته شد"
else
  echo "✅ .env از قبل وجود دارد"
fi

# Start / restart with PM2
pm2 describe voice2text &>/dev/null && pm2 restart voice2text || pm2 start index.js --name voice2text
pm2 save &>/dev/null

# Auto-start on reboot
STARTUP_CMD=$(pm2 startup 2>&1 | grep "sudo" | tail -1)
if [ -n "$STARTUP_CMD" ]; then
  eval "$STARTUP_CMD" &>/dev/null
fi

echo ""
echo "======================================"
echo "✅ ربات با موفقیت راه‌اندازی شد!"
echo ""
echo "برای دیدن لاگ: pm2 logs voice2text"
echo "برای وضعیت:    pm2 status"
echo "======================================"
