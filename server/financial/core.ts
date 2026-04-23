import crypto from "crypto";
import { sqliteClient } from "../storage";

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

export function initFinancialSchema(): void {
  sqliteClient.exec(`
    CREATE TABLE IF NOT EXISTS financial_transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      idempotency_key TEXT,
      user_id INTEGER,
      type TEXT NOT NULL,
      status TEXT NOT NULL,
      amount_cents INTEGER NOT NULL,
      currency TEXT NOT NULL DEFAULT 'USD',
      metadata TEXT,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_financial_transactions_idem ON financial_transactions(idempotency_key);
    CREATE INDEX IF NOT EXISTS idx_financial_transactions_user ON financial_transactions(user_id);
    CREATE INDEX IF NOT EXISTS idx_financial_transactions_status ON financial_transactions(status);

    CREATE TABLE IF NOT EXISTS ledger_accounts (
      account TEXT PRIMARY KEY
    );

    CREATE TABLE IF NOT EXISTS ledger_entries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      transaction_id INTEGER NOT NULL,
      account TEXT NOT NULL,
      debit_cents INTEGER NOT NULL DEFAULT 0,
      credit_cents INTEGER NOT NULL DEFAULT 0,
      metadata TEXT,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_ledger_entries_tx ON ledger_entries(transaction_id);
    CREATE INDEX IF NOT EXISTS idx_ledger_entries_account ON ledger_entries(account);

    CREATE TABLE IF NOT EXISTS idempotency_keys (
      idempotency_key TEXT PRIMARY KEY,
      body_hash TEXT NOT NULL,
      response_body TEXT NOT NULL,
      status_code INTEGER NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS processed_webhooks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      provider TEXT NOT NULL,
      webhook_id TEXT NOT NULL,
      received_ts INTEGER NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_processed_webhooks_unique ON processed_webhooks(provider, webhook_id);

    CREATE TABLE IF NOT EXISTS provider_circuit_state (
      provider TEXT PRIMARY KEY,
      state TEXT NOT NULL,
      failure_count INTEGER NOT NULL DEFAULT 0,
      first_failure_ts INTEGER,
      opened_at_ts INTEGER,
      last_transition_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS pending_operations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      provider TEXT NOT NULL,
      operation_type TEXT NOT NULL,
      payload TEXT NOT NULL,
      retry_count INTEGER NOT NULL DEFAULT 0,
      next_retry_at TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'queued',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS reconciliation_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      run_at TEXT NOT NULL,
      status TEXT NOT NULL,
      mismatch_cents INTEGER NOT NULL DEFAULT 0,
      details TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS financial_flags (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);

  const cols = sqliteClient.pragma("table_info(users)") as { name: string }[];
  const names = new Set(cols.map((c) => c.name));
  if (!names.has("balance_cents")) {
    sqliteClient.exec("ALTER TABLE users ADD COLUMN balance_cents INTEGER NOT NULL DEFAULT 0");
  }
  sqliteClient.exec(
    "UPDATE users SET balance_cents = CAST(ROUND(CAST(balance AS REAL) * 100.0) AS INTEGER) WHERE balance_cents = 0 AND CAST(balance AS REAL) > 0",
  );

  const requiredAccounts = ["user_cash", "revenue", "tellabot_cost", "circle_fees", "suspense"];
  const insertAccount = sqliteClient.prepare("INSERT OR IGNORE INTO ledger_accounts (account) VALUES (?)");
  for (const account of requiredAccounts) {
    insertAccount.run(account);
  }
}

export function withImmediateTransaction<T>(fn: () => T): T {
  sqliteClient.prepare("BEGIN IMMEDIATE").run();
  try {
    const result = fn();
    sqliteClient.prepare("COMMIT").run();
    return result;
  } catch (error) {
    sqliteClient.prepare("ROLLBACK").run();
    throw error;
  }
}

export function getUserBalanceCents(userId: number): number {
  const row = sqliteClient
    .prepare("SELECT balance_cents FROM users WHERE id = ?")
    .get(userId) as { balance_cents: number } | undefined;
  if (!row) throw new Error("User not found");
  return row.balance_cents ?? 0;
}

export function setUserBalanceCents(userId: number, balanceCents: number): void {
  if (balanceCents < 0) throw new Error("Negative balances are not allowed");
  sqliteClient
    .prepare("UPDATE users SET balance_cents = ?, balance = ? WHERE id = ?")
    .run(balanceCents, centsToDecimal(balanceCents), userId);
}

export function createFinancialTransaction(params: {
  idempotencyKey: string | null;
  userId: number | null;
  type: string;
  status: FinancialStatus;
  amountCents: number;
  currency?: string;
  metadata?: Record<string, unknown> | null;
}): number {
  const result = sqliteClient
    .prepare(
      `INSERT INTO financial_transactions
       (idempotency_key, user_id, type, status, amount_cents, currency, metadata, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      params.idempotencyKey,
      params.userId,
      params.type,
      params.status,
      params.amountCents,
      params.currency ?? "USD",
      params.metadata ? JSON.stringify(params.metadata) : null,
      nowIso(),
    );
  return Number(result.lastInsertRowid);
}

export function appendLedgerEntry(params: {
  transactionId: number;
  account: string;
  debitCents: number;
  creditCents: number;
  metadata?: Record<string, unknown> | null;
}): void {
  sqliteClient
    .prepare(
      `INSERT INTO ledger_entries
       (transaction_id, account, debit_cents, credit_cents, metadata, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(
      params.transactionId,
      params.account,
      params.debitCents,
      params.creditCents,
      params.metadata ? JSON.stringify(params.metadata) : null,
      nowIso(),
    );
}

export function assertTransactionBalanced(transactionId: number): boolean {
  const row = sqliteClient
    .prepare(
      `SELECT COALESCE(SUM(debit_cents), 0) AS debits, COALESCE(SUM(credit_cents), 0) AS credits
       FROM ledger_entries
       WHERE transaction_id = ?`,
    )
    .get(transactionId) as { debits: number; credits: number };
  return row.debits === row.credits;
}

export function getIdempotencyRecord(key: string): {
  bodyHash: string;
  responseBody: string;
  statusCode: number;
  createdAt: string;
} | null {
  const row = sqliteClient
    .prepare(
      "SELECT body_hash, response_body, status_code, created_at FROM idempotency_keys WHERE idempotency_key = ?",
    )
    .get(key) as
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

export function saveIdempotencyRecord(params: {
  key: string;
  bodyHash: string;
  responseBody: string;
  statusCode: number;
}): void {
  sqliteClient
    .prepare(
      `INSERT OR REPLACE INTO idempotency_keys
       (idempotency_key, body_hash, response_body, status_code, created_at)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .run(params.key, params.bodyHash, params.responseBody, params.statusCode, nowIso());

  sqliteClient
    .prepare("DELETE FROM idempotency_keys WHERE datetime(created_at) < datetime('now', '-1 day')")
    .run();
}

export function markWebhookProcessed(provider: string, webhookId: string, receivedTs: number): boolean {
  try {
    sqliteClient
      .prepare(
        "INSERT INTO processed_webhooks (provider, webhook_id, received_ts, created_at) VALUES (?, ?, ?, ?)",
      )
      .run(provider, webhookId, receivedTs, nowIso());
    return true;
  } catch {
    return false;
  }
}

export function getLedgerUserCashNetCents(): number {
  const row = sqliteClient
    .prepare(
      "SELECT COALESCE(SUM(credit_cents - debit_cents), 0) AS net FROM ledger_entries WHERE account = 'user_cash'",
    )
    .get() as { net: number };
  return row.net ?? 0;
}

export function getUsersBalanceTotalCents(): number {
  const row = sqliteClient
    .prepare("SELECT COALESCE(SUM(balance_cents), 0) AS total FROM users")
    .get() as { total: number };
  return row.total ?? 0;
}

export function setFinancialFreeze(frozen: boolean): void {
  sqliteClient
    .prepare("INSERT OR REPLACE INTO financial_flags (key, value, updated_at) VALUES ('transactions_frozen', ?, ?)")
    .run(frozen ? "1" : "0", nowIso());
}

export function isFinancialFreezeEnabled(): boolean {
  const row = sqliteClient
    .prepare("SELECT value FROM financial_flags WHERE key = 'transactions_frozen'")
    .get() as { value: string } | undefined;
  return row?.value === "1";
}

export function writeReconciliationLog(status: string, mismatchCents: number, details: Record<string, unknown>): void {
  sqliteClient
    .prepare("INSERT INTO reconciliation_log (run_at, status, mismatch_cents, details) VALUES (?, ?, ?, ?)")
    .run(nowIso(), status, mismatchCents, JSON.stringify(details));
}
