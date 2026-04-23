# Financial Audit Checklist

Date: 2026-04-24  
Branch: `auto/financial-hardening-production-2026-04-24`

## Mandatory Controls Status (Before Hardening)

- [ ] Double-entry ledger exists
- [ ] Balance updates atomic with row-level locks
- [ ] Idempotency keys enforced on all financial POST endpoints
- [ ] Concurrent request protection for all balance mutations
- [ ] Webhook HMAC signature + timestamp replay guard (<=300s)
- [ ] Circuit breaker for Circle API
- [ ] Circuit breaker for Tellabot API
- [ ] Automatic reconciliation job (internal vs providers)
- [ ] Explicit rollback paths after monetary side effects begin
- [ ] Immutable append-only ledger / transaction log
- [ ] Amounts stored as integer cents/smallest unit
- [ ] Daily mismatch detection + alerting
- [x] Trust proxy configured (`app.set("trust proxy", isProduction ? 1 : false)`)
- [x] Sessions use persistent store (`better-sqlite3-session-store`)
- [~] Stuck pending cleanup exists but without full reverse/finalize orchestration

## Key Findings

1. **Atomicity is inconsistent**
   - Some flows use `runTransaction`, but the balance model is string decimals and not centralized.
   - Admin and route-level updates can bypass unified safeguards.
2. **Idempotency absent**
   - No shared middleware/table for replay-safe financial POSTs.
3. **Webhook security absent**
   - No generic HMAC/timestamp/processed-event handling for provider callbacks.
4. **Ledger absent**
   - Existing `transactions` table is not double-entry and not sufficient for accounting integrity.
5. **Precision risk**
   - Balance and amounts stored as string decimal values.
6. **Provider resiliency gaps**
   - No circuit breaker state machine for Circle/Tellabot.
7. **Reconciliation gaps**
   - No daily consistency checks between user balances, internal financial entries, and external providers.
8. **Pending-state remediation incomplete**
   - Expiry job exists, but not full deterministic finalize/reverse logic with alerting and freeze policy.

## Files In Scope (Financial)

- `server/routes.ts`
- `server/storage.ts`
- `server/tronPoller.ts`
- `server/jobs/cleanup.ts`
- `server/services/circle.service.ts`
- `server/services/tellabot.service.ts`
- `server/services/pricing.service.ts`
- `shared/schema.ts`
- `client/src/pages/AddFunds.tsx`
- `client/src/pages/BuyNumber.tsx`
- `client/src/pages/History.tsx`
- `client/src/pages/Dashboard.tsx`
- `client/src/pages/admin/AdminDeposits.tsx`
- `client/src/pages/admin/AdminUsers.tsx`

## Hardening Targets

1. Add `ledger_accounts`, `ledger_entries`, `financial_transactions`, `idempotency_keys`, `processed_webhooks`, `reconciliation_log`.
2. Add integer-cents compatibility model while preserving existing balance string field.
3. Route all credits/debits through atomic `BEGIN IMMEDIATE` DB transactions.
4. Enforce idempotency keys on financial write endpoints.
5. Add secure webhook verification (HMAC + timestamp + replay defense).
6. Add circuit breaker + state transition logs + alerts for provider outages.
7. Add stuck pending resolver with append-only reversals.
8. Add daily reconciliation and freeze-on-mismatch guard.
