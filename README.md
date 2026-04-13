# GetOTPs

Virtual phone number and OTP verification platform. GetOTPs provides temporary phone numbers for SMS verification, powered by the TellaBot API with crypto deposit support and TronGrid auto-detection.

## Tech Stack

- **Frontend:** React + Vite + TypeScript + Tailwind CSS + shadcn/ui
- **Backend:** Express.js + TypeScript + Passport.js
- **Database:** SQLite (better-sqlite3) + Drizzle ORM
- **SMS Provider:** TellaBot API
- **Payments:** Crypto deposits (BTC, ETH, USDT, USDC, LTC) with TronGrid auto-detection
- **Session Store:** SQLite-backed (better-sqlite3-session-store)

## Features

- SMS verification number rental for 100+ services
- Real-time OTP detection and extraction
- Crypto deposit system with multiple currencies
- TronGrid USDT TRC20 auto-deposit detection
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

## API Documentation

API endpoints are available at `/api/v1/` with API key authentication via `X-API-Key` header.

## License

MIT
