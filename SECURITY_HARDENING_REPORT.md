# Security Hardening Report

## Overview

This report documents the comprehensive security hardening applied to the GetOTPs Node/Express/SQLite application.

---

## Threats Fixed

### 1. Idempotency Protection (Double-Submit Prevention)
**Threat:** Duplicate API calls (network retries, user double-clicks) could create duplicate orders, double-charge balances, or process refunds/confirmations multiple times.

**Fix:** Added `Idempotency-Key` header support for all money-moving endpoints:
- `POST /api/orders` — order creation
- `POST /api/orders/:id/cancel` — order cancellation with refund
- `POST /api/crypto/create-deposit` — deposit creation
- `POST /api/crypto/:id/submit-hash` — transaction hash submission
- `POST /api/admin/crypto/:id/confirm` — admin deposit confirmation
- `POST /api/v1/order` — API v1 order creation
- `POST /api/v1/order/:id/cancel` — API v1 order cancellation

**Implementation:**
- New `idempotency_keys` table with unique constraint on `(key, user_id, route)`
- Middleware intercepts duplicate requests and returns cached original response
- Processing/success/failed states prevent concurrent execution
- 24-hour TTL with automatic cleanup

### 2. Append-Only Ledger Strengthening
**Threat:** Financial transactions could be modified or lose traceability.

**Fix:**
- Added `idempotency_key` column to `transactions` table for cross-referencing
- All financial operations (purchase, refund, deposit) write ledger entries atomically within the same DB transaction as balance mutations
- TronPoller auto-confirm writes idempotency key `trongrid:{txId}` for deduplication

### 3. Authorization Hardening
**Threat:** Users accessing other users' resources; non-admins accessing admin endpoints.

**Verification:** All routes verified to enforce:
- `requireAuth` middleware on all user-specific endpoints
- `requireAdmin` middleware on all admin endpoints (hard 403 for non-admins)
- Ownership checks: `order.userId !== user.id` on orders, deposits, transactions
- Admin override only where explicitly allowed (order view)

### 4. Rate Limiting
**Threat:** Brute force attacks, API abuse, financial operation flooding.

**Fix:** Added targeted rate limiters:
| Limiter | Window | Max | Applied To |
|---------|--------|-----|------------|
| `authLimiter` | 15 min | 10 | Login, Register |
| `apiLimiter` | 1 min | 60 | All /api routes |
| `orderLimiter` | 1 min | 10 | Order creation |
| `financialLimiter` | 1 min | 15 | Cancel, Refund, Crypto, Deposit |
| `passwordLimiter` | 15 min | 5 | Password change |
| `adminLimiter` | 1 min | 30 | Admin actions |

### 5. Immutable Audit Logging
**Threat:** No visibility into security events; no forensic trail for financial disputes.

**Fix:** New `audit_logs` table logging:
- **Auth events:** login (success/failed), logout, register
- **Financial events:** order.create, order.cancel, deposit.create, deposit.submit_hash, admin.deposit.confirm
- **Profile events:** profile.change_password, profile.generate_api_key
- **Admin events:** admin.service.update

Each log entry includes: user_id, actor_role, ip, user_agent, action, target_type, target_id, amount, status, request_id, idempotency_key, metadata (with sensitive data masked).

### 6. Business Logic Guards
**Threat:** Invalid state transitions, double-refund, cancel after fulfillment, negative amounts.

**Fix:**
- **State machine:** `VALID_ORDER_TRANSITIONS` map enforces only valid transitions (waiting→cancelled, waiting→received, received→completed)
- **Double-cancel prevention:** Order status re-checked inside SQLite transaction before proceeding
- **Fulfilled order protection:** Cannot cancel orders with status `completed`, `received`, or `expired`
- **Double-confirm prevention:** Deposit status re-checked inside transaction before crediting
- **Negative amount guard:** Credit/refund amounts validated as > 0 before processing
- **Deposit max limit:** $10,000 max deposit added

### 7. Session & Auth Hardening
**Threat:** Session fixation, session hijacking, insecure cookies.

**Fix:**
- **Session rotation on login:** `req.session.regenerate()` before `req.login()` prevents session fixation
- **Safe logout:** Session destroyed + cookie cleared on logout
- **Named session cookie:** `getotps.sid` instead of default `connect.sid`
- **Cookie hardening:** `httpOnly: true`, `sameSite: "lax"`, `secure: true` in production
- **Trust proxy:** Enabled in production for correct IP detection behind Nginx

### 8. Environment Validation
**Threat:** Running production with insecure defaults or missing secrets.

**Fix:**
- `SESSION_SECRET` required in production, minimum 32 characters
- `ADMIN_PASSWORD` required in production, default passwords rejected
- Development mode continues with warnings for ergonomics

---

## Schema/Migration Changes

### New Tables
1. **`idempotency_keys`** — Stores idempotency key state
   - Columns: id, key, user_id, route, method, status, status_code, response_body, created_at, expires_at
   - Unique index on (key, user_id, route)

2. **`audit_logs`** — Immutable audit trail
   - Columns: id, user_id, actor_role, ip, user_agent, action, target_type, target_id, amount, status, request_id, idempotency_key, metadata, created_at
   - Indexed on user_id and action

### Altered Tables
1. **`transactions`** — Added `idempotency_key TEXT` column (nullable, backward-compatible)

### Migrations
All migrations are auto-applied via inline DDL in `storage.ts` (consistent with existing migration pattern). No separate migration files needed.

---

## Routes Protected

| Route | Auth | Rate Limit | Idempotency | Audit | Business Guards |
|-------|------|------------|-------------|-------|-----------------|
| POST /api/auth/register | - | authLimiter | - | ✅ | Input validation |
| POST /api/auth/login | - | authLimiter | - | ✅ | Session rotation |
| POST /api/auth/logout | - | - | - | ✅ | Session destroy |
| GET /api/auth/me | requireAuth | apiLimiter | - | - | - |
| POST /api/orders | requireAuth | orderLimiter | ✅ | ✅ | Balance check, price validation |
| POST /api/orders/:id/cancel | requireAuth | financialLimiter | ✅ | ✅ | State machine, double-cancel prevention |
| POST /api/orders/:id/check-sms | requireAuth | apiLimiter | - | - | Status check |
| POST /api/crypto/create-deposit | requireAuth | financialLimiter | ✅ | ✅ | Amount validation |
| POST /api/crypto/:id/submit-hash | requireAuth | financialLimiter | ✅ | ✅ | Status check, ownership |
| POST /api/crypto/:id/simulate-confirm | requireAuth | - | - | - | Production disabled |
| POST /api/admin/crypto/:id/confirm | requireAdmin | adminLimiter | ✅ | ✅ | Double-confirm prevention |
| PUT /api/admin/services/:id | requireAdmin | adminLimiter | - | ✅ | Price validation |
| POST /api/v1/order | requireApiKey | orderLimiter | ✅ | ✅ | Balance check |
| POST /api/v1/order/:id/cancel | requireApiKey | financialLimiter | ✅ | ✅ | State machine |
| POST /api/profile/change-password | requireAuth | passwordLimiter | - | ✅ | Length validation |
| POST /api/profile/generate-api-key | requireAuth | - | - | ✅ | - |

---

## Verification Results

- **TypeScript:** `npx tsc --noEmit` — ✅ 0 errors
- **Build:** `npm run build` — ✅ Success
- **npm audit:** ✅ 0 vulnerabilities
- **Dependencies:** drizzle-orm@0.45.2 (SQL injection fix), vite@7.3.2 (path traversal fixes)

---

## New Environment Variables

No new environment variables required. Existing variables now have stricter validation in production:
- `SESSION_SECRET` — Required in production, minimum 32 characters
- `ADMIN_PASSWORD` — Required in production, default values rejected

---

## Deploy Commands

```bash
# Install dependencies
npm install --production

# Build
npm run build

# Start production
NODE_ENV=production npm start
```

## PM2/Nginx Commands

```bash
# PM2 restart
pm2 restart getotps --update-env

# Or full reload
pm2 reload getotps

# Nginx reload (if config changed)
sudo nginx -t && sudo systemctl reload nginx

# Healthcheck
curl -s http://localhost:5000/api/services | jq '.[:1]'
```
