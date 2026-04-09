#!/bin/bash
set -e

# ============================================================
# GetOTPs — One-Shot VPS Deployment Script
# Run this ON the VPS after cloning the repo:
#   cd /var/www/getotps && chmod +x deploy.sh && ./deploy.sh
#
# After deploy:
#   1. Edit .env with your real credentials: nano .env
#   2. Restart: pm2 restart getotps
#   3. Point DNS to this server's IP
#   4. Add SSL: certbot --nginx -d getotps.com -d www.getotps.com
# ============================================================

APP_DIR="$(cd "$(dirname "$0")" && pwd)"
APP_NAME="getotps"

echo "============================================"
echo "  GetOTPs Deployment — Starting"
echo "  Directory: $APP_DIR"
echo "============================================"

# --- 1. System packages ---
echo ""
echo "[1/8] Installing system packages..."
apt-get update -qq
apt-get install -y -qq build-essential python3 nginx git curl > /dev/null 2>&1
echo "  ✓ build-essential, python3, nginx, git installed"

# --- 2. Node.js via nvm ---
echo ""
echo "[2/8] Installing Node.js 20..."
export NVM_DIR="/root/.nvm"
if [ ! -d "$NVM_DIR" ]; then
  curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.0/install.sh 2>/dev/null | bash > /dev/null 2>&1
fi
[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"
nvm install 20 > /dev/null 2>&1
nvm use 20 > /dev/null 2>&1
nvm alias default 20 > /dev/null 2>&1
echo "  ✓ Node $(node -v) installed"

# Ensure nvm loads on login
if ! grep -q 'NVM_DIR' /root/.bashrc 2>/dev/null; then
  cat >> /root/.bashrc << 'BASHEOF'
export NVM_DIR="/root/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"
BASHEOF
fi

# --- 3. PM2 ---
echo ""
echo "[3/8] Installing PM2..."
npm install -g pm2 > /dev/null 2>&1
echo "  ✓ PM2 $(pm2 -v) installed"

# --- 4. Build app ---
echo ""
echo "[4/8] Installing dependencies and building..."
cd "$APP_DIR"
npm install --omit=dev > /dev/null 2>&1
# Need dev deps for build, install all then prune after
npm install > /dev/null 2>&1
npm run build
echo "  ✓ App built successfully"

# --- 5. Create .env ---
echo ""
echo "[5/8] Creating .env file..."
if [ -f "$APP_DIR/.env" ]; then
  echo "  ⚠ .env already exists — skipping (not overwriting)"
else
  SESSION_SECRET=$(openssl rand -hex 32)
  cat > "$APP_DIR/.env" << ENVEOF
# ========== APP ==========
NODE_ENV=production
PORT=5000
APP_URL=http://YOUR_DOMAIN_HERE

# ========== SESSION ==========
SESSION_SECRET=${SESSION_SECRET}

# ========== DATABASE ==========
DATABASE_PATH=${APP_DIR}/data.db

# ========== TELLABOT SMS API ==========
TELLABOT_USER=CHANGE_ME
TELLABOT_API_KEY=CHANGE_ME
TELLABOT_MARKUP=1.5

# ========== ADMIN SEED ==========
ADMIN_EMAIL=admin@getotps.com
ADMIN_PASSWORD=CHANGE_ME_STRONG_PASSWORD
ADMIN_USERNAME=admin

# ========== CRYPTO WALLET ADDRESSES ==========
CRYPTO_WALLET_BTC=CHANGE_ME
CRYPTO_WALLET_ETH=CHANGE_ME
CRYPTO_WALLET_USDT_TRC20=CHANGE_ME
CRYPTO_WALLET_USDT_ERC20=CHANGE_ME
CRYPTO_WALLET_USDC=CHANGE_ME
CRYPTO_WALLET_LTC=CHANGE_ME

# ========== CRYPTO RATES (USD per coin) ==========
CRYPTO_RATE_BTC=84250.00
CRYPTO_RATE_ETH=3420.00
CRYPTO_RATE_USDT=1.00
CRYPTO_RATE_USDC=1.00
CRYPTO_RATE_LTC=92.50

# ========== TRONGRID (USDT TRC20 auto-deposit) ==========
TRONGRID_API_KEY=CHANGE_ME
TRON_MASTER_WALLET=CHANGE_ME
USDT_CONTRACT_ADDRESS=TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t
DEPOSIT_POLL_INTERVAL_MS=30000
ENVEOF
  chmod 600 "$APP_DIR/.env"
  echo "  ✓ .env created with auto-generated SESSION_SECRET"
  echo "  ⚠ IMPORTANT: Edit .env with your real credentials before using!"
fi

# --- 6. Start with PM2 ---
echo ""
echo "[6/8] Starting app with PM2..."
cd "$APP_DIR"
pm2 delete "$APP_NAME" 2>/dev/null || true
pm2 start dist/index.cjs --name "$APP_NAME" --env production
pm2 save
pm2 startup systemd -u root --hp /root 2>/dev/null | tail -1 | bash 2>/dev/null || true
echo "  ✓ App running on port 5000"

# --- 7. Configure Nginx ---
echo ""
echo "[7/8] Configuring Nginx..."
cat > /etc/nginx/sites-available/$APP_NAME << 'NGINXEOF'
server {
    listen 80;
    server_name getotps.com www.getotps.com _;

    client_max_body_size 10M;

    location / {
        proxy_pass http://127.0.0.1:5000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
        proxy_read_timeout 90;
    }

    location /assets/ {
        proxy_pass http://127.0.0.1:5000;
        expires 30d;
        add_header Cache-Control "public, immutable";
    }
}
NGINXEOF

ln -sf /etc/nginx/sites-available/$APP_NAME /etc/nginx/sites-enabled/
rm -f /etc/nginx/sites-enabled/default

if nginx -t 2>/dev/null; then
  systemctl reload nginx
  echo "  ✓ Nginx configured and reloaded"
else
  echo "  ✗ Nginx config test failed — check /etc/nginx/sites-available/$APP_NAME"
  nginx -t
fi

# --- 8. Backup cron ---
echo ""
echo "[8/8] Setting up daily database backup..."
mkdir -p "$APP_DIR/backups"

cat > "$APP_DIR/backup.sh" << BACKUPEOF
#!/bin/bash
BACKUP_DIR="${APP_DIR}/backups"
mkdir -p "\$BACKUP_DIR"
DATE=\$(date +%Y%m%d_%H%M%S)
sqlite3 "${APP_DIR}/data.db" ".backup \$BACKUP_DIR/getotps_\$DATE.db"
ls -t "\$BACKUP_DIR"/*.db 2>/dev/null | tail -n +31 | xargs rm -f 2>/dev/null
BACKUPEOF
chmod +x "$APP_DIR/backup.sh"

# Add cron if not already present
CRON_CMD="0 3 * * * ${APP_DIR}/backup.sh"
(crontab -l 2>/dev/null | grep -v "$APP_DIR/backup.sh"; echo "$CRON_CMD") | crontab -
echo "  ✓ Daily backup at 3:00 AM (keeps last 30)"

# --- Done ---
echo ""
echo "============================================"
echo "  GetOTPs Deployment — Complete!"
echo "============================================"
echo ""
echo "  App:     http://$(curl -s ifconfig.me 2>/dev/null || echo 'YOUR_SERVER_IP'):80"
echo "  PM2:     pm2 status / pm2 logs $APP_NAME"
echo "  Nginx:   systemctl status nginx"
echo ""
echo "  NEXT STEPS:"
echo "  1. Edit credentials:  nano $APP_DIR/.env"
echo "  2. Restart app:       pm2 restart $APP_NAME"
echo "  3. Point DNS to this server"
echo "  4. Add SSL:           apt install certbot python3-certbot-nginx"
echo "                        certbot --nginx -d getotps.com -d www.getotps.com"
echo ""
echo "  UPDATE WORKFLOW:"
echo "    cd $APP_DIR && git pull && npm install && npm run build && pm2 restart $APP_NAME"
echo ""
