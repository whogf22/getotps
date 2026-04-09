#!/bin/bash
set -e

# ============================================
# GetOTPs Deployment Script
# Run this to deploy updates to your VPS
# ============================================

APP_DIR="/opt/getotps"
APP_USER="getotps"

echo "Deploying GetOTPs update..."

cd "$APP_DIR"

# Pull latest code
echo "[1/4] Pulling latest code..."
sudo -u "$APP_USER" git pull origin master

# Install dependencies
echo "[2/4] Installing dependencies..."
sudo -u "$APP_USER" npm install

# Build
echo "[3/4] Building application..."
sudo -u "$APP_USER" npm run build
sudo -u "$APP_USER" npm run db:push

# Restart service
echo "[4/4] Restarting service..."
systemctl restart getotps

echo ""
echo "Deployment complete! Checking status..."
sleep 2
systemctl status getotps --no-pager
