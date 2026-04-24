import {
  type User,
  type InsertUser,
  users,
  type Service,
  type InsertService,
  services,
  type Order,
  type InsertOrder,
  orders,
  type Transaction,
  type InsertTransaction,
  transactions,
  type CryptoDeposit,
  type InsertCryptoDeposit,
  cryptoDeposits,
  depositPollState,
  apiPlans,
  serviceBundles,
  userBundleCredits,
} from "@shared/schema";
import { eq, and, desc, or, sql, gt } from "drizzle-orm";
import bcrypt from "bcryptjs";
import crypto from "crypto";
import { db, getDrizzle, getQueryClient, runTransaction, pool } from "./db";
import { ADVISORY_SERVICES_CATALOG_SYNC } from "./db/locks";

export { runTransaction, pool, db };
export { pool as pgPool } from "./db";

function randomReferralCode(): string {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  let out = "";
  for (let i = 0; i < 8; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}

export const syncDb = {
  async getUser(id: number): Promise<User | undefined> {
    const rows = await getDrizzle().select().from(users).where(eq(users.id, id)).limit(1);
    return rows[0];
  },
  async updateUserBalance(userId: number, balance: string): Promise<void> {
    const cents = Math.round(Number.parseFloat(balance) * 100);
    await getDrizzle()
      .update(users)
      .set({ balance, balanceCents: cents })
      .where(eq(users.id, userId));
  },
  async createOrder(data: InsertOrder): Promise<Order> {
    const rows = await getDrizzle().insert(orders).values(data).returning();
    const row = rows[0];
    if (!row) throw new Error("createOrder failed");
    return row;
  },
  async createTransaction(data: InsertTransaction): Promise<Transaction> {
    const rows = await getDrizzle().insert(transactions).values(data).returning();
    const row = rows[0];
    if (!row) throw new Error("createTransaction failed");
    return row;
  },
  async cancelOrder(id: number): Promise<void> {
    await getDrizzle()
      .update(orders)
      .set({ status: "cancelled", completedAt: new Date().toISOString() })
      .where(eq(orders.id, id));
  },
  async getCryptoDeposit(id: number): Promise<CryptoDeposit | undefined> {
    const rows = await getDrizzle().select().from(cryptoDeposits).where(eq(cryptoDeposits.id, id)).limit(1);
    return rows[0];
  },
  async updateCryptoDeposit(id: number, data: Partial<CryptoDeposit>): Promise<void> {
    await getDrizzle().update(cryptoDeposits).set(data).where(eq(cryptoDeposits.id, id));
  },
};

export interface IStorage {
  getUser(id: number): Promise<User | undefined>;
  getUserByEmail(email: string): Promise<User | undefined>;
  getUserByUsername(username: string): Promise<User | undefined>;
  getUserByApiKey(apiKey: string): Promise<User | undefined>;
  createUser(user: { username: string; email: string; password: string }): Promise<User>;
  updateUserBalance(userId: number, balance: string): Promise<void>;
  updateUserPassword(userId: number, password: string): Promise<void>;
  setUserEmailVerification(
    userId: number,
    data: { tokenHash: string; expiresAt: Date; sentAt: Date },
  ): Promise<void>;
  markUserEmailVerified(userId: number): Promise<void>;
  setUserPasswordReset(userId: number, tokenHash: string, expiresAt: Date): Promise<void>;
  getUserByPasswordResetTokenHash(tokenHash: string): Promise<User | undefined>;
  clearUserPasswordReset(userId: number): Promise<void>;
  updateUserCircleWallet(userId: number, wallet: { id: string; address: string; blockchain: string }): Promise<void>;
  generateApiKey(userId: number): Promise<string>;
  getAllUsers(): Promise<User[]>;

  getAllServices(): Promise<Service[]>;
  getService(id: number): Promise<Service | undefined>;
  getServiceBySlug(slug: string): Promise<Service | undefined>;
  updateService(id: number, data: Partial<InsertService>): Promise<void>;
  upsertServices(serviceList: InsertService[]): Promise<void>;

  createOrder(data: InsertOrder): Promise<Order>;
  getOrder(id: number): Promise<Order | undefined>;
  getOrderByTellabotId(tellabotId: string): Promise<Order | undefined>;
  getUserOrders(userId: number): Promise<Order[]>;
  getActiveOrders(userId: number): Promise<Order[]>;
  updateOrderStatus(id: number, status: string, otpCode?: string): Promise<void>;
  updateOrderSms(id: number, smsMessages: string, otpCode?: string): Promise<void>;
  cancelOrder(id: number): Promise<void>;
  getAllOrders(): Promise<Order[]>;

  createTransaction(data: InsertTransaction): Promise<Transaction>;
  getUserTransactions(userId: number): Promise<Transaction[]>;

  createCryptoDeposit(data: InsertCryptoDeposit): Promise<CryptoDeposit>;
  getCryptoDeposit(id: number): Promise<CryptoDeposit | undefined>;
  getUserCryptoDeposits(userId: number): Promise<CryptoDeposit[]>;
  updateCryptoDeposit(id: number, data: Partial<CryptoDeposit>): Promise<void>;
  getAllPendingCryptoDeposits(): Promise<CryptoDeposit[]>;
  getAllCryptoDeposits(): Promise<CryptoDeposit[]>;
  getPendingDepositByUniqueAmount(uniqueAmount: string): Promise<CryptoDeposit | undefined>;
  depositTxIdExists(trongridTxId: string): Promise<boolean>;
  getDepositPollTimestamp(): Promise<number>;
  setDepositPollTimestamp(ts: number): Promise<void>;
  expireStalePendingDeposits(): Promise<number>;
  expireStaleOrders(): Promise<number>;

  getActiveServiceBundles(): Promise<(typeof serviceBundles.$inferSelect)[]>;
  getServiceBundleById(id: number): Promise<typeof serviceBundles.$inferSelect | undefined>;
  findUserBundleCredit(
    userId: number,
    serviceSlug: string,
  ): Promise<{ id: number; remainingCredits: number } | undefined>;
  decrementUserBundleCredit(id: number): Promise<void>;
  createUserBundleCredit(row: {
    userId: number;
    bundleId: number;
    service: string;
    remainingCredits: number;
    expiresAt: string;
    createdAt: string;
  }): Promise<void>;
  setUserAnnualBadge(userId: number, annualBadge: boolean): Promise<void>;
}

export class DatabaseStorage implements IStorage {
  async getUser(id: number): Promise<User | undefined> {
    const rows = await db.select().from(users).where(eq(users.id, id)).limit(1);
    return rows[0];
  }

  async getUserByEmail(email: string): Promise<User | undefined> {
    const rows = await db.select().from(users).where(eq(users.email, email)).limit(1);
    return rows[0];
  }

  async getUserByUsername(username: string): Promise<User | undefined> {
    const rows = await db.select().from(users).where(eq(users.username, username)).limit(1);
    return rows[0];
  }

  async getUserByApiKey(apiKey: string): Promise<User | undefined> {
    const rows = await db.select().from(users).where(eq(users.apiKey, apiKey)).limit(1);
    return rows[0];
  }

  async createUser(data: { username: string; email: string; password: string }): Promise<User> {
    const apiKey = crypto.randomBytes(32).toString("hex");
    let referralCode = randomReferralCode();
    for (let attempt = 0; attempt < 5; attempt++) {
      const clash = await db.select({ id: users.id }).from(users).where(eq(users.referralCode, referralCode)).limit(1);
      if (!clash[0]) break;
      referralCode = randomReferralCode();
    }
    const freeRows = await db.select({ id: apiPlans.id }).from(apiPlans).where(eq(apiPlans.name, "Free")).limit(1);
    const planId = freeRows[0]?.id ?? null;
    const rows = await db
      .insert(users)
      .values({
        ...data,
        apiKey,
        referralCode,
        planId: planId ?? undefined,
      })
      .returning();
    const row = rows[0];
    if (!row) throw new Error("createUser failed");
    return row;
  }

  async updateUserBalance(userId: number, balance: string): Promise<void> {
    const cents = Math.round(Number.parseFloat(balance) * 100);
    await db.update(users).set({ balance, balanceCents: cents }).where(eq(users.id, userId));
  }

  async updateUserPassword(userId: number, password: string): Promise<void> {
    await db.update(users).set({ password }).where(eq(users.id, userId));
  }

  async setUserEmailVerification(
    userId: number,
    data: { tokenHash: string; expiresAt: Date; sentAt: Date },
  ): Promise<void> {
    await db
      .update(users)
      .set({
        emailVerifyTokenHash: data.tokenHash,
        emailVerifyExpiresAt: data.expiresAt,
        emailVerifySentAt: data.sentAt,
      })
      .where(eq(users.id, userId));
  }

  async markUserEmailVerified(userId: number): Promise<void> {
    await db
      .update(users)
      .set({
        emailVerified: true,
        emailVerifyTokenHash: null,
        emailVerifyExpiresAt: null,
      })
      .where(eq(users.id, userId));
  }

  async setUserPasswordReset(userId: number, tokenHash: string, expiresAt: Date): Promise<void> {
    await db
      .update(users)
      .set({ passwordResetTokenHash: tokenHash, passwordResetExpiresAt: expiresAt })
      .where(eq(users.id, userId));
  }

  async getUserByPasswordResetTokenHash(tokenHash: string): Promise<User | undefined> {
    const rows = await db.select().from(users).where(eq(users.passwordResetTokenHash, tokenHash)).limit(1);
    return rows[0];
  }

  async clearUserPasswordReset(userId: number): Promise<void> {
    await db
      .update(users)
      .set({ passwordResetTokenHash: null, passwordResetExpiresAt: null })
      .where(eq(users.id, userId));
  }

  async updateUserCircleWallet(
    userId: number,
    wallet: { id: string; address: string; blockchain: string },
  ): Promise<void> {
    await db
      .update(users)
      .set({
        circleWalletId: wallet.id,
        circleWalletAddress: wallet.address,
        circleWalletBlockchain: wallet.blockchain,
      })
      .where(eq(users.id, userId));
  }

  async generateApiKey(userId: number): Promise<string> {
    const apiKey = crypto.randomBytes(32).toString("hex");
    await db.update(users).set({ apiKey }).where(eq(users.id, userId));
    return apiKey;
  }

  async getAllUsers(): Promise<User[]> {
    return db.select().from(users);
  }

  async getAllServices(): Promise<Service[]> {
    return db.select().from(services).where(eq(services.isActive, 1));
  }

  async getService(id: number): Promise<Service | undefined> {
    const rows = await db.select().from(services).where(eq(services.id, id)).limit(1);
    return rows[0];
  }

  async getServiceBySlug(slug: string): Promise<Service | undefined> {
    const rows = await db.select().from(services).where(eq(services.slug, slug)).limit(1);
    return rows[0];
  }

  async updateService(id: number, data: Partial<InsertService>): Promise<void> {
    await db.update(services).set(data).where(eq(services.id, id));
  }

  async upsertServices(serviceList: InsertService[]): Promise<void> {
    const bySlug = new Map<string, InsertService>();
    for (const row of serviceList) {
      bySlug.set(row.slug, row);
    }
    const unique = Array.from(bySlug.values());
    await runTransaction(async () => {
      await getQueryClient().query("SELECT pg_advisory_xact_lock($1, $2)", [
        ADVISORY_SERVICES_CATALOG_SYNC,
        1,
      ]);
      const d = getDrizzle();
      await d.delete(services);
      if (unique.length) await d.insert(services).values(unique);
    });
  }

  async createOrder(data: InsertOrder): Promise<Order> {
    const rows = await db.insert(orders).values(data).returning();
    const row = rows[0];
    if (!row) throw new Error("createOrder failed");
    return row;
  }

  async getOrder(id: number): Promise<Order | undefined> {
    const rows = await db.select().from(orders).where(eq(orders.id, id)).limit(1);
    return rows[0];
  }

  async getOrderByTellabotId(tellabotId: string): Promise<Order | undefined> {
    const rows = await db.select().from(orders).where(eq(orders.tellabotRequestId, tellabotId)).limit(1);
    return rows[0];
  }

  async getUserOrders(userId: number): Promise<Order[]> {
    return db.select().from(orders).where(eq(orders.userId, userId)).orderBy(desc(orders.id));
  }

  async getActiveOrders(userId: number): Promise<Order[]> {
    return db
      .select()
      .from(orders)
      .where(and(eq(orders.userId, userId), or(eq(orders.status, "waiting"), eq(orders.status, "received"))))
      .orderBy(desc(orders.id));
  }

  async updateOrderStatus(id: number, status: string, otpCode?: string): Promise<void> {
    const updateData: Partial<Order> = { status };
    if (otpCode) updateData.otpCode = otpCode;
    if (status === "completed") updateData.completedAt = new Date().toISOString();
    await db.update(orders).set(updateData).where(eq(orders.id, id));
  }

  async updateOrderSms(id: number, smsMessages: string, otpCode?: string): Promise<void> {
    const updateData: Partial<Order> = { smsMessages, status: "received" };
    if (otpCode) updateData.otpCode = otpCode;
    await db.update(orders).set(updateData).where(eq(orders.id, id));
  }

  async cancelOrder(id: number): Promise<void> {
    await db
      .update(orders)
      .set({ status: "cancelled", completedAt: new Date().toISOString() })
      .where(eq(orders.id, id));
  }

  async getAllOrders(): Promise<Order[]> {
    return db.select().from(orders).orderBy(desc(orders.id));
  }

  async createTransaction(data: InsertTransaction): Promise<Transaction> {
    const rows = await db.insert(transactions).values(data).returning();
    const row = rows[0];
    if (!row) throw new Error("createTransaction failed");
    return row;
  }

  async getUserTransactions(userId: number): Promise<Transaction[]> {
    return db.select().from(transactions).where(eq(transactions.userId, userId)).orderBy(desc(transactions.id));
  }

  async createCryptoDeposit(data: InsertCryptoDeposit): Promise<CryptoDeposit> {
    const rows = await db.insert(cryptoDeposits).values(data).returning();
    const row = rows[0];
    if (!row) throw new Error("createCryptoDeposit failed");
    return row;
  }

  async getCryptoDeposit(id: number): Promise<CryptoDeposit | undefined> {
    const rows = await db.select().from(cryptoDeposits).where(eq(cryptoDeposits.id, id)).limit(1);
    return rows[0];
  }

  async getUserCryptoDeposits(userId: number): Promise<CryptoDeposit[]> {
    return db.select().from(cryptoDeposits).where(eq(cryptoDeposits.userId, userId)).orderBy(desc(cryptoDeposits.id));
  }

  async updateCryptoDeposit(id: number, data: Partial<CryptoDeposit>): Promise<void> {
    await db.update(cryptoDeposits).set(data).where(eq(cryptoDeposits.id, id));
  }

  async getAllPendingCryptoDeposits(): Promise<CryptoDeposit[]> {
    return db.select().from(cryptoDeposits).where(eq(cryptoDeposits.status, "pending")).orderBy(desc(cryptoDeposits.id));
  }

  async getAllCryptoDeposits(): Promise<CryptoDeposit[]> {
    return db.select().from(cryptoDeposits).orderBy(desc(cryptoDeposits.id));
  }

  async getPendingDepositByUniqueAmount(uniqueAmount: string): Promise<CryptoDeposit | undefined> {
    const rows = await db
      .select()
      .from(cryptoDeposits)
      .where(
        and(
          eq(cryptoDeposits.uniqueAmount, uniqueAmount),
          or(eq(cryptoDeposits.status, "pending"), eq(cryptoDeposits.status, "confirming")),
        ),
      )
      .limit(1);
    return rows[0];
  }

  async depositTxIdExists(trongridTxId: string): Promise<boolean> {
    const rows = await db.select({ id: cryptoDeposits.id }).from(cryptoDeposits).where(eq(cryptoDeposits.trongridTxId, trongridTxId)).limit(1);
    return rows.length > 0;
  }

  async getDepositPollTimestamp(): Promise<number> {
    const rows = await db.select().from(depositPollState).where(eq(depositPollState.id, 1)).limit(1);
    return rows[0]?.lastTimestamp ?? 0;
  }

  async setDepositPollTimestamp(ts: number): Promise<void> {
    await db
      .insert(depositPollState)
      .values({ id: 1, lastTimestamp: ts, updatedAt: new Date().toISOString() })
      .onConflictDoUpdate({
        target: depositPollState.id,
        set: { lastTimestamp: ts, updatedAt: new Date().toISOString() },
      });
  }

  async expireStalePendingDeposits(): Promise<number> {
    const now = new Date().toISOString();
    const r = await pool.query(
      `UPDATE crypto_deposits SET status = 'expired' WHERE status = 'pending' AND expires_at < $1`,
      [now],
    );
    return r.rowCount ?? 0;
  }

  async expireStaleOrders(): Promise<number> {
    const now = new Date().toISOString();
    const r = await pool.query(
      `UPDATE orders SET status = 'expired', completed_at = $1::text
       WHERE status IN ('waiting', 'received') AND expires_at < $1::text`,
      [now],
    );
    return r.rowCount ?? 0;
  }

  async getActiveServiceBundles() {
    return db
      .select()
      .from(serviceBundles)
      .where(eq(serviceBundles.isActive, 1))
      .orderBy(serviceBundles.id);
  }

  async getServiceBundleById(id: number) {
    const rows = await db
      .select()
      .from(serviceBundles)
      .where(and(eq(serviceBundles.id, id), eq(serviceBundles.isActive, 1)))
      .limit(1);
    return rows[0];
  }

  async findUserBundleCredit(userId: number, serviceSlug: string) {
    const now = new Date().toISOString();
    const rows = await db
      .select({ id: userBundleCredits.id, remainingCredits: userBundleCredits.remainingCredits })
      .from(userBundleCredits)
      .where(
        and(
          eq(userBundleCredits.userId, userId),
          or(eq(userBundleCredits.service, serviceSlug), eq(userBundleCredits.service, "mixed")),
          sql`${userBundleCredits.remainingCredits} > 0`,
          gt(userBundleCredits.expiresAt, now),
        ),
      )
      .orderBy(userBundleCredits.id)
      .limit(1);
    return rows[0];
  }

  async decrementUserBundleCredit(id: number) {
    await db
      .update(userBundleCredits)
      .set({ remainingCredits: sql`${userBundleCredits.remainingCredits} - 1` })
      .where(eq(userBundleCredits.id, id));
  }

  async createUserBundleCredit(row: {
    userId: number;
    bundleId: number;
    service: string;
    remainingCredits: number;
    expiresAt: string;
    createdAt: string;
  }) {
    await db.insert(userBundleCredits).values(row);
  }

  async setUserAnnualBadge(userId: number, annualBadge: boolean) {
    await db.update(users).set({ annualBadge }).where(eq(users.id, userId));
  }
}

export const storage = new DatabaseStorage();

async function seedDatabase(): Promise<void> {
  const adminEmail = process.env.ADMIN_EMAIL || "admin@getotps.com";
  if (process.env.NODE_ENV === "production" && !process.env.ADMIN_PASSWORD) {
    throw new Error("ADMIN_PASSWORD must be set in production");
  }
  const adminPassword = process.env.ADMIN_PASSWORD || "admin123";
  const adminUsername = process.env.ADMIN_USERNAME || "admin";

  const existing = await db
    .select()
    .from(users)
    .where(or(eq(users.email, adminEmail), eq(users.username, adminUsername)))
    .limit(1);
  if (existing[0]) return;

  const hashedPassword = await bcrypt.hash(adminPassword, 10);
  const apiKey = crypto.randomBytes(32).toString("hex");
  const freeRows = await db.select({ id: apiPlans.id }).from(apiPlans).where(eq(apiPlans.name, "Free")).limit(1);
  const planId = freeRows[0]?.id ?? null;
  let referralCode = randomReferralCode();
  await db.insert(users).values({
    username: adminUsername,
    email: adminEmail,
    password: hashedPassword,
    balance: "100.00",
    balanceCents: 10_000,
    apiKey,
    role: "admin",
    emailVerified: true,
    referralCode,
    planId: planId ?? undefined,
  });
  console.log(`Created admin user: ${adminEmail}`);
}

void (async () => {
  const { initFinancialSchema } = await import("./financial/core");
  await initFinancialSchema();
  await seedDatabase();
})().catch(console.error);
