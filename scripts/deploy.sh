#!/bin/bash

# ================================================
# WhapVibez Deployment Script
# Run from the backend directory
# ================================================

set -e

echo "🚀 Deploying WhapVibez Backend..."

# Configuration
VPS_HOST="77.42.23.204"
VPS_USER="root"
APP_DIR="/opt/whapvibez"

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

log() {
    echo -e "${GREEN}[DEPLOY]${NC} $1"
}

warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

# 1. Build locally (optional - can also build on server)
log "Building Docker image locally for verification..."
docker build -t whapvibez-api:latest . || warn "Local Docker build not available, will build on server"

# 2. Sync files to VPS
log "Syncing files to VPS..."
rsync -avz --exclude 'node_modules' --exclude 'dist' --exclude '.git' \
    ./ ${VPS_USER}@${VPS_HOST}:${APP_DIR}/

# 3. Execute deployment on VPS
log "Executing deployment on VPS..."
ssh ${VPS_USER}@${VPS_HOST} << 'ENDSSH'
    set -e
    cd /opt/whapvibez
    
    echo "📦 Building Docker images..."
    docker-compose build --no-cache
    
    echo "🔄 Restarting services..."
    docker-compose down
    docker-compose up -d
    
    echo "🧹 Cleaning up old images..."
    docker image prune -f
    
    echo "📊 Checking service health..."
    sleep 5
    docker-compose ps
    
    echo "✅ Deployment complete!"
ENDSSH

log "Deployment finished successfully!"
echo ""
echo "🌐 API: https://api.whapvibez.com/v1"
echo "📊 Health: https://api.whapvibez.com/health"

