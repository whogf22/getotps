/**
 * PostgreSQL advisory transaction locks (pg_advisory_xact_lock).
 * Key1 is an arbitrary namespace; key2 scopes the lock (user id, fixed slot, etc.).
 * Both arguments are signed 32-bit integers.
 *
 * Registry:
 * | Namespace (key1) | key2        | Purpose                                      |
 * |-------------------|-------------|----------------------------------------------|
 * | 119541            | userId      | Serialize debitUserForPurchase per user    |
 * | 119542            | 1           | Serialize upsertServices catalog sync        |
 */
export const ADVISORY_DEBIT_USER_PURCHASE = 119541;
export const ADVISORY_SERVICES_CATALOG_SYNC = 119542;
