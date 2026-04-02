import { type User, type InsertUser, users, type Service, type InsertService, services, type Order, type InsertOrder, orders, type Transaction, type InsertTransaction, transactions, type CryptoDeposit, type InsertCryptoDeposit, cryptoDeposits } from "@shared/schema";
import { drizzle } from "drizzle-orm/better-sqlite3";
import Database from "better-sqlite3";
import { eq, and, desc, or } from "drizzle-orm";
import bcrypt from "bcryptjs";
import crypto from "crypto";

const sqlite = new Database("data.db");
sqlite.pragma("journal_mode = WAL");

export const db = drizzle(sqlite);

// Create tables if they don't exist
sqlite.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE,
    email TEXT NOT NULL UNIQUE,
    password TEXT NOT NULL,
    balance TEXT NOT NULL DEFAULT '0.00',
    api_key TEXT UNIQUE,
    role TEXT NOT NULL DEFAULT 'user'
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
    tellabot_mdn TEXT,
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
    stripe_session_id TEXT,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS crypto_deposits (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    currency TEXT NOT NULL,
    amount TEXT NOT NULL,
    crypto_amount TEXT,
    wallet_address TEXT NOT NULL,
    tx_hash TEXT,
    status TEXT NOT NULL DEFAULT 'pending',
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    completed_at TEXT
  );
`);

async function seedDatabase() {
  // Create default admin user
  const existingAdmin = db.select().from(users).where(eq(users.email, "admin@getotps.com")).get();
  if (!existingAdmin) {
    const hashedPassword = await bcrypt.hash("admin123", 10);
    const apiKey = crypto.randomBytes(32).toString("hex");
    db.insert(users).values({
      username: "admin",
      email: "admin@getotps.com",
      password: hashedPassword,
      balance: "100.00",
      apiKey,
      role: "admin",
    }).run();
    console.log("Created default admin user: admin@getotps.com / admin123");
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
}

export const storage = new DatabaseStorage();
