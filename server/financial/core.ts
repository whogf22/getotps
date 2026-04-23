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

    CREATE TABLE IF NOT EXISTS login_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      email TEXT NOT NULL,
      event_type TEXT NOT NULL,
      fingerprint_hash TEXT NOT NULL,
      ip_address TEXT NOT NULL,
      asn TEXT NOT NULL,
      country TEXT NOT NULL,
      risk_score INTEGER NOT NULL DEFAULT 0,
      reasons TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_login_events_user_created ON login_events(user_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_login_events_fingerprint ON login_events(fingerprint_hash);

    CREATE TABLE IF NOT EXISTS abuse_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      ip_address TEXT,
      fingerprint_hash TEXT,
      event_type TEXT NOT NULL,
      details TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      resolved_at TEXT
    );

    CREATE TABLE IF NOT EXISTS abuse_blocks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      scope TEXT NOT NULL,
      scope_id TEXT NOT NULL,
      blocked_until TEXT NOT NULL,
      reason TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_abuse_blocks_scope ON abuse_blocks(scope, scope_id, blocked_until);

    CREATE TABLE IF NOT EXISTS api_key_usage (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      api_key TEXT NOT NULL,
      user_id INTEGER NOT NULL,
      used_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_api_key_usage_key_time ON api_key_usage(api_key, used_at);

    CREATE TABLE IF NOT EXISTS service_bundles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      service TEXT NOT NULL,
      quantity INTEGER NOT NULL,
      price_cents INTEGER NOT NULL,
      discount_pct INTEGER NOT NULL,
      expires_days INTEGER NOT NULL,
      is_active INTEGER NOT NULL DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS user_bundle_credits (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      bundle_id INTEGER NOT NULL,
      service TEXT NOT NULL,
      remaining_credits INTEGER NOT NULL,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_user_bundle_credits_user_service ON user_bundle_credits(user_id, service, expires_at);

    CREATE TABLE IF NOT EXISTS changelogs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      body TEXT NOT NULL,
      type TEXT NOT NULL,
      show_modal INTEGER NOT NULL DEFAULT 0,
      published_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS changelog_reads (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      changelog_id INTEGER NOT NULL,
      read_at TEXT NOT NULL,
      UNIQUE(user_id, changelog_id)
    );

    CREATE TABLE IF NOT EXISTS support_tickets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      subject TEXT NOT NULL,
      message TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'open',
      priority TEXT NOT NULL DEFAULT 'normal',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      resolved_at TEXT
    );

    CREATE TABLE IF NOT EXISTS support_ticket_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ticket_id INTEGER NOT NULL,
      sender_role TEXT NOT NULL,
      sender_id INTEGER,
      message TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS faq_entries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      question TEXT NOT NULL,
      answer TEXT NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS win_back_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      sent_at TEXT NOT NULL,
      bonus_cents INTEGER NOT NULL DEFAULT 50
    );
    CREATE INDEX IF NOT EXISTS idx_win_back_events_user_sent ON win_back_events(user_id, sent_at);

    CREATE TABLE IF NOT EXISTS analytics_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      event TEXT NOT NULL,
      metadata TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_analytics_events_user_event_created ON analytics_events(user_id, event, created_at);
  `);

  const cols = sqliteClient.pragma("table_info(users)") as { name: string }[];
  const names = new Set(cols.map((c) => c.name));
  if (!names.has("balance_cents")) {
    sqliteClient.exec("ALTER TABLE users ADD COLUMN balance_cents INTEGER NOT NULL DEFAULT 0");
  }
  sqliteClient.exec(
    "UPDATE users SET balance_cents = CAST(ROUND(CAST(balance AS REAL) * 100.0) AS INTEGER) WHERE balance_cents = 0 AND CAST(balance AS REAL) > 0",
  );
  if (!names.has("annual_badge")) {
    sqliteClient.exec("ALTER TABLE users ADD COLUMN annual_badge INTEGER NOT NULL DEFAULT 0");
  }
  if (!names.has("win_back_sent_at")) {
    sqliteClient.exec("ALTER TABLE users ADD COLUMN win_back_sent_at TEXT");
  }
  if (!names.has("first_deposit_at")) {
    sqliteClient.exec("ALTER TABLE users ADD COLUMN first_deposit_at TEXT");
  }

  sqliteClient.exec(`
    CREATE INDEX IF NOT EXISTS idx_orders_user_status_created ON orders(user_id, status, created_at);
    CREATE INDEX IF NOT EXISTS idx_orders_status_created ON orders(status, created_at);
    CREATE INDEX IF NOT EXISTS idx_ledger_entries_account_created ON ledger_entries(account, created_at);
  `);

  const requiredAccounts = ["user_cash", "revenue", "tellabot_cost", "circle_fees", "suspense"];
  const insertAccount = sqliteClient.prepare("INSERT OR IGNORE INTO ledger_accounts (account) VALUES (?)");
  for (const account of requiredAccounts) {
    insertAccount.run(account);
  }

  const seedBundle = sqliteClient.prepare(
    `INSERT OR IGNORE INTO service_bundles (name, service, quantity, price_cents, discount_pct, expires_days, is_active)
     VALUES (?, ?, ?, ?, ?, ?, 1)`,
  );
  seedBundle.run("Gmail Pack", "gmail", 10, 800, 20, 30);
  seedBundle.run("WhatsApp Pack", "whatsapp", 10, 800, 20, 30);
  seedBundle.run("Mega Pack", "mixed", 50, 4000, 20, 30);
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
