# GetOTPs Financial-Critical Audit Report

Date: 2026-04-24  
Branch: `auto/financial-hardening-production-2026-04-24`

## 1) Full Repo Scan Summary

- **Backend runtime**
  - Express 5 + TypeScript (`server/index.ts`, `server/routes.ts`).
  - SQLite (`better-sqlite3`) via Drizzle.
  - Session auth with Passport + persistent SQLite session store.
- **Frontend runtime**
  - React + Vite + TypeScript + TanStack Query + wouter.
  - Core money pages: `client/src/pages/AddFunds.tsx`, `BuyNumber.tsx`, `History.tsx`, `Dashboard.tsx`, admin deposit/user pages.
- **Money-touching backend files**
  - `server/routes.ts`: buy, cancel, deposit create/confirm, admin balance adjustments, API-key order flow.
  - `server/storage.ts`: user balances, orders, transactions, crypto_deposits writes.
  - `server/tronPoller.ts`: auto-confirm deposit credits.
  - `server/jobs/cleanup.ts`: stale order expiry.
  - `server/services/circle.service.ts`: Circle wallet and transfers.
  - `server/services/tellabot.service.ts`: Tellabot provider calls.
  - `server/services/pricing.service.ts`: server-side sell price.
- **Data model**
  - Main monetary fields currently stored as string decimals (not integer cents).
  - Existing tables: `users`, `orders`, `transactions`, `crypto_deposits`.
  - No immutable double-entry ledger tables yet.

## 2) Financial Flow Mapping (Current)

1. **OTP buy flow (cookie auth route)**
   - `POST /api/orders` and `POST /api/buy-number`
   - Balance deductions and provider calls happen in app flow, but with mixed patterns and weak idempotency guarantees.
2. **Deposit flow**
   - `POST /api/crypto/create-deposit` creates pending records.
   - `server/tronPoller.ts` auto-confirms and credits balances.
   - Admin/manual completion endpoints can also credit.
3. **Refund/cancel flow**
   - `POST /api/orders/:id/cancel` and `POST /api/v1/order/:id/cancel` perform direct balance refunds.
4. **Admin balance adjustments**
   - `POST /api/admin/users/:id/add-balance` directly mutates balances.
5. **Circle wallet flow**
   - Wallet create/balance endpoints exist.
   - OTP purchase can transfer Circle funds before order completion.

## 3) Critical Financial Gaps

1. **No immutable double-entry ledger**: financial integrity not provable.
2. **No idempotency middleware**: duplicate charges/credits possible on retries.
3. **No unified atomic debit/credit service**: direct balance mutations spread across routes/poller.
4. **String-decimal money model**: rounding/precision risk.
5. **No secure webhook framework**: no HMAC + timestamp replay defense.
6. **No processed webhook dedupe table**: duplicate callback reprocessing risk.
7. **No circuit breaker around Circle/Tellabot paths**: cascading provider failures possible.
8. **No daily reconciliation job**: drift between balance, ledger intent, and providers undetected.
9. **Pending timeout remediation partial**: stale expiry exists, but no full reverse/finalize decision engine.
10. **No mandatory idempotency for financial POST routes**.

## 4) Upgrade/Plan Preservation Status

- No standalone subscription engine was found in this repository.
- Existing pricing and pay-per-use routes/UI remain present.
- Financial hardening work will be additive and compatibility-preserving.

## 5) Execution Plan (Immediate)

1. Add financial schema and migration layer (accounts, ledger, idempotency, webhooks, reconciliation).
2. Introduce centralized money service with atomic lock-safe operations.
3. Add financial idempotency middleware for all critical POST endpoints.
4. Secure provider webhooks with HMAC + timestamp + dedupe.
5. Wrap Circle/Tellabot integrations with circuit breaker and logging.
6. Extend cleanup job to timeout, resolve, reverse, and alert.
7. Add daily reconciliation and freeze-on-drift behavior.
8. Add financial monitoring/alerts and required verification tests.
