#!/bin/bash
set -e
APP_DIR="${APP_DIR:-$(pwd)}"
cd "$APP_DIR"

echo "Pulling latest code..."
git pull origin main

echo "Running Drizzle schema push (set DATABASE_URL)..."
npx drizzle-kit push --force

echo "Installing dependencies..."
npm ci

echo "Building client + server + worker..."
npm run build

echo "Pruning devDependencies..."
npm prune --omit=dev

echo "Checking for provider leaks..."
npm run check:leaks

echo "Restarting web + worker..."
if command -v pm2 >/dev/null 2>&1; then
  pm2 reload ecosystem.config.cjs --update-env || pm2 start ecosystem.config.cjs
else
  systemctl restart getotps || true
  systemctl restart getotps-worker || true
fi

echo "Health check..."
if curl -fsS "http://127.0.0.1:${PORT:-5000}/healthz" >/dev/null; then
  echo "healthz OK"
else
  echo "healthz FAILED — consider rollback (pm2 logs / previous git)"
  exit 1
fi

echo "Purging CDN cache..."
npm run deploy:purge 2>/dev/null || true

echo "Checking live status..."
npm run check:live 2>/dev/null || true

echo "✅ Deploy complete."
