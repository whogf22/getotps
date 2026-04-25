# GetOTPs — Virtual Phone Numbers for SMS Verification

[![Status](https://img.shields.io/badge/status-production-brightgreen)]()
[![Node](https://img.shields.io/badge/node-20.x-339933?logo=node.js&logoColor=white)]()
[![License](https://img.shields.io/badge/license-Proprietary-blue)]()

A production-grade virtual number / OTP rental service. Users buy disposable phone numbers to receive SMS verification codes for any online service. Live on **getotps.com** and **getotps.online**.

---

## Highlights

- **Real-time SMS upstream** — integrates with TellaBot for live phone-number provisioning and OTP delivery.
- **Multi-currency wallet** — USD, USDT (TRC20), BTC, ETH, LTC. Crypto deposits auto-credited via on-chain polling.
- **Circle USDC integration** — per-user programmable wallets for stablecoin settlement.
- **Admin panel** — service catalog, pricing markup, balance adjustments, order audit trail.
- **Production hardening** — PM2 cluster, Nginx reverse proxy, Cloudflare edge, structured logging, rate limiting, Turnstile bot protection.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Runtime | Node.js 20 + TypeScript |
| Web framework | Express |
| Frontend | React 18 + Vite + TailwindCSS |
| Database | SQLite (better-sqlite3) — Postgres-ready via Drizzle ORM |
| Auth | Session-based + bcrypt + Cloudflare Turnstile |
| Process manager | PM2 (fork mode, 2 processes) |
| Reverse proxy | Nginx + Let's Encrypt SSL |
| Crypto | TronGrid (USDT TRC20), Circle USDC API |
| SMS upstream | TellaBot API |

---

## Project Structure

```
getotps/
├── client/              # React + Vite frontend
│   ├── src/
│   └── public/
├── server/              # Express backend
│   ├── routes.ts        # All HTTP routes
│   ├── tellabot/        # SMS upstream client
│   ├── services/        # Business logic (orders, wallet, pricing)
│   ├── security/        # Errors, redaction, version check
│   ├── middleware/      # Validation, rate limit
│   ├── jobs/            # Background cleanup jobs
│   ├── financial/       # Webhook security
│   └── worker.ts        # Crypto deposit poller
├── shared/              # Types & Drizzle schema
├── dist/                # Build output (gitignored)
└── drizzle.config.ts
```

---

## Quick Start (Local Dev)

```bash
git clone https://github.com/whogf22/getotps.git
cd getotps
npm install
cp .env.example .env       # then fill required values
npm run db:push            # sync schema
npm run dev                # http://localhost:5000
```

## Production Deploy

```bash
git pull origin master
npm install
npm run build
pm2 restart getotps otp-worker --update-env
sudo systemctl reload nginx
```

---

## Required Environment Variables

See `.env.example` for the full list. Critical ones:

- `NODE_ENV=production`
- `PORT=5000`
- `SESSION_SECRET` — long random string
- `TELLABOT_USER`, `TELLABOT_API_KEY`, `TELLABOT_MARKUP`
- `TRONGRID_API_KEY`
- `CIRCLE_API_KEY`, `CIRCLE_ENTITY_SECRET`
- `TURNSTILE_SECRET_KEY`
- `CRYPTO_WALLET_BTC`, `CRYPTO_WALLET_ETH`, `CRYPTO_WALLET_USDT`, `CRYPTO_WALLET_LTC`

**Never commit `.env` to the repo.**

---

## Scripts

```
npm run dev         # Vite dev server + tsx watch
npm run build       # Production build (frontend + backend)
npm run start       # Production start
npm run db:push     # Apply Drizzle schema
npm run check       # Type-check
npm run test        # Vitest
```

---

## Security

- Secrets never in Git. `.env*` is gitignored.
- HTTPS-only via Cloudflare → Nginx → Node.
- Session cookies are `httpOnly`, `secure`, `sameSite=lax`.
- CSRF, rate limiting, input validation in place.
- Webhook signatures verified for Circle deposits.
- Sensitive provider responses scrubbed before client-side return.

Found a security issue? Email **security@getotps.com**.

---

## License

Proprietary. All rights reserved © 2026 GetOTPs.
