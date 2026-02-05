#!/bin/bash
# Script to monitor payment and webhook logs

echo "🔍 Monitoring payment logs..."
echo "Press Ctrl+C to stop"
echo ""
echo "=== Watching for webhook calls, payment processing, and errors ==="
echo ""

cd /opt/whapvibez
docker compose logs -f api 2>&1 | grep --line-buffered -E "webhook|Webhook|payment|Payment|wallet|Wallet|coin|Coin|ERROR|error|❌|✅|💰|🔔|📦|🔄" | while read line; do
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] $line"
done
