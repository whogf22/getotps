# Financial Hardening Report

Date: 2026-04-24  
Branch: `auto/financial-hardening-production-2026-04-24`

## Implemented Financial Infrastructure

### 1) Ledger + Transaction Foundations
- Added `financial_transactions` table for immutable financial event records.
- Added `ledger_accounts` and `ledger_entries` append-only accounting tables.
- Seeded accounting buckets:
  - `user_cash`
  - `revenue`
  - `tellabot_cost`
  - `circle_fees`
  - `suspense`
- Added transaction balance validation (`debits == credits`) via `assertTransactionBalanced`.

### 2) Integer-Cents Compatibility Layer
- Added `users.balance_cents` (additive migration).
- Added dual-write synchronization:
  - decimal string (`users.balance`)
  - integer cents (`users.balance_cents`)
- Financial operations execute in cents and keep legacy decimal field backward-compatible.

### 3) Atomic Balance Operations
- Added immediate-transaction wrapper (`BEGIN IMMEDIATE`) in `server/financial/core.ts`.
- Added centralized debit/credit operations in `server/financial/operations.ts`.
- Enforced non-negative balance invariant on updates.

### 4) Idempotency Keys
- Added `idempotency_keys` table.
- Added financial idempotency middleware for:
  - `/api/buy-number`
  - `/api/deposit`
  - `/api/withdraw`
  - `/api/upgrade`
  - `/api/payment/*`
- Added 24h TTL cleanup behavior.

### 5) Webhook Security
- Added `processed_webhooks` table with provider+webhook unique constraint.
- Added HMAC + timestamp replay verification module:
  - HMAC-SHA256 over `${timestamp}.${rawBody}`
  - 300s max skew
  - duplicate webhook acceptance without reprocessing
- Added Circle webhook route:
  - `POST /api/webhooks/circle`

### 6) Circuit Breaker
- Added provider state table `provider_circuit_state`.
- Implemented CLOSED -> OPEN -> HALF_OPEN state machine:
  - opens after 5 failures / 60s window
  - half-open probe after 30s
- Added queued operation fallback table `pending_operations`.

### 7) Cleanup + Auto-Reversal
- Extended cleanup worker:
  - stale order detection
  - automatic balance refund via append-only credit entries
  - critical alert on long-stuck pending flows

### 8) Daily Reconciliation
- Added `reconciliation_log` table.
- Added UTC midnight reconciliation scheduler.
- Added freeze-on-mismatch (> $0.01) safeguard via `financial_flags`.

### 9) Monitoring + Alerts
- Added structured financial logging in JSON format:
  - `transaction_id`, `idempotency_key`, `user_id`, `amount_cents`, `status`, `event`, `source_ip`, `user_agent`, `timestamp`
- Added Telegram + webhook-based email alert dispatch for critical events.

## Money Flow Hardening Coverage

- Hardened `/api/buy-number` with:
  - idempotency key support
  - atomic debit
  - provider circuit wrappers
  - explicit reversal on provider failure
  - ledger balancing enforcement
- Hardened deposit credit paths:
  - TronGrid auto-credit path
  - simulation/admin confirmation paths
- Added webhook-safe processing route for Circle callbacks.

## Upgrade Plan Preservation

- Existing app behavior has no dedicated subscription entitlement engine in this repository.
- Existing pricing/pay-per-use behavior remains intact.
- No existing upgrade/plan UI route was removed.
- Added `/api/upgrade` compatibility endpoint (non-destructive).

## Reconciliation Schedule

- Job runs at 00:00 UTC daily (`startReconciliationJob`).

## Alert Endpoints / Channels

- Telegram (if configured):
  - `TELEGRAM_BOT_TOKEN`
  - `TELEGRAM_CHAT_ID`
- Optional email relay webhook:
  - `FINANCIAL_ALERT_EMAIL_WEBHOOK`

## External Manual Configuration Required

1. Set real production secrets:
   - `SESSION_SECRET`
   - `TELLABOT_API_KEY`
   - `CIRCLE_API_KEY`, `CIRCLE_ENTITY_SECRET`, `CIRCLE_WALLET_SET_ID`
   - `CIRCLE_WEBHOOK_SECRET`
2. Configure allowed origins via `ALLOWED_ORIGINS`.
3. Ensure Circle master wallet funding and operational top-up process.
4. Configure alert transport secrets (Telegram/email) for incident visibility.
