#!/bin/bash
# Push only this backend folder to its own GitHub repo.
# 1. Create a NEW empty repo on GitHub (e.g. whapvibez-backend).
# 2. Set BACKEND_REPO_URL below to your repo URL, then run: ./push-to-github.sh

set -e
cd "$(dirname "$0")"

# Replace with your GitHub repo URL (HTTPS or SSH), e.g.:
# BACKEND_REPO_URL="https://github.com/YOUR_USERNAME/whapvibez-backend.git"
# or: BACKEND_REPO_URL="git@github.com:YOUR_USERNAME/whapvibez-backend.git"
BACKEND_REPO_URL="${BACKEND_REPO_URL:-}"

if [ -z "$BACKEND_REPO_URL" ]; then
  echo "Usage:"
  echo "  export BACKEND_REPO_URL='https://github.com/YOUR_USERNAME/whapvibez-backend.git'"
  echo "  ./push-to-github.sh"
  echo ""
  echo "Or edit this script and set BACKEND_REPO_URL, then run ./push-to-github.sh"
  exit 1
fi

if [ ! -d .git ]; then
  git init
  git add .
  git commit -m "Initial commit: Whapvibez backend"
fi

if ! git remote get-url origin 2>/dev/null; then
  git remote add origin "$BACKEND_REPO_URL"
else
  git remote set-url origin "$BACKEND_REPO_URL"
fi

git branch -M main
git push -u origin main

echo "Done. Backend pushed to $BACKEND_REPO_URL"
