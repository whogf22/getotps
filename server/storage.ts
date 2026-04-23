import { type User, type InsertUser, users, type Service, type InsertService, services, type Order, type InsertOrder, orders, type Transaction, type InsertTransaction, transactions, type CryptoDeposit, type InsertCryptoDeposit, cryptoDeposits } from "@shared/schema";
import { drizzle } from "drizzle-orm/better-sqlite3";
import Database from "better-sqlite3";
import { eq, and, desc, or } from "drizzle-orm";
import bcrypt from "bcryptjs";
import crypto from "crypto";

const sqlite = new Database(process.env.DATABASE_PATH || "data.db");
sqlite.pragma("journal_mode = WAL");

export const db = drizzle(sqlite);

// Export raw sqlite instance for session store and transactions
export { sqlite as sqliteClient };

// Atomic transaction helper — all operations inside fn succeed or all roll back
// Note: better-sqlite3 is synchronous, so all Drizzle operations inside are sync
export function runTransaction<T>(fn: () => T): T {
  const txn = sqlite.transaction(fn);
  return txn();
}

// Synchronous DB helpers for use inside transactions (no async wrappers)
export const syncDb = {
  getUser(id: number): User | undefined {
    return db.select().from(users).where(eq(users.id, id)).get();
  },
  updateUserBalance(userId: number, balance: string): void {
    db.update(users).set({ balance }).where(eq(users.id, userId)).run();
  },
  createOrder(data: InsertOrder): Order {
    return db.insert(orders).values(data).returning().get();
  },
  createTransaction(data: InsertTransaction): Transaction {
    return db.insert(transactions).values(data).returning().get();
  },
  cancelOrder(id: number): void {
    db.update(orders).set({ status: "cancelled", completedAt: new Date().toISOString() }).where(eq(orders.id, id)).run();
  },
  getCryptoDeposit(id: number): CryptoDeposit | undefined {
    return db.select().from(cryptoDeposits).where(eq(cryptoDeposits.id, id)).get();
  },
  updateCryptoDeposit(id: number, data: Partial<CryptoDeposit>): void {
    db.update(cryptoDeposits).set(data as any).where(eq(cryptoDeposits.id, id)).run();
  },
};

// Create tables if they don't exist
sqlite.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE,
    email TEXT NOT NULL UNIQUE,
    password TEXT NOT NULL,
    balance TEXT NOT NULL DEFAULT '0.00',
    api_key TEXT UNIQUE,
    role TEXT NOT NULL DEFAULT 'user',
    circle_wallet_id TEXT,
    circle_wallet_address TEXT,
    circle_wallet_blockchain TEXT
  );

  CREATE TABLE IF NOT EXISTS services (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    slug TEXT NOT NULL UNIQUE,
    price TEXT NOT NULL,
    icon TEXT,
    category TEXT,
    is_active INTEGER NOT NULL DEFAULT 1
  );

  CREATE TABLE IF NOT EXISTS orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    service_id INTEGER NOT NULL,
    service_name TEXT NOT NULL DEFAULT '',
    phone_number TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'waiting',
    otp_code TEXT,
    sms_messages TEXT,
    price TEXT NOT NULL,
    tellabot_request_id TEXT,
    activation_id TEXT,
    tellabot_mdn TEXT,
    cost_price TEXT,
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    completed_at TEXT
  );

  CREATE TABLE IF NOT EXISTS transactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    type TEXT NOT NULL,
    amount TEXT NOT NULL,
    description TEXT,
    order_id INTEGER,
    payment_ref TEXT,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS crypto_deposits (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    currency TEXT NOT NULL,
    amount TEXT NOT NULL,
    crypto_amount TEXT,
    unique_amount TEXT,
    wallet_address TEXT NOT NULL,
    tx_hash TEXT,
    trongrid_tx_id TEXT,
    confirmed_amount TEXT,
    status TEXT NOT NULL DEFAULT 'pending',
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    completed_at TEXT
  );

  CREATE TABLE IF NOT EXISTS deposit_poll_state (
    id INTEGER PRIMARY KEY DEFAULT 1,
    last_timestamp INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL DEFAULT ''
  );

  -- Performance indexes
  CREATE INDEX IF NOT EXISTS idx_orders_user_status ON orders(user_id, status);
  CREATE INDEX IF NOT EXISTS idx_orders_expires_status ON orders(expires_at, status);
  CREATE INDEX IF NOT EXISTS idx_transactions_user ON transactions(user_id);
  CREATE INDEX IF NOT EXISTS idx_crypto_deposits_user ON crypto_deposits(user_id);
  CREATE INDEX IF NOT EXISTS idx_crypto_deposits_status ON crypto_deposits(status);
  CREATE INDEX IF NOT EXISTS idx_crypto_deposits_unique_amount ON crypto_deposits(unique_amount, status);
  CREATE INDEX IF NOT EXISTS idx_crypto_deposits_trongrid_tx ON crypto_deposits(trongrid_tx_id);
`);

// Migrate: add Circle wallet columns to users
try {
  const userCols = sqlite.pragma("table_info(users)") as { name: string }[];
  const userColNames = userCols.map((c) => c.name);
  if (!userColNames.includes("circle_wallet_id")) {
    sqlite.exec("ALTER TABLE users ADD COLUMN circle_wallet_id TEXT");
  }
  if (!userColNames.includes("circle_wallet_address")) {
    sqlite.exec("ALTER TABLE users ADD COLUMN circle_wallet_address TEXT");
  }
  if (!userColNames.includes("circle_wallet_blockchain")) {
    sqlite.exec("ALTER TABLE users ADD COLUMN circle_wallet_blockchain TEXT");
  }
} catch (err) {
  console.error("User circle wallet migration failed (non-fatal):", err);
}

// Migrate: add activation_id/cost_price to orders
try {
  const orderCols = sqlite.pragma("table_info(orders)") as { name: string }[];
  const orderColNames = orderCols.map((c) => c.name);
  if (!orderColNames.includes("activation_id")) {
    sqlite.exec("ALTER TABLE orders ADD COLUMN activation_id TEXT");
  }
  if (!orderColNames.includes("cost_price")) {
    sqlite.exec("ALTER TABLE orders ADD COLUMN cost_price TEXT");
  }
} catch (err) {
  console.error("Orders migration failed (non-fatal):", err);
}

// Migrate: rename stripe_session_id -> payment_ref for existing databases
try {
  const columns = sqlite.pragma("table_info(transactions)") as { name: string }[];
  const hasOldColumn = columns.some(c => c.name === "stripe_session_id");
  const hasNewColumn = columns.some(c => c.name === "payment_ref");
  if (hasOldColumn && !hasNewColumn) {
    sqlite.exec("ALTER TABLE transactions RENAME COLUMN stripe_session_id TO payment_ref");
    console.log("Migration: renamed stripe_session_id -> payment_ref");
  }
} catch (err) {
  console.error("Migration check failed (non-fatal):", err);
}

// Migrate: add TronGrid columns to crypto_deposits for existing databases
try {
  const cols = sqlite.pragma("table_info(crypto_deposits)") as { name: string }[];
  const colNames = cols.map(c => c.name);
  if (!colNames.includes("unique_amount")) {
    sqlite.exec("ALTER TABLE crypto_deposits ADD COLUMN unique_amount TEXT");
    console.log("Migration: added unique_amount to crypto_deposits");
  }
  if (!colNames.includes("trongrid_tx_id")) {
    sqlite.exec("ALTER TABLE crypto_deposits ADD COLUMN trongrid_tx_id TEXT");
    console.log("Migration: added trongrid_tx_id to crypto_deposits");
  }
  if (!colNames.includes("confirmed_amount")) {
    sqlite.exec("ALTER TABLE crypto_deposits ADD COLUMN confirmed_amount TEXT");
    console.log("Migration: added confirmed_amount to crypto_deposits");
  }
} catch (err) {
  console.error("Crypto deposits migration failed (non-fatal):", err);
}

// Ensure deposit_poll_state table and seed row exist
try {
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS deposit_poll_state (
      id INTEGER PRIMARY KEY DEFAULT 1,
      last_timestamp INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL DEFAULT ''
    )
  `);
  const pollState = sqlite.prepare("SELECT id FROM deposit_poll_state WHERE id = 1").get();
  if (!pollState) {
    sqlite.prepare("INSERT INTO deposit_poll_state (id, last_timestamp, updated_at) VALUES (1, 0, '')").run();
  }
} catch (err) {
  console.error("deposit_poll_state init failed (non-fatal):", err);
}

async function seedDatabase() {
  const adminEmail = process.env.ADMIN_EMAIL || "admin@getotps.com";
  const adminPassword = process.env.ADMIN_PASSWORD || (process.env.NODE_ENV === "production" ? (() => { throw new Error("ADMIN_PASSWORD must be set in production"); })() : "admin123");
  const adminUsername = process.env.ADMIN_USERNAME || "admin";

  // Create default admin user
  const existingAdmin = db.select().from(users).where(eq(users.email, adminEmail)).get();
  if (!existingAdmin) {
    const hashedPassword = await bcrypt.hash(adminPassword, 10);
    const apiKey = crypto.randomBytes(32).toString("hex");
    db.insert(users).values({
      username: adminUsername,
      email: adminEmail,
      password: hashedPassword,
      balance: "100.00",
      apiKey,
      role: "admin",
    }).run();
    console.log(`Created admin user: ${adminEmail}`);
  }
}

seedDatabase().catch(console.error);

export interface IStorage {
  // Users
  getUser(id: number): Promise<User | undefined>;
  getUserByEmail(email: string): Promise<User | undefined>;
  getUserByUsername(username: string): Promise<User | undefined>;
  getUserByApiKey(apiKey: string): Promise<User | undefined>;
  createUser(user: { username: string; email: string; password: string }): Promise<User>;
  updateUserBalance(userId: number, balance: string): Promise<void>;
  updateUserPassword(userId: number, password: string): Promise<void>;
  updateUserCircleWallet(userId: number, wallet: { id: string; address: string; blockchain: string }): Promise<void>;
  generateApiKey(userId: number): Promise<string>;
  getAllUsers(): Promise<User[]>;

  // Services (now backed by TellaBot — cached in DB)
  getAllServices(): Promise<Service[]>;
  getService(id: number): Promise<Service | undefined>;
  getServiceBySlug(slug: string): Promise<Service | undefined>;
  updateService(id: number, data: Partial<InsertService>): Promise<void>;
  upsertServices(serviceList: InsertService[]): Promise<void>;

  // Orders
  createOrder(data: InsertOrder): Promise<Order>;
  getOrder(id: number): Promise<Order | undefined>;
  getOrderByTellabotId(tellabotId: string): Promise<Order | undefined>;
  getUserOrders(userId: number): Promise<Order[]>;
  getActiveOrders(userId: number): Promise<Order[]>;
  updateOrderStatus(id: number, status: string, otpCode?: string): Promise<void>;
  updateOrderSms(id: number, smsMessages: string, otpCode?: string): Promise<void>;
  cancelOrder(id: number): Promise<void>;
  getAllOrders(): Promise<Order[]>;

  // Transactions
  createTransaction(data: InsertTransaction): Promise<Transaction>;
  getUserTransactions(userId: number): Promise<Transaction[]>;

  // Crypto Deposits
  createCryptoDeposit(data: InsertCryptoDeposit): Promise<CryptoDeposit>;
  getCryptoDeposit(id: number): Promise<CryptoDeposit | undefined>;
  getUserCryptoDeposits(userId: number): Promise<CryptoDeposit[]>;
  updateCryptoDeposit(id: number, data: Partial<CryptoDeposit>): Promise<void>;
  getAllPendingCryptoDeposits(): Promise<CryptoDeposit[]>;
  getAllCryptoDeposits(): Promise<CryptoDeposit[]>;
  getPendingDepositByUniqueAmount(uniqueAmount: string): Promise<CryptoDeposit | undefined>;
  depositTxIdExists(trongridTxId: string): boolean;
  getDepositPollTimestamp(): number;
  setDepositPollTimestamp(ts: number): void;
  expireStalePendingDeposits(): number;
  expireStaleOrders(): Promise<number>;
}

export class DatabaseStorage implements IStorage {
  async getUser(id: number): Promise<User | undefined> {
    return db.select().from(users).where(eq(users.id, id)).get();
  }

  async getUserByEmail(email: string): Promise<User | undefined> {
    return db.select().from(users).where(eq(users.email, email)).get();
  }

  async getUserByUsername(username: string): Promise<User | undefined> {
    return db.select().from(users).where(eq(users.username, username)).get();
  }

  async getUserByApiKey(apiKey: string): Promise<User | undefined> {
    return db.select().from(users).where(eq(users.apiKey, apiKey)).get();
  }

  async createUser(data: { username: string; email: string; password: string }): Promise<User> {
    const apiKey = crypto.randomBytes(32).toString("hex");
    return db.insert(users).values({ ...data, apiKey }).returning().get();
  }

  async updateUserBalance(userId: number, balance: string): Promise<void> {
    db.update(users).set({ balance }).where(eq(users.id, userId)).run();
  }

  async updateUserPassword(userId: number, password: string): Promise<void> {
    db.update(users).set({ password }).where(eq(users.id, userId)).run();
  }

  async updateUserCircleWallet(
    userId: number,
    wallet: { id: string; address: string; blockchain: string },
  ): Promise<void> {
    db.update(users)
      .set({
        circleWalletId: wallet.id,
        circleWalletAddress: wallet.address,
        circleWalletBlockchain: wallet.blockchain,
      })
      .where(eq(users.id, userId))
      .run();
  }

  async generateApiKey(userId: number): Promise<string> {
    const apiKey = crypto.randomBytes(32).toString("hex");
    db.update(users).set({ apiKey }).where(eq(users.id, userId)).run();
    return apiKey;
  }

  async getAllUsers(): Promise<User[]> {
    return db.select().from(users).all();
  }

  async getAllServices(): Promise<Service[]> {
    return db.select().from(services).where(eq(services.isActive, 1)).all();
  }

  async getService(id: number): Promise<Service | undefined> {
    return db.select().from(services).where(eq(services.id, id)).get();
  }

  async getServiceBySlug(slug: string): Promise<Service | undefined> {
    return db.select().from(services).where(eq(services.slug, slug)).get();
  }

  async updateService(id: number, data: Partial<InsertService>): Promise<void> {
    db.update(services).set(data).where(eq(services.id, id)).run();
  }

  async upsertServices(serviceList: InsertService[]): Promise<void> {
    // Clear existing and re-insert (fast for cached data)
    db.delete(services).run();
    for (const svc of serviceList) {
      db.insert(services).values(svc).run();
    }
  }

  async createOrder(data: InsertOrder): Promise<Order> {
    return db.insert(orders).values(data).returning().get();
  }

  async getOrder(id: number): Promise<Order | undefined> {
    return db.select().from(orders).where(eq(orders.id, id)).get();
  }

  async getOrderByTellabotId(tellabotId: string): Promise<Order | undefined> {
    return db.select().from(orders).where(eq(orders.tellabotRequestId, tellabotId)).get();
  }

  async getUserOrders(userId: number): Promise<Order[]> {
    return db.select().from(orders).where(eq(orders.userId, userId)).orderBy(desc(orders.id)).all();
  }

  async getActiveOrders(userId: number): Promise<Order[]> {
    return db.select().from(orders)
      .where(and(
        eq(orders.userId, userId),
        or(eq(orders.status, "waiting"), eq(orders.status, "received"))
      ))
      .orderBy(desc(orders.id))
      .all();
  }

  async updateOrderStatus(id: number, status: string, otpCode?: string): Promise<void> {
    const updateData: any = { status };
    if (otpCode) updateData.otpCode = otpCode;
    if (status === "completed") updateData.completedAt = new Date().toISOString();
    db.update(orders).set(updateData).where(eq(orders.id, id)).run();
  }

  async updateOrderSms(id: number, smsMessages: string, otpCode?: string): Promise<void> {
    const updateData: any = { smsMessages, status: "received" };
    if (otpCode) updateData.otpCode = otpCode;
    db.update(orders).set(updateData).where(eq(orders.id, id)).run();
  }

  async cancelOrder(id: number): Promise<void> {
    db.update(orders).set({ status: "cancelled", completedAt: new Date().toISOString() }).where(eq(orders.id, id)).run();
  }

  async getAllOrders(): Promise<Order[]> {
    return db.select().from(orders).orderBy(desc(orders.id)).all();
  }

  async createTransaction(data: InsertTransaction): Promise<Transaction> {
    return db.insert(transactions).values(data).returning().get();
  }

  async getUserTransactions(userId: number): Promise<Transaction[]> {
    return db.select().from(transactions).where(eq(transactions.userId, userId)).orderBy(desc(transactions.id)).all();
  }

  async createCryptoDeposit(data: InsertCryptoDeposit): Promise<CryptoDeposit> {
    return db.insert(cryptoDeposits).values(data).returning().get();
  }

  async getCryptoDeposit(id: number): Promise<CryptoDeposit | undefined> {
    return db.select().from(cryptoDeposits).where(eq(cryptoDeposits.id, id)).get();
  }

  async getUserCryptoDeposits(userId: number): Promise<CryptoDeposit[]> {
    return db.select().from(cryptoDeposits).where(eq(cryptoDeposits.userId, userId)).orderBy(desc(cryptoDeposits.id)).all();
  }

  async updateCryptoDeposit(id: number, data: Partial<CryptoDeposit>): Promise<void> {
    db.update(cryptoDeposits).set(data as any).where(eq(cryptoDeposits.id, id)).run();
  }

  async getAllPendingCryptoDeposits(): Promise<CryptoDeposit[]> {
    return db.select().from(cryptoDeposits).where(eq(cryptoDeposits.status, "pending")).orderBy(desc(cryptoDeposits.id)).all();
  }

  async getAllCryptoDeposits(): Promise<CryptoDeposit[]> {
    return db.select().from(cryptoDeposits).orderBy(desc(cryptoDeposits.id)).all();
  }

  async getPendingDepositByUniqueAmount(uniqueAmount: string): Promise<CryptoDeposit | undefined> {
    return db.select().from(cryptoDeposits)
      .where(and(
        eq(cryptoDeposits.uniqueAmount, uniqueAmount),
        or(eq(cryptoDeposits.status, "pending"), eq(cryptoDeposits.status, "confirming"))
      ))
      .get();
  }

  depositTxIdExists(trongridTxId: string): boolean {
    const row = db.select({ id: cryptoDeposits.id }).from(cryptoDeposits)
      .where(eq(cryptoDeposits.trongridTxId, trongridTxId))
      .get();
    return !!row;
  }

  getDepositPollTimestamp(): number {
    const row = sqlite.prepare("SELECT last_timestamp FROM deposit_poll_state WHERE id = 1").get() as { last_timestamp: number } | undefined;
    return row?.last_timestamp || 0;
  }

  setDepositPollTimestamp(ts: number): void {
    sqlite.prepare("UPDATE deposit_poll_state SET last_timestamp = ?, updated_at = ? WHERE id = 1").run(ts, new Date().toISOString());
  }

  expireStalePendingDeposits(): number {
    const now = new Date().toISOString();
    const result = sqlite.prepare(
      "UPDATE crypto_deposits SET status = 'expired' WHERE status = 'pending' AND expires_at < ?"
    ).run(now);
    return result.changes;
  }

  async expireStaleOrders(): Promise<number> {
    const now = new Date().toISOString();
    const result = sqlite
      .prepare(
        "UPDATE orders SET status = 'expired', completed_at = ? WHERE status IN ('waiting', 'received') AND expires_at < ?",
      )
      .run(now, now);
    return result.changes;
  }
}

export const storage = new DatabaseStorage();
