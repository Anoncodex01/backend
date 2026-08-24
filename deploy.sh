#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
#  deploy.sh — one command to push to GitHub and deploy to production.
#
#  Usage:
#    ./deploy.sh                            # auto-generate commit message
#    ./deploy.sh "your commit message"      # custom commit message
#    ./deploy.sh --skip-git                 # deploy to server only (no git push)
#    ./deploy.sh --skip-deploy              # push to GitHub only (no server deploy)
#
#  Requirements (macOS):
#    brew install hudochenkov/sshpass/sshpass
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

# ── Server config ─────────────────────────────────────────────────────────────
VPS_HOST="77.42.23.204"
VPS_USER="root"
VPS_PASS='Whapvibez@@#2025'
APP_DIR="/opt/whapvibez"

# The container names as they exist on the server
API_CONTAINER="whapvibez-api"
NGINX_CONTAINER="whapvibez-nginx"

# Redis lives on this Docker network (created by the original backend compose).
# The new API container must join it so the hostname "redis" resolves.
REDIS_NETWORK="backend_whapvibez-network"

SSH_OPTS="-o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null"

# ── Argument parsing ──────────────────────────────────────────────────────────
COMMIT_MSG=""
SKIP_GIT=false
SKIP_DEPLOY=false

for arg in "$@"; do
  case "$arg" in
    --skip-git)    SKIP_GIT=true ;;
    --skip-deploy) SKIP_DEPLOY=true ;;
    *)
      # anything that doesn't start with -- is treated as the commit message
      if [[ "$arg" != --* ]]; then
        COMMIT_MSG="$arg"
      fi
      ;;
  esac
done

# ── Helpers ───────────────────────────────────────────────────────────────────
step()    { echo ""; echo "──────────────────────────────────────"; echo "▶  $*"; echo "──────────────────────────────────────"; }
ok()      { echo "✅ $*"; }
fail()    { echo ""; echo "❌ ERROR: $*" >&2; exit 1; }

run_ssh() {
  sshpass -p "$VPS_PASS" ssh $SSH_OPTS "$VPS_USER@$VPS_HOST" "$1"
}

scp_item() {
  sshpass -p "$VPS_PASS" scp $SSH_OPTS -r "$1" "$VPS_USER@$VPS_HOST:$2"
}

# Move into the script's directory so relative paths always work
cd "$(dirname "$0")"

# ── Banner ────────────────────────────────────────────────────────────────────
echo ""
echo "╔══════════════════════════════════════════════╗"
echo "║        WhapVibez Backend — Deploy            ║"
echo "╚══════════════════════════════════════════════╝"

# ── Pre-flight checks ─────────────────────────────────────────────────────────
command -v sshpass &>/dev/null || fail "sshpass not found.\n   Install: brew install hudochenkov/sshpass/sshpass"
command -v git     &>/dev/null || fail "git not found."

# ─────────────────────────────────────────────────────────────────────────────
#  STEP 1 — Git: commit & push to GitHub
# ─────────────────────────────────────────────────────────────────────────────
if [ "$SKIP_GIT" = true ]; then
  echo ""
  echo "   --skip-git: skipping GitHub push"
else
  step "STEP 1 — Git commit & push to GitHub"

  if git diff --quiet && git diff --staged --quiet && [ -z "$(git status --porcelain)" ]; then
    echo "   Nothing to commit — working tree is clean."
  else
    # Auto-generate message from changed file names if none provided
    if [ -z "$COMMIT_MSG" ]; then
      CHANGED_FILES=$(git diff --name-only HEAD 2>/dev/null | head -6 | tr '\n' ' ' | sed 's/ $//')
      [ -z "$CHANGED_FILES" ] && CHANGED_FILES="$(git status --porcelain | awk '{print $2}' | head -3 | tr '\n' ' ')"
      COMMIT_MSG="Deploy: ${CHANGED_FILES:-update backend}"
    fi

    git add -A
    git commit -m "$COMMIT_MSG"
    ok "Committed: \"$COMMIT_MSG\""
  fi

  git push origin main
  REPO_URL=$(git remote get-url origin)
  ok "Pushed → $REPO_URL"
fi

# ─────────────────────────────────────────────────────────────────────────────
#  Exit here if --skip-deploy
# ─────────────────────────────────────────────────────────────────────────────
if [ "$SKIP_DEPLOY" = true ]; then
  echo ""
  ok "Done. (--skip-deploy: server deployment skipped)"
  exit 0
fi

# ─────────────────────────────────────────────────────────────────────────────
#  STEP 2 — Sync source files to server via SCP
# ─────────────────────────────────────────────────────────────────────────────
step "STEP 2 — Syncing files to $VPS_HOST:$APP_DIR"

FILES=(src nginx scripts package.json package-lock.json tsconfig.json nest-cli.json Dockerfile docker-compose.yml)
for item in "${FILES[@]}"; do
  if [ -e "$item" ]; then
    echo "   → $item"
    scp_item "$item" "$APP_DIR/"
  fi
done
ok "Files synced"

# ─────────────────────────────────────────────────────────────────────────────
#  STEP 3 — Build Docker image on server
# ─────────────────────────────────────────────────────────────────────────────
step "STEP 3 — Building Docker image on server (~2 min)"
run_ssh "cd $APP_DIR && docker compose build --no-cache api"
ok "Docker image built"

# ─────────────────────────────────────────────────────────────────────────────
#  STEP 4 — Replace API container (stop → remove → start fresh)
#            Using --no-deps so Redis and Nginx are never touched.
# ─────────────────────────────────────────────────────────────────────────────
step "STEP 4 — Replacing API container (zero-downtime swap)"

run_ssh "
  echo '   Stopping old container (if running)...'
  docker stop $API_CONTAINER 2>/dev/null && echo '   Stopped.' || echo '   Was not running.'
  echo '   Removing old container...'
  docker rm   $API_CONTAINER 2>/dev/null && echo '   Removed.'  || echo '   Was not present.'
"

run_ssh "cd $APP_DIR && docker compose up -d --no-deps api"
ok "New API container started"

# ─────────────────────────────────────────────────────────────────────────────
#  STEP 5 — Attach API to Redis network (idempotent — safe to run every time)
#            Redis was started from a different compose project so it sits on
#            "backend_whapvibez-network". The new container must join it so
#            the hostname "redis" resolves correctly inside the API process.
# ─────────────────────────────────────────────────────────────────────────────
step "STEP 5 — Ensuring API can reach Redis ($REDIS_NETWORK)"

run_ssh "
  ALREADY=\$(docker network inspect $REDIS_NETWORK \
    --format '{{range \$k, \$v := .Containers}}{{\$v.Name}} {{end}}' 2>/dev/null \
    | grep -w $API_CONTAINER || true)
  if [ -n \"\$ALREADY\" ]; then
    echo '   Already on $REDIS_NETWORK — nothing to do.'
  else
    docker network connect $REDIS_NETWORK $API_CONTAINER
    echo '   Connected API → $REDIS_NETWORK'
  fi
"
ok "Redis network OK"

# ─────────────────────────────────────────────────────────────────────────────
#  STEP 6 — Reload nginx (picks up any nginx.conf changes without downtime)
# ─────────────────────────────────────────────────────────────────────────────
step "STEP 6 — Reloading nginx"
run_ssh "
  docker exec $NGINX_CONTAINER nginx -t   2>&1 && \
  docker exec $NGINX_CONTAINER nginx -s reload && \
  echo '   nginx reloaded OK'
"
ok "Nginx reloaded"

# ─────────────────────────────────────────────────────────────────────────────
#  STEP 7 — Health check (poll up to 60 seconds)
# ─────────────────────────────────────────────────────────────────────────────
step "STEP 7 — Waiting for API health check (up to 60s)"

HEALTHY=false
for i in $(seq 1 20); do
  sleep 3
  STATUS=$(run_ssh "docker inspect --format '{{.State.Health.Status}}' $API_CONTAINER 2>/dev/null || echo 'starting'")
  printf "   [%2d/20] %s\n" "$i" "$STATUS"
  if [ "$STATUS" = "healthy" ]; then
    HEALTHY=true
    break
  fi
done

echo ""
echo "── Container status ──────────────────────────────"
run_ssh "docker ps --format 'table {{.Names}}\t{{.Status}}\t{{.Image}}' | grep whapvibez || true"
echo ""

# ─────────────────────────────────────────────────────────────────────────────
#  Done
# ─────────────────────────────────────────────────────────────────────────────
if [ "$HEALTHY" = true ]; then
  echo "╔══════════════════════════════════════════════╗"
  echo "║   Deployment complete — API is healthy!      ║"
  echo "╚══════════════════════════════════════════════╝"
else
  echo "╔══════════════════════════════════════════════╗"
  echo "║   Deployment done — container still starting ║"
  echo "║   Run: docker logs $API_CONTAINER            ║"
  echo "╚══════════════════════════════════════════════╝"
fi

echo ""
echo "  API:    https://api.whapvibez.com/v1"
echo "  Health: https://api.whapvibez.com/health"
echo "  Logs:   ssh root@$VPS_HOST 'docker logs -f $API_CONTAINER'"
echo ""
