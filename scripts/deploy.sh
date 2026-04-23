#!/bin/bash
set -e
echo "Pulling latest code..."
git pull origin main
echo "Installing dependencies..."
npm install --production
echo "Building..."
npm run build
echo "Checking for provider leaks..."
npm run check:leaks
echo "Restarting service..."
systemctl restart getotps || pm2 restart getotps
echo "Purging CDN cache..."
npm run deploy:purge
echo "Checking live status..."
npm run check:live
echo "✅ Deploy complete. Site is live."
