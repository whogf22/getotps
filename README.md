# GetOTPs

Virtual phone number and OTP verification platform. GetOTPs provides temporary phone numbers for SMS verification, powered by an upstream OTP supplier integration with crypto deposit support and TronGrid auto-detection.

## Tech Stack

- **Frontend:** React + Vite + TypeScript + Tailwind CSS + shadcn/ui
- **Backend:** Express.js + TypeScript + Passport.js
- **Database:** SQLite (better-sqlite3) + Drizzle ORM
- **SMS Provider:** Hidden upstream provider integration (Tellabot server-side only)
- **Wallet rail:** Circle Dev-Controlled Wallets (USDC deposit + server-side OTP payment)
- **Payments:** Crypto deposits (BTC, ETH, USDT, USDC, LTC) with TronGrid auto-detection
- **Session Store:** SQLite-backed (better-sqlite3-session-store)

## Features

- SMS verification number rental for 100+ services
- Real-time OTP detection and extraction
- Crypto deposit system with multiple currencies
- TronGrid USDT TRC20 auto-deposit detection
- Financial safety hardening (idempotency + atomic balance updates + append-only ledger entries)
- Webhook signature verification (HMAC + timestamp replay window)
- Daily reconciliation and freeze-on-mismatch safeguard
- User dashboard with balance management
- Admin panel with revenue tracking and user management
- RESTful API with API key authentication
- Rate limiting and security headers (Helmet)

## Setup

1. Clone the repository
2. Install dependencies:
   ```bash
   npm install
   ```
3. Copy environment variables:
   ```bash
   cp .env.example .env
   ```
4. Edit `.env` with your credentials (TellaBot API, session secret, crypto wallets, etc.)
5. Start development server:
   ```bash
   npm run dev
   ```

## Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start development server |
| `npm run build` | Build for production |
| `npm start` | Start production server |
| `npm run check` | TypeScript type check |
| `npm run db:push` | Push database schema |

## Production Deployment

Use the included `deploy.sh` script on your VPS:

```bash
chmod +x deploy.sh && ./deploy.sh
```

Then edit `.env` with real credentials and restart with PM2.

## Environment Variables

See `.env.example` for all required configuration variables.

## Hidden Upstream OTP Integration

- Upstream provider calls are **server-side only**.
- Browser/client responses never expose upstream API keys or activation IDs.
- OTP lifecycle is handled by backend endpoints:
  - `POST /api/buy-number`
  - `GET /api/check-sms/:orderId`

## Circle Wallet Deposit Flow

- Each user can be assigned a Circle Dev-Controlled wallet (EOA).
- Dashboard/Add Funds UI can generate and display a user-specific USDC deposit address.
- Backend fetches USDC wallet balance using Circle APIs.
- OTP purchase flow transfers USDC from user wallet to configured master wallet before upstream number purchase.

### Ops Note

This codebase does not automate exchange conversion from master USDC holdings to provider funding assets.  
Operations should periodically transfer and convert funds externally before topping up the upstream OTP supplier account.

## Financial Controls

- Financial write endpoints require `Idempotency-Key` headers (`/api/buy-number`, `/api/deposit`, `/api/withdraw`, `/api/upgrade`, `/api/payment/*`).
- User balance updates are executed through atomic immediate transactions and synchronized in both decimal and cents fields.
- Ledger entries are append-only and every transaction is validated for debit/credit balance.
- Circle webhooks are accepted only with valid HMAC signature, valid timestamp (<= 300 seconds), and unique webhook IDs.
- Cleanup worker auto-refunds stale pending orders and emits critical alerts for stuck flows.
- Reconciliation runs daily at 00:00 UTC and freezes financial writes if mismatch exceeds $0.01.

## API Documentation

API endpoints are available at `/api/v1/` with API key authentication via `X-API-Key` header.

## License

MIT
