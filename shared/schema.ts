import { sqliteTable, text, integer, uniqueIndex } from "drizzle-orm/sqlite-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// Users table
export const users = sqliteTable("users", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  username: text("username").notNull().unique(),
  email: text("email").notNull().unique(),
  password: text("password").notNull(),
  balance: text("balance").notNull().default("0.00"),
  apiKey: text("api_key").unique(),
  role: text("role").notNull().default("user"),
});

export const insertUserSchema = createInsertSchema(users).omit({ id: true, balance: true, apiKey: true, role: true });
export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof users.$inferSelect;

// Services table
export const services = sqliteTable("services", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  price: text("price").notNull(),
  icon: text("icon"),
  category: text("category"),
  isActive: integer("is_active").notNull().default(1),
});

export const insertServiceSchema = createInsertSchema(services).omit({ id: true });
export type InsertService = z.infer<typeof insertServiceSchema>;
export type Service = typeof services.$inferSelect;

// Orders table
export const orders = sqliteTable("orders", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: integer("user_id").notNull(),
  serviceId: integer("service_id").notNull(),
  serviceName: text("service_name").notNull().default(""),
  phoneNumber: text("phone_number").notNull(),
  status: text("status").notNull().default("waiting"),
  otpCode: text("otp_code"),
  smsMessages: text("sms_messages"), // JSON array of received SMS
  price: text("price").notNull(),
  tellabotRequestId: text("tellabot_request_id"), // TellaBot request ID
  tellabotMdn: text("tellabot_mdn"), // raw MDN from TellaBot
  createdAt: text("created_at").notNull(),
  expiresAt: text("expires_at").notNull(),
  completedAt: text("completed_at"),
});

export const insertOrderSchema = createInsertSchema(orders).omit({ id: true });
export type InsertOrder = z.infer<typeof insertOrderSchema>;
export type Order = typeof orders.$inferSelect;

// Transactions table (append-only ledger)
export const transactions = sqliteTable("transactions", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: integer("user_id").notNull(),
  type: text("type").notNull(), // deposit/purchase/refund/reversal
  amount: text("amount").notNull(),
  description: text("description"),
  orderId: integer("order_id"),
  paymentRef: text("payment_ref"),
  idempotencyKey: text("idempotency_key"),
  createdAt: text("created_at").notNull(),
});

export const insertTransactionSchema = createInsertSchema(transactions).omit({ id: true });
export type InsertTransaction = z.infer<typeof insertTransactionSchema>;
export type Transaction = typeof transactions.$inferSelect;

// Crypto deposits table
export const cryptoDeposits = sqliteTable("crypto_deposits", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: integer("user_id").notNull(),
  currency: text("currency").notNull(), // BTC, ETH, USDT_TRC20, USDT_ERC20, USDC, LTC
  amount: text("amount").notNull(), // USD amount requested
  cryptoAmount: text("crypto_amount"), // amount in crypto
  uniqueAmount: text("unique_amount"), // exact amount with random suffix for matching (USDT TRC20)
  walletAddress: text("wallet_address").notNull(), // our receiving address
  txHash: text("tx_hash"), // user-submitted transaction hash
  trongridTxId: text("trongrid_tx_id"), // on-chain tx ID from TronGrid (authoritative)
  confirmedAmount: text("confirmed_amount"), // actual amount received on-chain
  status: text("status").notNull().default("pending"), // pending/confirming/completed/expired
  createdAt: text("created_at").notNull(),
  expiresAt: text("expires_at").notNull(),
  completedAt: text("completed_at"),
});

export const insertCryptoDepositSchema = createInsertSchema(cryptoDeposits).omit({ id: true });
export type InsertCryptoDeposit = z.infer<typeof insertCryptoDepositSchema>;
export type CryptoDeposit = typeof cryptoDeposits.$inferSelect;

// Idempotency keys table
export const idempotencyKeys = sqliteTable("idempotency_keys", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  key: text("key").notNull(),
  userId: integer("user_id").notNull(),
  route: text("route").notNull(),
  method: text("method").notNull(),
  status: text("status").notNull().default("processing"), // processing/success/failed
  statusCode: integer("status_code"),
  responseBody: text("response_body"), // JSON snapshot
  createdAt: text("created_at").notNull(),
  expiresAt: text("expires_at").notNull(),
}, (table) => [
  uniqueIndex("idx_idempotency_key_user_route").on(table.key, table.userId, table.route),
]);

export type IdempotencyKey = typeof idempotencyKeys.$inferSelect;

// Audit logs table (immutable)
export const auditLogs = sqliteTable("audit_logs", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: integer("user_id"),
  actorRole: text("actor_role"),
  ip: text("ip"),
  userAgent: text("user_agent"),
  action: text("action").notNull(),
  targetType: text("target_type"),
  targetId: text("target_id"),
  amount: text("amount"),
  status: text("status"),
  requestId: text("request_id"),
  idempotencyKey: text("idempotency_key"),
  metadata: text("metadata"), // JSON
  createdAt: text("created_at").notNull(),
});

export type AuditLog = typeof auditLogs.$inferSelect;
