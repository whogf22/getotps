#!/bin/bash
set -e

# ============================================
# GetOTPs VPS Setup Script
# Tested on Ubuntu 22.04 / Debian 12
# ============================================

APP_NAME="getotps"
APP_DIR="/opt/$APP_NAME"
APP_USER="getotps"
DOMAIN="${DOMAIN:-your-domain.com}"
NODE_VERSION="20"

echo "========================================="
echo "  GetOTPs VPS Setup"
echo "========================================="

# --- 1. System updates & dependencies ---
echo "[1/7] Updating system packages..."
apt-get update && apt-get upgrade -y
apt-get install -y curl git nginx certbot python3-certbot-nginx ufw

# --- 2. Install Node.js ---
echo "[2/7] Installing Node.js $NODE_VERSION..."
if ! command -v node &> /dev/null; then
    curl -fsSL https://deb.nodesource.com/setup_${NODE_VERSION}.x | bash -
    apt-get install -y nodejs
fi
echo "Node.js $(node -v) installed"

# --- 3. Create app user ---
echo "[3/7] Creating application user..."
if ! id "$APP_USER" &>/dev/null; then
    useradd -r -m -s /bin/bash "$APP_USER"
fi

# --- 4. Set up application directory ---
echo "[4/7] Setting up application directory..."
mkdir -p "$APP_DIR"
if [ -d "/home/user/getotps" ]; then
    rsync -a --exclude='node_modules' --exclude='.git' --exclude='data.db' /home/user/getotps/ "$APP_DIR/"
fi
chown -R "$APP_USER:$APP_USER" "$APP_DIR"

# --- 5. Install dependencies & build ---
echo "[5/7] Installing dependencies and building..."
cd "$APP_DIR"
sudo -u "$APP_USER" npm install
sudo -u "$APP_USER" npm run build
sudo -u "$APP_USER" npm run db:push

# --- 6. Create environment file ---
echo "[6/7] Creating environment configuration..."
if [ ! -f "$APP_DIR/.env" ]; then
    cat > "$APP_DIR/.env" << 'ENVEOF'
# GetOTPs Environment Configuration
# IMPORTANT: Update these values for production!

PORT=5000
NODE_ENV=production

# TellaBot API credentials
TELLABOT_USER=your-tellabot-email@example.com
TELLABOT_API_KEY=your-tellabot-api-key

# Session secret (generate a strong random string)
SESSION_SECRET=CHANGE_ME_TO_A_RANDOM_STRING

ENVEOF
    chown "$APP_USER:$APP_USER" "$APP_DIR/.env"
    chmod 600 "$APP_DIR/.env"
    echo "  -> Created .env file at $APP_DIR/.env"
    echo "  -> IMPORTANT: Edit .env with your actual credentials!"
fi

# --- 7. Install systemd service ---
echo "[7/7] Installing systemd service..."
cp "$APP_DIR/deploy/getotps.service" /etc/systemd/system/getotps.service
systemctl daemon-reload
systemctl enable getotps
systemctl start getotps

echo ""
echo "========================================="
echo "  Setup Complete!"
echo "========================================="
echo ""
echo "Next steps:"
echo "  1. Edit /opt/getotps/.env with your real credentials"
echo "  2. Update DOMAIN in deploy/nginx.conf and install it:"
echo "     cp /opt/getotps/deploy/nginx.conf /etc/nginx/sites-available/getotps"
echo "     ln -s /etc/nginx/sites-available/getotps /etc/nginx/sites-enabled/"
echo "     rm /etc/nginx/sites-enabled/default"
echo "     nginx -t && systemctl reload nginx"
echo "  3. Set up SSL with Let's Encrypt:"
echo "     certbot --nginx -d $DOMAIN"
echo "  4. Configure firewall:"
echo "     ufw allow OpenSSH"
echo "     ufw allow 'Nginx Full'"
echo "     ufw enable"
echo ""
echo "Useful commands:"
echo "  systemctl status getotps     # Check app status"
echo "  journalctl -u getotps -f     # View app logs"
echo "  systemctl restart getotps    # Restart app"
echo ""
