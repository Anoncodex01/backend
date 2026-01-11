#!/bin/bash
# Commands to push backend changes to GitHub
# Run these commands in your terminal

cd /Users/alvinurio/Desktop/Whapvibez/backend

# Check status
echo "📋 Current status:"
git status --short

echo ""
echo "📦 Adding files..."
git add src/modules/live/live.controller.ts src/modules/live/live.service.ts

echo ""
echo "💾 Committing..."
git commit -m "Add /live/token endpoint for Agora RTC token generation

- Added POST /v1/live/token endpoint in LiveController
- Added generateToken method in LiveService  
- Endpoint generates Agora tokens for both host and viewer roles
- Fixes 404 error when Flutter app requests live streaming tokens"

echo ""
echo "🚀 Pushing to GitHub..."
git push origin main

echo ""
echo "✅ Done! Changes pushed to https://github.com/Anoncodex01/backend"
