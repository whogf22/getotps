import {
  pgTable,
  serial,
  text,
  integer,
  boolean,
  timestamp,
  jsonb,
  uniqueIndex,
  index,
  primaryKey,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const apiPlans = pgTable("api_plans", {
  id: serial("id").primaryKey(),
  name: text("name").notNull().unique(),
  monthlyPriceCents: integer("monthly_price_cents").notNull(),
  rateLimitPerMin: integer("rate_limit_per_min").notNull(),
  discountPct: integer("discount_pct").notNull().default(0),
  active: boolean("active").notNull().default(true),
});

export const users = pgTable(
  "users",
  {
    id: serial("id").primaryKey(),
    username: text("username").notNull().unique(),
    email: text("email").notNull().unique(),
    password: text("password").notNull(),
    balance: text("balance").notNull().default("0.00"),
    balanceCents: integer("balance_cents").notNull().default(0),
    apiKey: text("api_key").unique(),
    role: text("role").notNull().default("user"),
    circleWalletId: text("circle_wallet_id"),
    circleWalletAddress: text("circle_wallet_address"),
    circleWalletBlockchain: text("circle_wallet_blockchain"),
    annualBadge: boolean("annual_badge").notNull().default(false),
    winBackSentAt: timestamp("win_back_sent_at", { withTimezone: true }),
    firstDepositAt: timestamp("first_deposit_at", { withTimezone: true }),
    emailVerified: boolean("email_verified").notNull().default(false),
    emailVerifyTokenHash: text("email_verify_token_hash"),
    emailVerifyExpiresAt: timestamp("email_verify_expires_at", { withTimezone: true }),
    emailVerifySentAt: timestamp("email_verify_sent_at", { withTimezone: true }),
    passwordResetTokenHash: text("password_reset_token_hash"),
    passwordResetExpiresAt: timestamp("password_reset_expires_at", { withTimezone: true }),
    referralCode: text("referral_code").unique(),
    referredByUserId: integer("referred_by_user_id"),
    planId: integer("plan_id").references(() => apiPlans.id),
    adminTotpSecret: text("admin_totp_secret"),
    adminTotpEnabled: boolean("admin_totp_enabled").notNull().default(false),
    banned: boolean("banned").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    referralIdx: index("idx_users_referred_by").on(t.referredByUserId),
  }),
);

export const insertUserSchema = createInsertSchema(users).omit({
  id: true,
  balance: true,
  apiKey: true,
  role: true,
  balanceCents: true,
  createdAt: true,
});
export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof users.$inferSelect;

export const services = pgTable("services", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  price: text("price").notNull(),
  icon: text("icon"),
  category: text("category"),
  isActive: integer("is_active").notNull().default(1),
  providerSlug: text("provider_slug").default("tellabot"),
});

export const insertServiceSchema = createInsertSchema(services).omit({ id: true });
export type InsertService = z.infer<typeof insertServiceSchema>;
export type Service = typeof services.$inferSelect;

export const orders = pgTable(
  "orders",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id").notNull(),
    serviceId: integer("service_id").notNull(),
    serviceName: text("service_name").notNull().default(""),
    phoneNumber: text("phone_number").notNull(),
    status: text("status").notNull().default("waiting"),
    otpCode: text("otp_code"),
    smsMessages: text("sms_messages"),
    price: text("price").notNull(),
    tellabotRequestId: text("tellabot_request_id"),
    activationId: text("activation_id"),
    tellabotMdn: text("tellabot_mdn"),
    costPrice: text("cost_price"),
    createdAt: text("created_at").notNull(),
    expiresAt: text("expires_at").notNull(),
    completedAt: text("completed_at"),
  },
  (t) => ({
    userStatus: index("idx_orders_user_status").on(t.userId, t.status),
    expiresStatus: index("idx_orders_expires_status").on(t.expiresAt, t.status),
  }),
);

export const insertOrderSchema = createInsertSchema(orders).omit({ id: true });
export type InsertOrder = z.infer<typeof insertOrderSchema>;
export type Order = typeof orders.$inferSelect;

export const transactions = pgTable(
  "transactions",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id").notNull(),
    type: text("type").notNull(),
    amount: text("amount").notNull(),
    description: text("description"),
    orderId: integer("order_id"),
    paymentRef: text("payment_ref"),
    createdAt: text("created_at").notNull(),
  },
  (t) => ({
    userIdx: index("idx_transactions_user").on(t.userId),
  }),
);

export const insertTransactionSchema = createInsertSchema(transactions).omit({ id: true });
export type InsertTransaction = z.infer<typeof insertTransactionSchema>;
export type Transaction = typeof transactions.$inferSelect;

export const cryptoDeposits = pgTable(
  "crypto_deposits",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id").notNull(),
    currency: text("currency").notNull(),
    amount: text("amount").notNull(),
    cryptoAmount: text("crypto_amount"),
    uniqueAmount: text("unique_amount"),
    walletAddress: text("wallet_address").notNull(),
    txHash: text("tx_hash"),
    trongridTxId: text("trongrid_tx_id"),
    confirmedAmount: text("confirmed_amount"),
    status: text("status").notNull().default("pending"),
    createdAt: text("created_at").notNull(),
    expiresAt: text("expires_at").notNull(),
    completedAt: text("completed_at"),
    bonusCents: integer("bonus_cents").default(0),
  },
  (t) => ({
    userIdx: index("idx_crypto_deposits_user").on(t.userId),
    statusIdx: index("idx_crypto_deposits_status").on(t.status),
    uniqueAmt: index("idx_crypto_deposits_unique_amount").on(t.uniqueAmount, t.status),
    txIdx: index("idx_crypto_deposits_trongrid_tx").on(t.trongridTxId),
  }),
);

export const insertCryptoDepositSchema = createInsertSchema(cryptoDeposits).omit({ id: true });
export type InsertCryptoDeposit = z.infer<typeof insertCryptoDepositSchema>;
export type CryptoDeposit = typeof cryptoDeposits.$inferSelect;

export const depositPollState = pgTable("deposit_poll_state", {
  id: integer("id").primaryKey().default(1),
  lastTimestamp: integer("last_timestamp").notNull().default(0),
  updatedAt: text("updated_at").notNull().default(""),
});

export const financialTransactions = pgTable(
  "financial_transactions",
  {
    id: serial("id").primaryKey(),
    idempotencyKey: text("idempotency_key"),
    userId: integer("user_id"),
    type: text("type").notNull(),
    status: text("status").notNull(),
    amountCents: integer("amount_cents").notNull(),
    currency: text("currency").notNull().default("USD"),
    metadata: text("metadata"),
    createdAt: text("created_at").notNull(),
  },
  (t) => ({
    idem: index("idx_financial_transactions_idem").on(t.idempotencyKey),
    user: index("idx_financial_transactions_user").on(t.userId),
  }),
);

export const ledgerAccounts = pgTable("ledger_accounts", {
  account: text("account").primaryKey(),
});

export const ledgerEntries = pgTable(
  "ledger_entries",
  {
    id: serial("id").primaryKey(),
    transactionId: integer("transaction_id").notNull(),
    account: text("account").notNull(),
    debitCents: integer("debit_cents").notNull().default(0),
    creditCents: integer("credit_cents").notNull().default(0),
    metadata: text("metadata"),
    createdAt: text("created_at").notNull(),
  },
  (t) => ({
    tx: index("idx_ledger_entries_tx").on(t.transactionId),
    acc: index("idx_ledger_entries_account").on(t.account),
  }),
);

export const idempotencyKeys = pgTable("idempotency_keys", {
  idempotencyKey: text("idempotency_key").primaryKey(),
  bodyHash: text("body_hash").notNull(),
  responseBody: text("response_body").notNull(),
  statusCode: integer("status_code").notNull(),
  createdAt: text("created_at").notNull(),
});

export const processedWebhooks = pgTable(
  "processed_webhooks",
  {
    id: serial("id").primaryKey(),
    provider: text("provider").notNull(),
    webhookId: text("webhook_id").notNull(),
    receivedTs: integer("received_ts").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (t) => ({
    uniq: uniqueIndex("idx_processed_webhooks_unique").on(t.provider, t.webhookId),
  }),
);

export const providerCircuitState = pgTable("provider_circuit_state", {
  provider: text("provider").primaryKey(),
  state: text("state").notNull(),
  failureCount: integer("failure_count").notNull().default(0),
  firstFailureTs: integer("first_failure_ts"),
  openedAtTs: integer("opened_at_ts"),
  lastTransitionAt: text("last_transition_at").notNull(),
});

export const pendingOperations = pgTable("pending_operations", {
  id: serial("id").primaryKey(),
  provider: text("provider").notNull(),
  operationType: text("operation_type").notNull(),
  payload: text("payload").notNull(),
  retryCount: integer("retry_count").notNull().default(0),
  nextRetryAt: text("next_retry_at").notNull(),
  status: text("status").notNull().default("queued"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const reconciliationLog = pgTable("reconciliation_log", {
  id: serial("id").primaryKey(),
  runAt: text("run_at").notNull(),
  status: text("status").notNull(),
  mismatchCents: integer("mismatch_cents").notNull().default(0),
  details: text("details").notNull(),
});

export const financialFlags = pgTable("financial_flags", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const loginEvents = pgTable(
  "login_events",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id"),
    email: text("email").notNull(),
    eventType: text("event_type").notNull(),
    fingerprintHash: text("fingerprint_hash").notNull(),
    ipAddress: text("ip_address").notNull(),
    asn: text("asn").notNull(),
    country: text("country").notNull(),
    riskScore: integer("risk_score").notNull().default(0),
    reasons: text("reasons").notNull().default("[]"),
    createdAt: text("created_at").notNull(),
  },
  (t) => ({
    userCreated: index("idx_login_events_user_created").on(t.userId, t.createdAt),
    fp: index("idx_login_events_fingerprint").on(t.fingerprintHash),
  }),
);

export const abuseEvents = pgTable("abuse_events", {
  id: serial("id").primaryKey(),
  userId: integer("user_id"),
  ipAddress: text("ip_address"),
  fingerprintHash: text("fingerprint_hash"),
  eventType: text("event_type").notNull(),
  details: text("details").notNull().default("{}"),
  createdAt: text("created_at").notNull(),
  resolvedAt: text("resolved_at"),
});

export const abuseBlocks = pgTable(
  "abuse_blocks",
  {
    id: serial("id").primaryKey(),
    scope: text("scope").notNull(),
    scopeId: text("scope_id").notNull(),
    blockedUntil: text("blocked_until").notNull(),
    reason: text("reason").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (t) => ({
    scopeIdx: index("idx_abuse_blocks_scope").on(t.scope, t.scopeId, t.blockedUntil),
  }),
);

export const apiKeyUsage = pgTable(
  "api_key_usage",
  {
    id: serial("id").primaryKey(),
    apiKey: text("api_key").notNull(),
    userId: integer("user_id").notNull(),
    usedAt: text("used_at").notNull(),
  },
  (t) => ({
    keyTime: index("idx_api_key_usage_key_time").on(t.apiKey, t.usedAt),
  }),
);

export const serviceBundles = pgTable("service_bundles", {
  id: serial("id").primaryKey(),
  name: text("name").notNull().unique(),
  service: text("service").notNull(),
  quantity: integer("quantity").notNull(),
  priceCents: integer("price_cents").notNull(),
  discountPct: integer("discount_pct").notNull(),
  expiresDays: integer("expires_days").notNull(),
  isActive: integer("is_active").notNull().default(1),
});

export const userBundleCredits = pgTable(
  "user_bundle_credits",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id").notNull(),
    bundleId: integer("bundle_id").notNull(),
    service: text("service").notNull(),
    remainingCredits: integer("remaining_credits").notNull(),
    expiresAt: text("expires_at").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (t) => ({
    userSvc: index("idx_user_bundle_credits_user_service").on(t.userId, t.service, t.expiresAt),
  }),
);

export const changelogs = pgTable("changelogs", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  body: text("body").notNull(),
  type: text("type").notNull(),
  showModal: integer("show_modal").notNull().default(0),
  publishedAt: text("published_at").notNull(),
});

export const changelogReads = pgTable(
  "changelog_reads",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id").notNull(),
    changelogId: integer("changelog_id").notNull(),
    readAt: text("read_at").notNull(),
  },
  (t) => ({
    uniq: uniqueIndex("changelog_reads_user_changelog").on(t.userId, t.changelogId),
  }),
);

export const supportTickets = pgTable("support_tickets", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  subject: text("subject").notNull(),
  message: text("message").notNull(),
  status: text("status").notNull().default("open"),
  priority: text("priority").notNull().default("normal"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
  resolvedAt: text("resolved_at"),
});

export const supportTicketMessages = pgTable("support_ticket_messages", {
  id: serial("id").primaryKey(),
  ticketId: integer("ticket_id").notNull(),
  senderRole: text("sender_role").notNull(),
  senderId: integer("sender_id"),
  message: text("message").notNull(),
  createdAt: text("created_at").notNull(),
});

export const faqEntries = pgTable("faq_entries", {
  id: serial("id").primaryKey(),
  question: text("question").notNull(),
  answer: text("answer").notNull(),
  sortOrder: integer("sort_order").notNull().default(0),
  isActive: integer("is_active").notNull().default(1),
  createdAt: text("created_at").notNull(),
});

export const winBackEvents = pgTable(
  "win_back_events",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id").notNull(),
    sentAt: text("sent_at").notNull(),
    bonusCents: integer("bonus_cents").notNull().default(50),
  },
  (t) => ({
    userSent: index("idx_win_back_events_user_sent").on(t.userId, t.sentAt),
  }),
);

export const analyticsEvents = pgTable(
  "analytics_events",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id"),
    event: text("event").notNull(),
    metadata: text("metadata").notNull().default("{}"),
    createdAt: text("created_at").notNull(),
  },
  (t) => ({
    idx: index("idx_analytics_events_user_event_created").on(t.userId, t.event, t.createdAt),
  }),
);

export const servicePricing = pgTable(
  "service_pricing",
  {
    id: serial("id").primaryKey(),
    serviceName: text("service_name").notNull().unique(),
    markup: text("markup").notNull(),
    minPrice: text("min_price"),
    maxPrice: text("max_price"),
    updatedAt: text("updated_at").notNull(),
  },
);

export const depositBundles = pgTable("deposit_bundles", {
  id: serial("id").primaryKey(),
  amountUsd: text("amount_usd").notNull(),
  bonusUsd: text("bonus_usd").notNull().default("0"),
  active: boolean("active").notNull().default(true),
  sortOrder: integer("sort_order").notNull().default(0),
});

export const referrals = pgTable(
  "referrals",
  {
    id: serial("id").primaryKey(),
    referrerUserId: integer("referrer_user_id").notNull(),
    referredUserId: integer("referred_user_id").notNull().unique(),
    createdAt: text("created_at").notNull(),
  },
  (t) => ({
    ref: index("idx_referrals_referrer").on(t.referrerUserId),
  }),
);

export const referralRewards = pgTable("referral_rewards", {
  id: serial("id").primaryKey(),
  referralId: integer("referral_id").notNull(),
  userId: integer("user_id").notNull(),
  amountCents: integer("amount_cents").notNull(),
  depositId: integer("deposit_id"),
  createdAt: text("created_at").notNull(),
});

export const auditLogs = pgTable(
  "audit_logs",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id"),
    adminId: integer("admin_id"),
    action: text("action").notNull(),
    meta: jsonb("meta"),
    ip: text("ip"),
    userAgent: text("user_agent"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    created: index("idx_audit_logs_created").on(t.createdAt),
  }),
);

export const providerHealth = pgTable("provider_health", {
  slug: text("slug").primaryKey(),
  enabled: boolean("enabled").notNull().default(true),
  lastBalance: text("last_balance"),
  lastCheckedAt: text("last_checked_at"),
});
