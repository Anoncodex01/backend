#!/usr/bin/env bash
# Apply CORS to the R2 bucket so HLS (.m3u8 / .ts) plays in mobile apps.
# Requires: wrangler CLI logged in, or use Cloudflare dashboard → R2 → bucket → Settings → CORS.
set -euo pipefail

BUCKET="${R2_BUCKET:-whapvibez-media}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if command -v wrangler >/dev/null 2>&1; then
  echo "Applying CORS policy to R2 bucket: ${BUCKET}"
  wrangler r2 bucket cors set "${BUCKET}" --file "${SCRIPT_DIR}/r2-cors-policy.json"
  echo "Done. Verify playback from cdn.whapvibez.com on iOS + Android."
else
  echo "wrangler not installed. Apply ${SCRIPT_DIR}/r2-cors-policy.json manually in Cloudflare R2 → CORS."
fi
