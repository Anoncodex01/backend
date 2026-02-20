#!/bin/bash

# Deploy backend to production server
# This script will sync files and rebuild Docker

set -e

VPS_HOST="77.42.23.204"
VPS_USER="root"
VPS_PASS="Whapvibez@@#2025"
APP_DIR="/opt/whapvibez"

echo "🚀 Deploying backend to production server..."

# Install sshpass if not available (macOS: brew install hudochenkov/sshpass/sshpass)
if ! command -v sshpass &> /dev/null; then
    echo "❌ sshpass not found. Please install it:"
    echo "   macOS: brew install hudochenkov/sshpass/sshpass"
    echo "   Linux: sudo apt-get install sshpass"
    exit 1
fi

# Function to run command on server
run_on_server() {
    sshpass -p "$VPS_PASS" ssh -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null "$VPS_USER@$VPS_HOST" "$1"
}

echo ""
echo "📦 Step 1: Syncing files to server (SCP)..."
SSH_OPTS="-o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null"
for item in src nginx package.json package-lock.json tsconfig.json nest-cli.json Dockerfile docker-compose.yml; do
  if [ -e "$item" ]; then
    echo "   Syncing $item..."
    sshpass -p "$VPS_PASS" scp $SSH_OPTS -r "$item" "$VPS_USER@$VPS_HOST:$APP_DIR/"
  fi
done

echo ""
echo "🔨 Step 2: Building Docker image on server..."
run_on_server "cd $APP_DIR && docker compose build --no-cache api"

echo ""
echo "🔄 Step 3: Restarting API container..."
run_on_server "cd $APP_DIR && docker compose up -d api"

echo ""
echo "⏳ Waiting for container to start..."
sleep 5

echo ""
echo "📊 Step 4: Checking container status..."
run_on_server "cd $APP_DIR && docker compose ps api"

echo ""
echo "✅ Deployment complete!"
echo ""
echo "🌐 API: https://api.whapvibez.com/v1"
echo "📊 Health: https://api.whapvibez.com/health"
echo ""
echo "🧪 Test the endpoint:"
echo "   curl -X POST https://api.whapvibez.com/v1/live/token \\"
echo "     -H 'Content-Type: application/json' \\"
echo "     -H 'Authorization: Bearer YOUR_TOKEN' \\"
echo "     -d '{\"channelName\":\"test\",\"isHost\":true}'"
