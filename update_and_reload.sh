#!/bin/bash
# Run this script ON THE SERVER after syncing/pushing the latest nginx config
# Or SSH in and run the commands manually

set -e

APP_DIR="/opt/whapvibez"
cd "$APP_DIR"

echo "📥 Pulling latest backend (if using git)..."
if [ -d .git ]; then
  git pull origin main || git pull origin master || true
fi

echo "🔄 Reloading nginx with new config..."
docker exec whapvibez-nginx nginx -t && docker exec whapvibez-nginx nginx -s reload

echo "✅ Nginx reloaded successfully!"
echo ""
echo "If nginx config was updated via rsync/deploy, the new config is already in place."
echo "The reload applies it without downtime."
