#!/bin/bash

# ================================================
# WhapVibez VPS Setup Script
# Run this on a fresh Ubuntu 22.04 VPS
# ================================================

set -e

echo "╔═══════════════════════════════════════════════════════════╗"
echo "║           WhapVibez VPS Setup Script                      ║"
echo "╚═══════════════════════════════════════════════════════════╝"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Functions
log_info() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

log_warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Check if running as root
if [ "$EUID" -ne 0 ]; then
    log_error "Please run as root (sudo ./setup-vps.sh)"
    exit 1
fi

# 1. Update system
log_info "Updating system packages..."
apt update && apt upgrade -y

# 2. Install essential packages
log_info "Installing essential packages..."
apt install -y \
    curl \
    wget \
    git \
    vim \
    htop \
    ufw \
    fail2ban \
    unzip \
    software-properties-common \
    apt-transport-https \
    ca-certificates \
    gnupg \
    lsb-release

# 3. Install Docker
log_info "Installing Docker..."
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | gpg --dearmor -o /usr/share/keyrings/docker-archive-keyring.gpg

echo \
  "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/docker-archive-keyring.gpg] https://download.docker.com/linux/ubuntu \
  $(lsb_release -cs) stable" | tee /etc/apt/sources.list.d/docker.list > /dev/null

apt update
apt install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin

# Start and enable Docker
systemctl start docker
systemctl enable docker

# 4. Install Docker Compose
log_info "Installing Docker Compose..."
DOCKER_COMPOSE_VERSION="2.24.0"
curl -L "https://github.com/docker/compose/releases/download/v${DOCKER_COMPOSE_VERSION}/docker-compose-$(uname -s)-$(uname -m)" -o /usr/local/bin/docker-compose
chmod +x /usr/local/bin/docker-compose

# 5. Configure firewall
log_info "Configuring firewall..."
ufw default deny incoming
ufw default allow outgoing
ufw allow ssh
ufw allow 80/tcp
ufw allow 443/tcp
ufw allow 3000/tcp  # API (temporary, remove in production)
ufw --force enable

# 6. Configure fail2ban
log_info "Configuring fail2ban..."
systemctl start fail2ban
systemctl enable fail2ban

# 7. Create app directory
log_info "Creating application directory..."
mkdir -p /opt/whapvibez
cd /opt/whapvibez

# 8. Install Certbot for SSL
log_info "Installing Certbot for SSL certificates..."
apt install -y certbot python3-certbot-nginx

# 9. Create deploy user
log_info "Creating deploy user..."
if ! id "deploy" &>/dev/null; then
    useradd -m -s /bin/bash deploy
    usermod -aG docker deploy
    mkdir -p /home/deploy/.ssh
    cp /root/.ssh/authorized_keys /home/deploy/.ssh/ 2>/dev/null || true
    chown -R deploy:deploy /home/deploy/.ssh
    chmod 700 /home/deploy/.ssh
    chmod 600 /home/deploy/.ssh/authorized_keys 2>/dev/null || true
fi

# Give deploy user ownership of app directory
chown -R deploy:deploy /opt/whapvibez

# 10. Print next steps
echo ""
echo "╔═══════════════════════════════════════════════════════════╗"
echo "║              Setup Complete! Next Steps:                  ║"
echo "╠═══════════════════════════════════════════════════════════╣"
echo "║                                                           ║"
echo "║  1. Copy your backend code to /opt/whapvibez              ║"
echo "║                                                           ║"
echo "║  2. Create .env file with your secrets:                   ║"
echo "║     cp .env.example .env && vim .env                      ║"
echo "║                                                           ║"
echo "║  3. Get SSL certificate:                                  ║"
echo "║     certbot certonly --standalone -d api.whapvibez.com    ║"
echo "║                                                           ║"
echo "║  4. Start the application:                                ║"
echo "║     docker-compose up -d                                  ║"
echo "║                                                           ║"
echo "║  5. Check logs:                                           ║"
echo "║     docker-compose logs -f                                ║"
echo "║                                                           ║"
echo "║  IMPORTANT: Change root password!                         ║"
echo "║     passwd                                                ║"
echo "║                                                           ║"
echo "╚═══════════════════════════════════════════════════════════╝"
echo ""

log_info "VPS setup completed successfully!"

