#!/bin/bash
# Run this from your Mac (not on the VPS). It SSHs in and pulls + restarts.
# Usage: ./deploy-on-vps.sh
# You will be prompted for the server password.

set -e
SERVER="77.42.23.204"
USER="root"

echo "Connecting to $USER@$SERVER..."
ssh "$USER@$SERVER" '
  set -e
  cd ~/backend
  echo "Pulling latest from GitHub..."
  git pull origin main
  echo "Restarting services..."
  docker compose up -d --build
  echo "Refreshing nginx upstream..."
  docker compose restart nginx
  echo "Done. API and Nginx restarted."
'
