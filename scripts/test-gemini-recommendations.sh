#!/usr/bin/env bash
# Test Gemini embedding + shop recommendations endpoint locally or on production.
# Usage:
#   export GEMINI_API_KEY=your_key
#   ./scripts/test-gemini-recommendations.sh
#   API_BASE=https://api.whapvibez.com/v1 ./scripts/test-gemini-recommendations.sh

set -euo pipefail

API_BASE="${API_BASE:-http://localhost:3000/v1}"

echo "== Health =="
curl -s "${API_BASE}/health" | head -c 300
echo -e "\n"

if [ -n "${GEMINI_API_KEY:-}" ]; then
  echo "== Gemini embed (text-embedding-004) =="
  curl -s -X POST \
    "https://generativelanguage.googleapis.com/v1beta/models/text-embedding-004:embedContent?key=${GEMINI_API_KEY}" \
    -H "Content-Type: application/json" \
    -d '{"model":"models/text-embedding-004","content":{"parts":[{"text":"gaming accessories Tanzania"}]}}' \
    | head -c 220
  echo -e "\n"
else
  echo "⚠️  Set GEMINI_API_KEY to test Gemini embed"
fi

echo "== Shop recommendations =="
curl -s "${API_BASE}/shop/products/recommended?limit=3" | head -c 600
echo
