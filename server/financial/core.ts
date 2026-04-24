import crypto from "crypto";
import { getQueryClient } from "../db";
import type { QueryResult } from "pg";

export type FinancialStatus = "pending" | "success" | "failed" | "reversed";

export type FinancialTx = {
  id: number;
  idempotencyKey: string | null;
  userId: number | null;
  type: string;
  status: FinancialStatus;
  amountCents: number;
  currency: string;
  metadata: string | null;
  createdAt: string;
};

function nowIso(): string {
  return new Date().toISOString();
}

export function toCents(value: string | number): number {
  const n = typeof value === "number" ? value : Number.parseFloat(value);
  if (!Number.isFinite(n)) throw new Error("Invalid monetary amount");
  return Math.round(n * 100);
}

export function centsToDecimal(cents: number): string {
  return (cents / 100).toFixed(2);
}

export function sha256(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

async function q(text: string, params?: unknown[]): Promise<QueryResult> {
  return getQueryClient().query(text, params);
}

export { runTransaction, runTransaction as withImmediateTransaction } from "../db";

let schemaInitialized = false;

/** Idempotent seeds after `npm run db:push` / migrations. */
export async function initFinancialSchema(): Promise<void> {
  if (schemaInitialized) return;

  const requiredAccounts = ["user_cash", "revenue", "tellabot_cost", "circle_fees", "suspense"];
  for (const account of requiredAccounts) {
    await q("INSERT INTO ledger_accounts (account) VALUES ($1) ON CONFLICT (account) DO NOTHING", [account]);
  }

  await q(
    `INSERT INTO service_bundles (name, service, quantity, price_cents, discount_pct, expires_days, is_active)
     VALUES ('Gmail Pack', 'gmail', 10, 800, 20, 30, 1),
            ('WhatsApp Pack', 'whatsapp', 10, 800, 20, 30, 1),
            ('Mega Pack', 'mixed', 50, 4000, 20, 30, 1)
     ON CONFLICT (name) DO NOTHING`,
  );

  await q(
    `INSERT INTO api_plans (name, monthly_price_cents, rate_limit_per_min, discount_pct, active) VALUES
     ('Free', 0, 60, 0, true),
     ('Pro', 4900, 300, 5, true),
     ('Business', 19900, 1000, 10, true)
     ON CONFLICT (name) DO NOTHING`,
  );

  const bundles: [string, string, number][] = [
    ["10", "0", 1],
    ["25", "2", 2],
    ["50", "6", 3],
    ["100", "15", 4],
  ];
  for (const [amt, bonus, sort] of bundles) {
    await q(
      `INSERT INTO deposit_bundles (amount_usd, bonus_usd, active, sort_order)
       SELECT $1::text, $2::text, true, $3::int
       WHERE NOT EXISTS (SELECT 1 FROM deposit_bundles WHERE amount_usd = $1::text)`,
      [amt, bonus, sort],
    );
  }

  await q(
    `INSERT INTO deposit_poll_state (id, last_timestamp, updated_at) VALUES (1, 0, '')
     ON CONFLICT (id) DO NOTHING`,
  );

  schemaInitialized = true;
}

export async function getUserBalanceCents(userId: number): Promise<number> {
  const r = await q("SELECT balance_cents FROM users WHERE id = $1", [userId]);
  const row = r.rows[0] as { balance_cents: number } | undefined;
  if (!row) throw new Error("User not found");
  return row.balance_cents ?? 0;
}

export async function setUserBalanceCents(userId: number, balanceCents: number): Promise<void> {
  if (balanceCents < 0) throw new Error("Negative balances are not allowed");
  await q("UPDATE users SET balance_cents = $1, balance = $2 WHERE id = $3", [
    balanceCents,
    centsToDecimal(balanceCents),
    userId,
  ]);
}

export async function createFinancialTransaction(params: {
  idempotencyKey: string | null;
  userId: number | null;
  type: string;
  status: FinancialStatus;
  amountCents: number;
  currency?: string;
  metadata?: Record<string, unknown> | null;
}): Promise<number> {
  const r = await q(
    `INSERT INTO financial_transactions
     (idempotency_key, user_id, type, status, amount_cents, currency, metadata, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING id`,
    [
      params.idempotencyKey,
      params.userId,
      params.type,
      params.status,
      params.amountCents,
      params.currency ?? "USD",
      params.metadata ? JSON.stringify(params.metadata) : null,
      nowIso(),
    ],
  );
  return Number(r.rows[0].id);
}

export async function appendLedgerEntry(params: {
  transactionId: number;
  account: string;
  debitCents: number;
  creditCents: number;
  metadata?: Record<string, unknown> | null;
}): Promise<void> {
  await q(
    `INSERT INTO ledger_entries
     (transaction_id, account, debit_cents, credit_cents, metadata, created_at)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [
      params.transactionId,
      params.account,
      params.debitCents,
      params.creditCents,
      params.metadata ? JSON.stringify(params.metadata) : null,
      nowIso(),
    ],
  );
}

export async function assertTransactionBalanced(transactionId: number): Promise<boolean> {
  const r = await q(
    `SELECT COALESCE(SUM(debit_cents), 0) AS debits, COALESCE(SUM(credit_cents), 0) AS credits
     FROM ledger_entries WHERE transaction_id = $1`,
    [transactionId],
  );
  const row = r.rows[0] as { debits: string; credits: string };
  return Number(row.debits) === Number(row.credits);
}

export async function getIdempotencyRecord(key: string): Promise<{
  bodyHash: string;
  responseBody: string;
  statusCode: number;
  createdAt: string;
} | null> {
  const r = await q(
    "SELECT body_hash, response_body, status_code, created_at FROM idempotency_keys WHERE idempotency_key = $1",
    [key],
  );
  const row = r.rows[0] as
    | { body_hash: string; response_body: string; status_code: number; created_at: string }
    | undefined;
  if (!row) return null;
  return {
    bodyHash: row.body_hash,
    responseBody: row.response_body,
    statusCode: row.status_code,
    createdAt: row.created_at,
  };
}

export async function saveIdempotencyRecord(params: {
  key: string;
  bodyHash: string;
  responseBody: string;
  statusCode: number;
}): Promise<void> {
  await q(
    `INSERT INTO idempotency_keys (idempotency_key, body_hash, response_body, status_code, created_at)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (idempotency_key) DO UPDATE SET
       body_hash = EXCLUDED.body_hash,
       response_body = EXCLUDED.response_body,
       status_code = EXCLUDED.status_code,
       created_at = EXCLUDED.created_at`,
    [params.key, params.bodyHash, params.responseBody, params.statusCode, nowIso()],
  );
  const cutoff = new Date(Date.now() - 864e5).toISOString();
  await q(`DELETE FROM idempotency_keys WHERE created_at < $1`, [cutoff]).catch(() => {});
}

export async function markWebhookProcessed(provider: string, webhookId: string, receivedTs: number): Promise<boolean> {
  try {
    await q(
      "INSERT INTO processed_webhooks (provider, webhook_id, received_ts, created_at) VALUES ($1, $2, $3, $4)",
      [provider, webhookId, receivedTs, nowIso()],
    );
    return true;
  } catch {
    return false;
  }
}

export async function getLedgerUserCashNetCents(): Promise<number> {
  const r = await q(
    "SELECT COALESCE(SUM(credit_cents - debit_cents), 0)::bigint AS net FROM ledger_entries WHERE account = 'user_cash'",
  );
  const row = r.rows[0] as { net: string };
  return Number(row?.net ?? 0);
}

export async function getUsersBalanceTotalCents(): Promise<number> {
  const r = await q("SELECT COALESCE(SUM(balance_cents), 0)::bigint AS total FROM users");
  const row = r.rows[0] as { total: string };
  return Number(row?.total ?? 0);
}

export async function setFinancialFreeze(frozen: boolean): Promise<void> {
  await q(
    `INSERT INTO financial_flags (key, value, updated_at) VALUES ('transactions_frozen', $1, $2)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = EXCLUDED.updated_at`,
    [frozen ? "1" : "0", nowIso()],
  );
}

export async function isFinancialFreezeEnabled(): Promise<boolean> {
  const r = await q("SELECT value FROM financial_flags WHERE key = 'transactions_frozen'");
  const row = r.rows[0] as { value: string } | undefined;
  return row?.value === "1";
}

export async function writeReconciliationLog(
  status: string,
  mismatchCents: number,
  details: Record<string, unknown>,
): Promise<void> {
  await q("INSERT INTO reconciliation_log (run_at, status, mismatch_cents, details) VALUES ($1, $2, $3, $4)", [
    nowIso(),
    status,
    mismatchCents,
    JSON.stringify(details),
  ]);
}
