import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";
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

// Transactions table
export const transactions = sqliteTable("transactions", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: integer("user_id").notNull(),
  type: text("type").notNull(), // deposit/purchase/refund
  amount: text("amount").notNull(),
  description: text("description"),
  orderId: integer("order_id"),
  stripeSessionId: text("stripe_session_id"),
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
  walletAddress: text("wallet_address").notNull(), // our receiving address
  txHash: text("tx_hash"), // user-submitted transaction hash
  status: text("status").notNull().default("pending"), // pending/confirming/completed/expired
  createdAt: text("created_at").notNull(),
  expiresAt: text("expires_at").notNull(),
  completedAt: text("completed_at"),
});

export const insertCryptoDepositSchema = createInsertSchema(cryptoDeposits).omit({ id: true });
export type InsertCryptoDeposit = z.infer<typeof insertCryptoDepositSchema>;
export type CryptoDeposit = typeof cryptoDeposits.$inferSelect;
