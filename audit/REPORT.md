# GetOTPs Production Re-Audit Report

Date: 2026-04-24  
Branch: `auto/reaudit-fix-production-2026-04-24`

## 1) Architecture Summary

- **Runtime/stack**
  - Monorepo-style single package with:
    - Express backend (`server/*`)
    - React + Vite frontend (`client/*`)
    - Shared schema/types (`shared/schema.ts`)
  - TypeScript project (`type: module`) with esbuild production bundling.
- **Package manager/scripts**
  - npm with lockfile.
  - Existing scripts: `dev`, `build`, `start`, `check`, `db:push`.
  - No test/lint scripts currently wired.
- **Database**
  - SQLite (`better-sqlite3`) + Drizzle ORM.
  - Schema is defined in `shared/schema.ts`.
  - Runtime table creation/migrations are executed imperatively in `server/storage.ts`.
  - No dedicated migration execution pipeline currently run at startup from `migrations/`.
- **Auth/session**
  - Cookie session auth with `express-session`, Passport Local.
  - Session store is persistent SQLite via `better-sqlite3-session-store` (good).
  - Cookies are `httpOnly`, `secure` in production, `sameSite=lax`.
- **Security middleware**
  - Helmet configured.
  - Rate limiting via `express-rate-limit`.
  - Error handling masks message in production responses but still logs server-side.
  - No explicit CORS policy middleware.
  - No CSRF guard on state-changing cookie-authenticated endpoints.
- **Payments/deposits**
  - Existing flow: crypto deposit intents and TronGrid-based USDT TRC20 auto-matching.
  - Admin/manual confirmation endpoints for deposits.
  - No Circle wallet integration yet.
- **OTP order flow**
  - Existing TellaBot integration is direct in routes and currently uses `api_command.php` + command pattern.
  - Orders are created from service selection and balance deduction.
  - OTP checks poll `read_sms`.
  - Internal Tellabot IDs are currently persisted and some fields are returned in full order objects.
- **Frontend**
  - Hash-router SPA (`wouter`).
  - User flows: landing, auth, dashboard, buy, active, funds, profile, admin.
  - UX already includes loading and pending-state handling in core pages.
- **Deployment**
  - `deploy.sh` configures nginx reverse proxy + PM2 and standard `X-Forwarded-*` headers.

## 2) Security / Production Risks Identified

### Critical

1. **No CSRF protection for cookie-authenticated mutating routes**
   - Endpoints like auth/logout, order create/cancel, profile/password, deposits can be cross-site targeted if browser sends cookies.
2. **No strict origin policy/CORS middleware**
   - App currently relies on same-origin behavior only; no explicit allowlist safeguards.
3. **Tellabot API implementation and exposure concerns**
   - Integration is in routes layer; no isolated service abstraction.
   - Uses `api_command.php` pattern instead of required `handler_api.php` contract in target spec.
   - Internal fields (`tellabotRequestId`, `tellabotMdn`) may leak through route payloads that return full order objects.
4. **Provider idempotency gaps**
   - Webhook-style idempotency handling framework is missing (especially for future Circle callbacks).
   - Some multi-step external operations can duplicate under retries/races.

### High

5. **Stuck pending lifecycle**
   - Order expiry logic exists via `expiresAt`, but no periodic job marks old waiting/received orders as `expired`.
   - Pending deposits are expired, but confirming deposits can remain indefinitely.
6. **Route-level validation inconsistent**
   - Some endpoints validate strongly, others accept broad body shapes without schema validation.
7. **Trust proxy configuration may be too narrow**
   - Production sets `trust proxy=1`; can be insufficient in multi-hop setups behind Cloudflare + nginx chain.

### Medium

8. **DB migration strategy is implicit/manual**
   - Runtime `ALTER TABLE` checks are ad-hoc and hard to track.
9. **API shape risk**
   - Existing order response contracts include internal fields not always intended for user visibility.
10. **No automated tests**
   - No smoke tests for auth/order/deposit lifecycle.

## 3) Business-Critical Feature Preservation Scan

- **Upgrade/Plan/Subscription/Premium**
  - No dedicated plan/subscription billing stack found in current codebase.
  - Pricing exists as pay-per-use OTP service pricing and crypto balance top-up flow.
  - Admin/user/account/payment/order functionality exists and must remain intact.
  - Work will be additive and backward-compatible for all existing routes and behavior.

## 4) Production Hardening Plan (Implementation Order)

1. Add explicit trusted proxy strategy and robust IP extraction for rate limiting.
2. Introduce CORS allowlist + strict same-origin CSRF guard for cookie-auth mutating routes.
3. Add centralized env validation and safer startup requirements for production secrets.
4. Add pending-state cleanup scheduler:
   - expire waiting/received OTP orders after timeout
   - expire stale deposits safely (pending + long-confirming timeout where appropriate)
5. Refactor Tellabot into server-only service module using required `handler_api.php` actions and hidden internals.
6. Add Circle dev-controlled wallets service and additive OTP purchase route:
   - user wallet creation
   - USDC balance fetch
   - transfer user->master
   - then upstream Tellabot number purchase
7. Add DB additive schema fields/migration support for circle wallet and tellabot activation metadata.
8. Add tests (auth smoke, OTP lifecycle with mocks, cleanup job behavior).
9. Update docs: `.env.example`, `README.md`, `CHANGELOG.md`, `audit/FINAL_SUMMARY.md`.
