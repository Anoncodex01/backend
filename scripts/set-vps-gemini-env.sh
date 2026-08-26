#!/usr/bin/env bash
# Sets GEMINI_API_KEY on the production VPS and restarts the API container.
# Run from backend/:  ./scripts/set-vps-gemini-env.sh
set -euo pipefail

VPS_HOST="${VPS_HOST:-77.42.23.204}"
VPS_USER="${VPS_USER:-root}"
APP_DIR="${APP_DIR:-/opt/whapvibez}"
API_CONTAINER="${API_CONTAINER:-whapvibez-api}"

if [ -z "${GEMINI_API_KEY:-}" ]; then
  if [ -f .env ] && grep -q '^GEMINI_API_KEY=' .env; then
    GEMINI_API_KEY="$(grep '^GEMINI_API_KEY=' .env | cut -d= -f2-)"
  fi
fi

if [ -z "${GEMINI_API_KEY:-}" ]; then
  echo "Set GEMINI_API_KEY in backend/.env or export it before running."
  exit 1
fi

command -v sshpass >/dev/null || {
  echo "Install sshpass: brew install hudochenkov/sshpass/sshpass"
  exit 1
}

if [ -z "${VPS_PASS:-}" ]; then
  read -rsp "VPS password for ${VPS_USER}@${VPS_HOST}: " VPS_PASS
  echo
fi

SSH="sshpass -p ${VPS_PASS} ssh -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null ${VPS_USER}@${VPS_HOST}"

$SSH "grep -q '^GEMINI_API_KEY=' ${APP_DIR}/.env 2>/dev/null && \
  sed -i 's|^GEMINI_API_KEY=.*|GEMINI_API_KEY=${GEMINI_API_KEY}|' ${APP_DIR}/.env || \
  echo 'GEMINI_API_KEY=${GEMINI_API_KEY}' >> ${APP_DIR}/.env"

$SSH "docker restart ${API_CONTAINER}"
echo "Waiting for API..."
sleep 8
curl -s "https://api.whapvibez.com/v1/shop/products/recommended?limit=2" | head -c 400
echo
