import type { Express, Request, Response, NextFunction } from "express";
import { createServer, type Server } from "http";
import { storage, sqliteClient, runTransaction, syncDb } from "./storage";
import session from "express-session";
import passport from "passport";
import { Strategy as LocalStrategy } from "passport-local";
import bcrypt from "bcryptjs";
import rateLimit from "express-rate-limit";
import BetterSqlite3SessionStore from "better-sqlite3-session-store";
import crypto from "crypto";

// Extend session type
declare module "express-session" {
  interface SessionData {
    userId?: number;
  }
}

// ========== ENV VALIDATION ==========
const isProduction = process.env.NODE_ENV === "production";

function validateEnv(): void {
  if (isProduction) {
    const required = ["SESSION_SECRET", "ADMIN_PASSWORD"];
    const missing = required.filter(k => !process.env[k]);
    if (missing.length > 0) {
      throw new Error(`FATAL: Missing required env vars in production: ${missing.join(", ")}`);
    }
    if (process.env.SESSION_SECRET && process.env.SESSION_SECRET.length < 32) {
      throw new Error("FATAL: SESSION_SECRET must be at least 32 characters in production");
    }
    if (process.env.ADMIN_PASSWORD === "admin123" || process.env.ADMIN_PASSWORD === "password") {
      throw new Error("FATAL: ADMIN_PASSWORD must be changed from default in production");
    }
  } else {
    if (!process.env.SESSION_SECRET) {
      console.warn("WARNING: SESSION_SECRET not set. Using insecure default. Set it in .env for production!");
    }
  }
}

validateEnv();

// ========== HELPERS ==========

// Safe error response — hide internals in production
function safeError(err: any): string {
  if (isProduction) {
    return "Something went wrong. Please try again.";
  }
  return err?.message || "Unknown error";
}

// RFC 5322-compliant email regex with bounded quantifiers to prevent ReDoS
const EMAIL_REGEX = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+$/;

// Business constants
const MAX_USER_AGENT_LENGTH = 256;
const ORDER_EXPIRATION_MS = 20 * 60 * 1000; // 20 minutes
const MAX_DEPOSIT_USD = 10000;

// Request ID generator
function getRequestId(req: Request): string {
  return (req.headers["x-request-id"] as string) || crypto.randomUUID();
}

// Get client IP respecting trust proxy
function getClientIp(req: Request): string {
  return (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() || req.ip || "unknown";
}

// Mask sensitive data for audit logs
function maskSensitive(data: Record<string, any>): Record<string, any> {
  const masked = { ...data };
  for (const key of ["password", "currentPassword", "newPassword", "api_key", "apiKey", "txHash"]) {
    if (masked[key]) masked[key] = "***";
  }
  return masked;
}

// Audit log helper
function auditLog(req: Request, action: string, opts: {
  targetType?: string;
  targetId?: string | number;
  amount?: string;
  status?: string;
  metadata?: Record<string, any>;
  userId?: number;
} = {}): void {
  try {
    const user = (req.user as any) || (req as any).apiUser;
    const userId = opts.userId ?? user?.id ?? null;
    storage.createAuditLog({
      userId,
      actorRole: user?.role ?? null,
      ip: getClientIp(req),
      userAgent: (req.headers["user-agent"] || "").slice(0, MAX_USER_AGENT_LENGTH),
      action,
      targetType: opts.targetType ?? null,
      targetId: opts.targetId != null ? String(opts.targetId) : null,
      amount: opts.amount ?? null,
      status: opts.status ?? null,
      requestId: getRequestId(req),
      idempotencyKey: (req.headers["idempotency-key"] as string) ?? null,
      metadata: opts.metadata ? JSON.stringify(maskSensitive(opts.metadata)) : null,
    });
  } catch (err) {
    console.error("Audit log write failed:", err);
  }
}

// ========== IDEMPOTENCY MIDDLEWARE ==========
function idempotencyGuard(routeKey: string) {
  return (req: Request, res: Response, next: NextFunction) => {
    const idempotencyKey = req.headers["idempotency-key"] as string;
    if (!idempotencyKey) {
      return next(); // No key = no idempotency enforcement
    }

    if (typeof idempotencyKey !== "string" || idempotencyKey.length < 8 || idempotencyKey.length > 128) {
      return res.status(400).json({ message: "Idempotency-Key must be 8-128 characters" });
    }

    const user = (req.user as any) || (req as any).apiUser;
    const userId = user?.id;
    if (!userId) {
      return next(); // Can't enforce without user context
    }

    const existing = storage.getIdempotencyKey(idempotencyKey, userId, routeKey);

    if (existing) {
      // Already exists — check status
      if (existing.status === "processing") {
        return res.status(409).json({ message: "Request is currently being processed. Please wait." });
      }
      // Return cached response
      if (existing.responseBody) {
        try {
          const cachedResponse = JSON.parse(existing.responseBody);
          return res.status(existing.statusCode || 200).json(cachedResponse);
        } catch {
          return res.status(existing.statusCode || 200).json({ message: "Duplicate request" });
        }
      }
      return res.status(existing.statusCode || 200).json({ message: "Duplicate request" });
    }

    // Create idempotency record
    let record;
    try {
      record = storage.createIdempotencyKey({
        key: idempotencyKey,
        userId,
        route: routeKey,
        method: req.method,
      });
    } catch (err: any) {
      // Unique constraint violation = race condition
      if (err?.code === "SQLITE_CONSTRAINT_UNIQUE" || err?.message?.includes("UNIQUE")) {
        return res.status(409).json({ message: "Request is currently being processed. Please wait." });
      }
      throw err;
    }

    // Intercept response to capture it
    const originalJson = res.json.bind(res);
    res.json = function (body: any) {
      const statusCode = res.statusCode;
      const status = statusCode >= 200 && statusCode < 300 ? "success" : "failed";
      try {
        storage.completeIdempotencyKey(record.id, statusCode, JSON.stringify(body), status);
      } catch (err) {
        console.error("Failed to complete idempotency key:", err);
      }
      return originalJson(body);
    };

    next();
  };
}

// ========== TELLABOT API INTEGRATION ==========
const TELLABOT_BASE = "https://www.tellabot.com/api_command.php";
const TELLABOT_USER = process.env.TELLABOT_USER!;
const TELLABOT_KEY = process.env.TELLABOT_API_KEY!;
const MARKUP_MULTIPLIER = parseFloat(process.env.TELLABOT_MARKUP || "1.5");

// Service category mapping for popular services
const SERVICE_CATEGORIES: Record<string, string> = {
  WhatsApp: "Messaging", Telegram: "Messaging", Discord: "Messaging", Signal: "Messaging",
  Viber: "Messaging", LINE: "Messaging", WeChat: "Messaging", KakaoTalk: "Messaging",
  Google: "Tech", Microsoft: "Tech", Apple: "Tech", AWS: "Tech", GitHub: "Tech", Anthropic: "Tech",
  Facebook: "Social", Instagram: "Social", Twitter: "Social", TikTok: "Social",
  Snapchat: "Social", LinkedIn: "Social", Reddit: "Social", Pinterest: "Social",
  Amazon: "Shopping", eBay: "Shopping", Walmart: "Shopping", BestBuy: "Shopping",
  Uber: "Transport", Lyft: "Transport", DoorDash: "Food", Grubhub: "Food", UberEats: "Food",
  Airbnb: "Travel", Booking: "Travel",
  PayPal: "Finance", CashApp: "Finance", Venmo: "Finance", Chime: "Finance", Zelle: "Finance",
  Coinbase: "Crypto", Binance: "Crypto", Kraken: "Crypto",
  Netflix: "Entertainment", Spotify: "Entertainment", Hulu: "Entertainment", Disney: "Entertainment",
  Bumble: "Dating", Tinder: "Dating", Hinge: "Dating", Badoo: "Dating",
};

async function tellabotAPI(cmd: string, params: Record<string, string> = {}): Promise<any> {
  const url = new URL(TELLABOT_BASE);
  url.searchParams.set("cmd", cmd);
  url.searchParams.set("user", TELLABOT_USER);
  url.searchParams.set("api_key", TELLABOT_KEY);
  for (const [k, v] of Object.entries(params)) {
    url.searchParams.set(k, v);
  }
  const res = await fetch(url.toString());
  return res.json();
}

// Service cache with TTL
let servicesCache: { data: any[]; updatedAt: number } | null = null;
const SERVICE_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

async function fetchTellabotServices(): Promise<any[]> {
  if (servicesCache && Date.now() - servicesCache.updatedAt < SERVICE_CACHE_TTL) {
    return servicesCache.data;
  }
  try {
    const result = await tellabotAPI("list_services");
    if (result.status === "ok" && Array.isArray(result.message)) {
      servicesCache = { data: result.message, updatedAt: Date.now() };
      // Sync to DB
      const dbServices = result.message.map((s: any, i: number) => ({
        name: s.name,
        slug: s.name.toLowerCase().replace(/[^a-z0-9]/g, ""),
        price: (parseFloat(s.price) * MARKUP_MULTIPLIER).toFixed(2),
        icon: null,
        category: SERVICE_CATEGORIES[s.name] || "Other",
        isActive: parseInt(s.otp_available) > 0 ? 1 : 0,
      }));
      await storage.upsertServices(dbServices);
      return result.message;
    }
  } catch (err) {
    console.error("TellaBot service fetch error:", err);
  }
  // Fallback to cached DB data
  return servicesCache?.data || [];
}

// Extract OTP code from SMS text
function extractOTPFromText(text: string): string | null {
  // Common patterns: 6 digits, 4-8 digit codes
  const patterns = [
    /\b(\d{6})\b/,  // 6-digit code (most common)
    /\b(\d{4})\b/,  // 4-digit code
    /\b(\d{5})\b/,  // 5-digit code
    /\b(\d{7,8})\b/, // 7-8 digit code
    /code[:\s]+(\d{4,8})/i,
    /pin[:\s]+(\d{4,8})/i,
    /verification[:\s]+(\d{4,8})/i,
  ];
  for (const p of patterns) {
    const match = text.match(p);
    if (match) return match[1];
  }
  return null;
}

// Crypto wallet addresses (from env)
const CRYPTO_WALLETS: Record<string, string> = {
  BTC: process.env.CRYPTO_WALLET_BTC || "",
  ETH: process.env.CRYPTO_WALLET_ETH || "",
  USDT_TRC20: process.env.CRYPTO_WALLET_USDT_TRC20 || "",
  USDT_ERC20: process.env.CRYPTO_WALLET_USDT_ERC20 || "",
  USDC: process.env.CRYPTO_WALLET_USDC || "",
  LTC: process.env.CRYPTO_WALLET_LTC || "",
};

const CRYPTO_RATES: Record<string, number> = {
  BTC: parseFloat(process.env.CRYPTO_RATE_BTC || "84250"),
  ETH: parseFloat(process.env.CRYPTO_RATE_ETH || "3420"),
  USDT_TRC20: parseFloat(process.env.CRYPTO_RATE_USDT || "1"),
  USDT_ERC20: parseFloat(process.env.CRYPTO_RATE_USDT || "1"),
  USDC: parseFloat(process.env.CRYPTO_RATE_USDC || "1"),
  LTC: parseFloat(process.env.CRYPTO_RATE_LTC || "92.50"),
};

// Valid order state transitions
const VALID_ORDER_TRANSITIONS: Record<string, string[]> = {
  waiting: ["received", "cancelled", "expired"],
  received: ["completed"],
  completed: [],
  cancelled: [],
  expired: [],
};

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {

  // Trust proxy for Nginx reverse proxy
  if (isProduction) {
    app.set("trust proxy", 1);
  }

  // Session setup with SQLite-backed store
  const SqliteStore = BetterSqlite3SessionStore(session);

  app.use(
    session({
      store: new SqliteStore({
        client: sqliteClient,
        expired: { clear: true, intervalMs: 15 * 60 * 1000 }, // cleanup every 15 min
      }),
      secret: process.env.SESSION_SECRET || "getotps-dev-insecure-fallback",
      resave: false,
      saveUninitialized: false,
      name: "getotps.sid",
      cookie: {
        secure: isProduction,
        httpOnly: true,
        maxAge: 7 * 24 * 60 * 60 * 1000,
        sameSite: "lax",
      },
    })
  );

  app.use(passport.initialize());
  app.use(passport.session());

  passport.use(
    new LocalStrategy({ usernameField: "email" }, async (email, password, done) => {
      try {
        const user = await storage.getUserByEmail(email);
        if (!user) return done(null, false, { message: "Invalid email or password" });
        const isValid = await bcrypt.compare(password, user.password);
        if (!isValid) return done(null, false, { message: "Invalid email or password" });
        return done(null, user);
      } catch (err) {
        return done(err);
      }
    })
  );

  passport.serializeUser((user: any, done) => done(null, user.id));
  passport.deserializeUser(async (id: number, done) => {
    try {
      const user = await storage.getUser(id);
      done(null, user || false);
    } catch (err) {
      done(err);
    }
  });

  function requireAuth(req: Request, res: Response, next: any) {
    if (req.isAuthenticated()) return next();
    res.status(401).json({ message: "Unauthorized" });
  }

  function requireAdmin(req: Request, res: Response, next: any) {
    if (req.isAuthenticated() && (req.user as any)?.role === "admin") return next();
    res.status(403).json({ message: "Forbidden" });
  }

  // ========== RATE LIMITING ==========

  // Strict limiter for auth routes (login, register)
  const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 10, // 10 attempts per window
    standardHeaders: true,
    legacyHeaders: false,
    message: { message: "Too many attempts. Please try again in 15 minutes." },
  });

  // General API limiter
  const apiLimiter = rateLimit({
    windowMs: 1 * 60 * 1000, // 1 minute
    max: 60, // 60 requests per minute
    standardHeaders: true,
    legacyHeaders: false,
    message: { message: "Too many requests. Please slow down." },
  });

  // Order creation limiter (prevents abuse)
  const orderLimiter = rateLimit({
    windowMs: 1 * 60 * 1000, // 1 minute
    max: 10, // 10 orders per minute
    standardHeaders: true,
    legacyHeaders: false,
    message: { message: "Too many order requests. Please slow down." },
  });

  // Financial operations limiter (cancel, refund, crypto, deposit)
  const financialLimiter = rateLimit({
    windowMs: 1 * 60 * 1000,
    max: 15,
    standardHeaders: true,
    legacyHeaders: false,
    message: { message: "Too many financial requests. Please slow down." },
  });

  // Password change limiter
  const passwordLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 5,
    standardHeaders: true,
    legacyHeaders: false,
    message: { message: "Too many password change attempts. Please try again later." },
  });

  // Admin actions limiter
  const adminLimiter = rateLimit({
    windowMs: 1 * 60 * 1000,
    max: 30,
    standardHeaders: true,
    legacyHeaders: false,
    message: { message: "Too many admin requests. Please slow down." },
  });

  // Apply general API limiter to all /api routes
  app.use("/api", apiLimiter);

  // ========== AUTH ROUTES ==========

  app.post("/api/auth/register", authLimiter, async (req, res) => {
    try {
      const { username, email, password } = req.body;
      if (!username || !email || !password) {
        return res.status(400).json({ message: "All fields required" });
      }
      if (typeof username !== "string" || username.length < 2 || username.length > 50) {
        return res.status(400).json({ message: "Username must be 2-50 characters" });
      }
      if (typeof email !== "string" || email.length > 254 || !EMAIL_REGEX.test(email)) {
        return res.status(400).json({ message: "Invalid email format" });
      }
      if (typeof password !== "string" || password.length < 8 || password.length > 128) {
        return res.status(400).json({ message: "Password must be 8-128 characters" });
      }
      const existing = await storage.getUserByEmail(email);
      if (existing) return res.status(400).json({ message: "Email already registered" });
      const existingUsername = await storage.getUserByUsername(username);
      if (existingUsername) return res.status(400).json({ message: "Username already taken" });

      const hashedPassword = await bcrypt.hash(password, 10);
      const user = await storage.createUser({ username, email, password: hashedPassword });

      req.login(user, (err) => {
        if (err) return res.status(500).json({ message: "Login failed after registration" });
        auditLog(req, "register", { targetType: "user", targetId: user.id, status: "success" });
        const { password: _, ...safeUser } = user;
        res.json(safeUser);
      });
    } catch (err: any) {
      auditLog(req, "register", { status: "failed", metadata: { error: safeError(err) } });
      res.status(500).json({ message: safeError(err) });
    }
  });

  app.post("/api/auth/login", authLimiter, (req, res, next) => {
    passport.authenticate("local", (err: any, user: any, info: any) => {
      if (err) {
        auditLog(req, "login", { status: "error" });
        return res.status(500).json({ message: safeError(err) });
      }
      if (!user) {
        auditLog(req, "login", { status: "failed", metadata: { email: req.body?.email } });
        return res.status(401).json({ message: info?.message || "Invalid credentials" });
      }
      // Session rotation on login to prevent session fixation
      req.session.regenerate((regenErr) => {
        if (regenErr) {
          return res.status(500).json({ message: "Session error" });
        }
        req.login(user, (loginErr) => {
          if (loginErr) return res.status(500).json({ message: "Login failed" });
          auditLog(req, "login", { targetType: "user", targetId: user.id, status: "success", userId: user.id });
          const { password: _, ...safeUser } = user;
          res.json(safeUser);
        });
      });
    })(req, res, next);
  });

  app.post("/api/auth/logout", (req, res) => {
    const userId = (req.user as any)?.id;
    auditLog(req, "logout", { targetType: "user", targetId: userId, status: "success" });
    req.logout(() => {
      req.session.destroy(() => {
        res.clearCookie("getotps.sid");
        res.json({ message: "Logged out" });
      });
    });
  });

  app.get("/api/auth/me", requireAuth, async (req, res) => {
    const user = req.user as any;
    const freshUser = await storage.getUser(user.id);
    if (!freshUser) return res.status(404).json({ message: "User not found" });
    const { password: _, ...safeUser } = freshUser;
    res.json(safeUser);
  });

  // ========== SERVICES (TellaBot-backed) ==========

  app.get("/api/services", async (_req, res) => {
    try {
      // Fetch fresh from TellaBot (cached 5 min)
      const tellabotServices = await fetchTellabotServices();
      const dbServices = await storage.getAllServices();
      
      // Merge TellaBot availability with DB services
      const tellabotMap = new Map(tellabotServices.map((s: any) => [s.name, s]));
      const enriched = dbServices.map(svc => {
        const tb = tellabotMap.get(svc.name);
        return {
          ...svc,
          available: tb ? parseInt(tb.otp_available) : 0,
          costPrice: tb ? tb.price : null,
        };
      });
      res.json(enriched);
    } catch (err) {
      // Fallback to DB
      const dbServices = await storage.getAllServices();
      res.json(dbServices);
    }
  });

  // ========== ORDERS (TellaBot-backed) ==========

  app.post("/api/orders", requireAuth, orderLimiter, idempotencyGuard("POST:/api/orders"), async (req, res) => {
    try {
      const user = req.user as any;
      const { serviceId, serviceName } = req.body;
      if (!serviceId && !serviceName) return res.status(400).json({ message: "serviceId or serviceName required" });

      // Find service from DB
      let service;
      if (serviceId) {
        service = await storage.getService(Number(serviceId));
      }
      if (!service && serviceName) {
        service = await storage.getServiceBySlug(serviceName.toLowerCase().replace(/[^a-z0-9]/g, ""));
      }
      if (!service) return res.status(404).json({ message: "Service not found" });

      const freshUser = await storage.getUser(user.id);
      if (!freshUser) return res.status(404).json({ message: "User not found" });

      const balance = parseFloat(freshUser.balance);
      const price = parseFloat(service.price);
      if (price <= 0) return res.status(400).json({ message: "Invalid service price" });
      if (balance < price) return res.status(400).json({ message: "Insufficient balance" });

      // Request real number from TellaBot
      const tbResult = await tellabotAPI("request", { service: service.name });
      
      if (tbResult.status !== "ok" || !tbResult.message || !Array.isArray(tbResult.message)) {
        return res.status(503).json({ 
          message: tbResult.message || "No numbers available for this service. Try again later." 
        });
      }

      const tbData = tbResult.message[0];
      const tellabotRequestId = tbData.id;
      const mdn = tbData.mdn;

      if (!mdn) {
        // Priority request — awaiting MDN
        return res.status(503).json({ message: "No numbers available right now. Try again shortly." });
      }

      // Format phone number
      const phoneNumber = mdn.startsWith("+") ? mdn : `+${mdn}`;

      // Atomic: deduct balance + create order + create transaction (ledger entry)
      const now = new Date();
      const expiresAt = new Date(now.getTime() + ORDER_EXPIRATION_MS);
      const idempotencyKey = (req.headers["idempotency-key"] as string) || null;

      const order = runTransaction(() => {
        // Re-read balance inside transaction to prevent race conditions
        const txUser = syncDb.getUser(user.id);
        if (!txUser) throw new Error("User not found");
        const txBalance = parseFloat(txUser.balance);
        if (txBalance < price) throw new Error("Insufficient balance");

        const newBalance = (txBalance - price).toFixed(2);
        syncDb.updateUserBalance(user.id, newBalance);

        const ord = syncDb.createOrder({
          userId: user.id,
          serviceId: service.id,
          serviceName: service.name,
          phoneNumber,
          status: "waiting",
          otpCode: null,
          smsMessages: null,
          price: service.price,
          tellabotRequestId,
          tellabotMdn: mdn,
          createdAt: now.toISOString(),
          expiresAt: expiresAt.toISOString(),
          completedAt: null,
        });

        syncDb.createTransaction({
          userId: user.id,
          type: "purchase",
          amount: `-${service.price}`,
          description: `${service.name} number rental`,
          orderId: ord.id,
          paymentRef: null,
          idempotencyKey,
          createdAt: now.toISOString(),
        });

        return ord;
      });

      auditLog(req, "order.create", {
        targetType: "order", targetId: order.id,
        amount: `-${service.price}`, status: "success",
      });

      res.json({ ...order, service });
    } catch (err: any) {
      console.error("Order error:", err);
      auditLog(req, "order.create", { status: "failed", metadata: { error: safeError(err) } });
      res.status(500).json({ message: safeError(err) });
    }
  });

  app.get("/api/orders", requireAuth, async (req, res) => {
    const user = req.user as any;
    const userOrders = await storage.getUserOrders(user.id);
    res.json(userOrders);
  });

  app.get("/api/orders/active", requireAuth, async (req, res) => {
    const user = req.user as any;
    const activeOrders = await storage.getActiveOrders(user.id);
    res.json(activeOrders);
  });

  app.get("/api/orders/:id", requireAuth, async (req, res) => {
    const user = req.user as any;
    const order = await storage.getOrder(Number(req.params.id));
    if (!order) return res.status(404).json({ message: "Order not found" });
    if (order.userId !== user.id && (req.user as any)?.role !== "admin") {
      return res.status(403).json({ message: "Forbidden" });
    }
    res.json(order);
  });

  // Check for SMS — calls TellaBot read_sms
  app.post("/api/orders/:id/check-sms", requireAuth, async (req, res) => {
    try {
      const user = req.user as any;
      const order = await storage.getOrder(Number(req.params.id));
      if (!order) return res.status(404).json({ message: "Order not found" });
      if (order.userId !== user.id) return res.status(403).json({ message: "Forbidden" });
      if (order.status !== "waiting") return res.status(400).json({ message: "Order not in waiting state" });

      if (!order.tellabotRequestId) {
        return res.status(400).json({ message: "No TellaBot request linked" });
      }

      const tbResult = await tellabotAPI("read_sms", { id: order.tellabotRequestId });

      if (tbResult.status === "error") {
        // "No messages" is normal — still waiting
        return res.json({ status: "waiting", messages: [], otpCode: null });
      }

      if (tbResult.status === "ok" && Array.isArray(tbResult.message)) {
        const messages = tbResult.message;
        const smsJson = JSON.stringify(messages);
        
        // Try to extract OTP from latest message
        let otpCode: string | null = null;
        for (const msg of messages) {
          const code = extractOTPFromText(msg.text || "");
          if (code) { otpCode = code; break; }
        }

        await storage.updateOrderSms(order.id, smsJson, otpCode || undefined);

        return res.json({
          status: "received",
          messages,
          otpCode,
          fullText: messages.map((m: any) => m.text).join("\n"),
        });
      }

      res.json({ status: "waiting", messages: [], otpCode: null });
    } catch (err: any) {
      console.error("Check SMS error:", err);
      res.status(500).json({ message: safeError(err) });
    }
  });

  // Simulate-sms: development only (disabled in production)
  app.post("/api/orders/:id/simulate-sms", requireAuth, async (req, res) => {
    if (isProduction) {
      return res.status(403).json({ message: "Simulation endpoints are disabled in production" });
    }
    try {
      const user = req.user as any;
      const order = await storage.getOrder(Number(req.params.id));
      if (!order) return res.status(404).json({ message: "Order not found" });
      if (order.userId !== user.id) return res.status(403).json({ message: "Forbidden" });
      if (order.status !== "waiting") return res.status(400).json({ message: "Order not in waiting state" });

      const otpCode = Math.floor(100000 + Math.random() * 900000).toString();
      const fakeMessage = [{ timestamp: Math.floor(Date.now()/1000).toString(), sender: "12345", text: `Your verification code is: ${otpCode}` }];
      await storage.updateOrderSms(order.id, JSON.stringify(fakeMessage), otpCode);

      res.json({ otpCode, message: "SMS simulated", messages: fakeMessage });
    } catch (err: any) {
      res.status(500).json({ message: safeError(err) });
    }
  });

  app.post("/api/orders/:id/cancel", requireAuth, financialLimiter, idempotencyGuard("POST:/api/orders/cancel"), async (req, res) => {
    try {
      const user = req.user as any;
      const order = await storage.getOrder(Number(req.params.id));
      if (!order) return res.status(404).json({ message: "Order not found" });
      if (order.userId !== user.id) return res.status(403).json({ message: "Forbidden" });

      // Business logic guards: only "waiting" orders can be cancelled
      if (order.status === "cancelled") return res.status(400).json({ message: "Order is already cancelled" });
      if (order.status === "completed" || order.status === "received") {
        return res.status(400).json({ message: "Cannot cancel a fulfilled order" });
      }
      if (order.status === "expired") return res.status(400).json({ message: "Order has expired" });
      if (!VALID_ORDER_TRANSITIONS[order.status]?.includes("cancelled")) {
        return res.status(400).json({ message: "Cannot cancel this order" });
      }

      // Reject on TellaBot side
      if (order.tellabotRequestId) {
        try {
          await tellabotAPI("reject", { id: order.tellabotRequestId });
        } catch (e) {
          console.error("TellaBot reject error:", e);
        }
      }

      const idempotencyKey = (req.headers["idempotency-key"] as string) || null;

      // Atomic: cancel order + refund balance + create ledger entry
      runTransaction(() => {
        // Re-check status inside transaction to prevent double-cancel race
        const orderNow = sqliteClient.prepare("SELECT status FROM orders WHERE id = ?").get(order.id) as { status: string } | undefined;
        if (!orderNow || orderNow.status !== "waiting") {
          throw new Error("Order is no longer in cancellable state");
        }

        syncDb.cancelOrder(order.id);
        const txUser = syncDb.getUser(user.id);
        if (txUser) {
          const refundAmount = parseFloat(order.price);
          if (refundAmount <= 0) throw new Error("Invalid refund amount");
          const newBalance = (parseFloat(txUser.balance) + refundAmount).toFixed(2);
          syncDb.updateUserBalance(user.id, newBalance);
          syncDb.createTransaction({
            userId: user.id,
            type: "refund",
            amount: order.price,
            description: "Order cancelled - refund",
            orderId: order.id,
            paymentRef: null,
            idempotencyKey,
            createdAt: new Date().toISOString(),
          });
        }
      });

      auditLog(req, "order.cancel", {
        targetType: "order", targetId: order.id,
        amount: order.price, status: "success",
      });

      res.json({ message: "Order cancelled and refunded" });
    } catch (err: any) {
      auditLog(req, "order.cancel", { targetType: "order", targetId: String(req.params.id), status: "failed" });
      res.status(500).json({ message: safeError(err) });
    }
  });

  // ========== CRYPTO DEPOSITS ==========

  app.get("/api/balance", requireAuth, async (req, res) => {
    const user = req.user as any;
    const freshUser = await storage.getUser(user.id);
    res.json({ balance: freshUser?.balance || "0.00" });
  });

  app.get("/api/crypto/currencies", requireAuth, (_req, res) => {
    const currencies = Object.entries(CRYPTO_WALLETS).map(([key, address]) => ({
      id: key,
      name: key === "USDT_TRC20" ? "USDT (TRC20)" : key === "USDT_ERC20" ? "USDT (ERC20)" : key,
      network: key === "BTC" ? "Bitcoin" : key === "ETH" ? "Ethereum" : key === "USDT_TRC20" ? "Tron" : key === "USDT_ERC20" ? "Ethereum" : key === "USDC" ? "Ethereum" : key === "LTC" ? "Litecoin" : "",
      address,
      rate: CRYPTO_RATES[key],
    }));
    res.json(currencies);
  });

  // Generate a unique amount for USDT TRC20 deposits (avoids collision)
  async function generateUniqueUsdtAmount(baseAmount: number): Promise<string> {
    const maxAttempts = 20;
    for (let i = 0; i < maxAttempts; i++) {
      // Add random 4-digit suffix: e.g. 10.00 -> 10.003847
      const suffix = Math.floor(Math.random() * 9999) + 1; // 0001-9999
      const unique = baseAmount + suffix / 1000000; // add as micro-dollars (6 decimal precision)
      const uniqueStr = unique.toFixed(6);
      // Check no pending deposit already uses this amount
      const existing = await storage.getPendingDepositByUniqueAmount(uniqueStr);
      if (!existing) return uniqueStr;
    }
    // Fallback: very unlikely to reach here
    const fallback = baseAmount + (Math.floor(Math.random() * 99999) + 1) / 1000000;
    return fallback.toFixed(6);
  }

  app.post("/api/crypto/create-deposit", requireAuth, financialLimiter, idempotencyGuard("POST:/api/crypto/create-deposit"), async (req, res) => {
    try {
      const user = req.user as any;
      const { currency, amount } = req.body;
      if (!currency || !amount) return res.status(400).json({ message: "Currency and amount are required" });
      const usdAmount = parseFloat(amount);
      if (isNaN(usdAmount) || usdAmount < 1) return res.status(400).json({ message: "Minimum deposit is $1.00" });
      if (usdAmount > MAX_DEPOSIT_USD) return res.status(400).json({ message: `Maximum deposit is $${MAX_DEPOSIT_USD.toLocaleString()}.00` });
      const walletAddress = CRYPTO_WALLETS[currency];
      if (!walletAddress) return res.status(400).json({ message: "Unsupported currency" });
      const rate = CRYPTO_RATES[currency];
      const cryptoAmount = (usdAmount / rate).toFixed(8);
      const now = new Date();
      const expiresAt = new Date(now.getTime() + 60 * 60 * 1000);

      // For USDT TRC20: generate a unique amount for auto-matching
      let uniqueAmount: string | null = null;
      if (currency === "USDT_TRC20") {
        uniqueAmount = await generateUniqueUsdtAmount(usdAmount);
      }

      const deposit = await storage.createCryptoDeposit({
        userId: user.id, currency, amount: usdAmount.toFixed(2),
        cryptoAmount: currency === "USDT_TRC20" ? uniqueAmount! : cryptoAmount,
        uniqueAmount,
        walletAddress, txHash: null,
        trongridTxId: null, confirmedAmount: null,
        status: "pending",
        createdAt: now.toISOString(), expiresAt: expiresAt.toISOString(), completedAt: null,
      });

      auditLog(req, "deposit.create", {
        targetType: "crypto_deposit", targetId: deposit.id,
        amount: usdAmount.toFixed(2), status: "success",
        metadata: { currency },
      });

      res.json(deposit);
    } catch (err: any) {
      auditLog(req, "deposit.create", { status: "failed" });
      res.status(500).json({ message: safeError(err) });
    }
  });

  app.get("/api/crypto/deposits", requireAuth, async (req, res) => {
    const user = req.user as any;
    res.json(await storage.getUserCryptoDeposits(user.id));
  });

  app.post("/api/crypto/:id/submit-hash", requireAuth, financialLimiter, idempotencyGuard("POST:/api/crypto/submit-hash"), async (req, res) => {
    try {
      const user = req.user as any;
      const { txHash } = req.body;
      if (!txHash || typeof txHash !== "string") return res.status(400).json({ message: "Transaction hash is required" });
      const trimmedHash = txHash.trim();
      if (trimmedHash.length < 10 || trimmedHash.length > 128) return res.status(400).json({ message: "Invalid transaction hash format" });
      const deposit = await storage.getCryptoDeposit(Number(req.params.id));
      if (!deposit) return res.status(404).json({ message: "Deposit not found" });
      if (deposit.userId !== user.id) return res.status(403).json({ message: "Forbidden" });
      if (deposit.status !== "pending") return res.status(400).json({ message: "Deposit is not pending" });
      await storage.updateCryptoDeposit(deposit.id, { txHash: trimmedHash, status: "confirming" });

      auditLog(req, "deposit.submit_hash", {
        targetType: "crypto_deposit", targetId: deposit.id, status: "success",
      });

      res.json({ message: "Transaction hash submitted. Awaiting confirmation." });
    } catch (err: any) { res.status(500).json({ message: safeError(err) }); }
  });

  app.post("/api/crypto/:id/simulate-confirm", requireAuth, async (req, res) => {
    if (isProduction) {
      return res.status(403).json({ message: "Simulation endpoints are disabled in production" });
    }
    try {
      const user = req.user as any;
      const deposit = await storage.getCryptoDeposit(Number(req.params.id));
      if (!deposit) return res.status(404).json({ message: "Deposit not found" });
      if (deposit.userId !== user.id) return res.status(403).json({ message: "Forbidden" });
      if (deposit.status === "completed") return res.status(400).json({ message: "Deposit already completed" });
      if (deposit.status !== "confirming") return res.status(400).json({ message: "Deposit must be in confirming state" });
      // Atomic: complete deposit + credit balance + create ledger entry
      const now = new Date().toISOString();
      const newBalance = runTransaction(() => {
        // Re-check status inside transaction
        const txDeposit = syncDb.getCryptoDeposit(deposit.id);
        if (!txDeposit || txDeposit.status === "completed") throw new Error("Deposit already completed");

        syncDb.updateCryptoDeposit(deposit.id, { status: "completed", completedAt: now } as any);
        const txUser = syncDb.getUser(user.id);
        if (!txUser) throw new Error("User not found");
        const creditAmount = parseFloat(deposit.amount);
        if (creditAmount <= 0) throw new Error("Invalid deposit amount");
        const bal = (parseFloat(txUser.balance) + creditAmount).toFixed(2);
        syncDb.updateUserBalance(user.id, bal);
        syncDb.createTransaction({
          userId: user.id, type: "deposit", amount: deposit.amount,
          description: `Crypto deposit (${deposit.currency}) confirmed`,
          orderId: null, paymentRef: null,
          idempotencyKey: null,
          createdAt: now,
        });
        return bal;
      });
      res.json({ message: "Deposit confirmed", newBalance });
    } catch (err: any) { res.status(500).json({ message: safeError(err) }); }
  });

  app.post("/api/admin/crypto/:id/confirm", requireAdmin, adminLimiter, idempotencyGuard("POST:/api/admin/crypto/confirm"), async (req, res) => {
    try {
      const deposit = await storage.getCryptoDeposit(Number(req.params.id));
      if (!deposit) return res.status(404).json({ message: "Deposit not found" });
      if (deposit.status === "completed") return res.status(400).json({ message: "Already completed" });
      if (deposit.status === "expired") return res.status(400).json({ message: "Deposit has expired" });

      const idempotencyKey = (req.headers["idempotency-key"] as string) || null;

      // Atomic: complete deposit + credit balance + create ledger entry
      const now = new Date().toISOString();
      runTransaction(() => {
        // Re-check inside transaction to prevent double-confirm
        const txDeposit = syncDb.getCryptoDeposit(deposit.id);
        if (!txDeposit || txDeposit.status === "completed") throw new Error("Deposit already completed");

        syncDb.updateCryptoDeposit(deposit.id, { status: "completed", completedAt: now } as any);
        const txUser = syncDb.getUser(deposit.userId);
        if (!txUser) throw new Error("User not found");
        const creditAmount = parseFloat(deposit.amount);
        if (creditAmount <= 0) throw new Error("Invalid deposit amount");
        const newBalance = (parseFloat(txUser.balance) + creditAmount).toFixed(2);
        syncDb.updateUserBalance(deposit.userId, newBalance);
        syncDb.createTransaction({
          userId: deposit.userId, type: "deposit", amount: deposit.amount,
          description: `Crypto deposit (${deposit.currency}) confirmed by admin`,
          orderId: null, paymentRef: null,
          idempotencyKey,
          createdAt: now,
        });
      });

      auditLog(req, "admin.deposit.confirm", {
        targetType: "crypto_deposit", targetId: deposit.id,
        amount: deposit.amount, status: "success",
        userId: (req.user as any)?.id,
      });

      res.json({ message: "Deposit confirmed and balance credited" });
    } catch (err: any) {
      auditLog(req, "admin.deposit.confirm", { targetType: "crypto_deposit", targetId: String(req.params.id), status: "failed" });
      res.status(500).json({ message: safeError(err) });
    }
  });

  app.get("/api/admin/crypto/pending", requireAdmin, async (_req, res) => {
    res.json(await storage.getAllPendingCryptoDeposits());
  });

  app.get("/api/admin/crypto/all", requireAdmin, async (_req, res) => {
    res.json(await storage.getAllCryptoDeposits());
  });

  app.get("/api/transactions", requireAuth, async (req, res) => {
    const user = req.user as any;
    res.json(await storage.getUserTransactions(user.id));
  });

  // ========== ADMIN ==========

  app.get("/api/admin/users", requireAdmin, async (_req, res) => {
    const allUsers = await storage.getAllUsers();
    res.json(allUsers.map(({ password: _, apiKey: __, ...u }) => u));
  });

  app.get("/api/admin/stats", requireAdmin, async (_req, res) => {
    const allUsers = await storage.getAllUsers();
    const allOrders = await storage.getAllOrders();
    const completedOrders = allOrders.filter(o => o.status === "completed" || o.status === "received");
    const revenue = completedOrders.reduce((sum, o) => sum + parseFloat(o.price), 0);
    const cost = revenue / MARKUP_MULTIPLIER;
    const profit = revenue - cost;

    // Total crypto deposits (completed only)
    const allDeposits = await storage.getAllCryptoDeposits();
    const completedDeposits = allDeposits.filter(d => d.status === "completed");
    const totalDeposited = completedDeposits.reduce((sum, d) => sum + parseFloat(d.amount), 0);

    // Check TellaBot balance
    let tellabotBalance = "N/A";
    try {
      const tbBal = await tellabotAPI("balance");
      if (tbBal.status === "ok") tellabotBalance = `$${tbBal.message}`;
    } catch (e) {}
    res.json({
      totalUsers: allUsers.length,
      totalOrders: allOrders.length,
      completedOrders: completedOrders.length,
      revenue: revenue.toFixed(2),
      cost: cost.toFixed(2),
      profit: profit.toFixed(2),
      markupMultiplier: MARKUP_MULTIPLIER,
      totalDeposited: totalDeposited.toFixed(2),
      pendingDeposits: allDeposits.filter(d => d.status === "pending" || d.status === "confirming").length,
      tellabotBalance,
    });
  });

  app.put("/api/admin/services/:id", requireAdmin, adminLimiter, async (req, res) => {
    try {
      const { price, isActive } = req.body;
      const update: Record<string, any> = {};
      if (price !== undefined) {
        const p = parseFloat(price);
        if (isNaN(p) || p < 0) return res.status(400).json({ message: "Invalid price" });
        update.price = p.toFixed(2);
      }
      if (isActive !== undefined) {
        update.isActive = isActive ? 1 : 0;
      }
      if (Object.keys(update).length === 0) return res.status(400).json({ message: "No valid fields to update" });
      await storage.updateService(Number(req.params.id), update);
      auditLog(req, "admin.service.update", { targetType: "service", targetId: String(req.params.id), status: "success" });
      res.json({ message: "Service updated" });
    } catch (err: any) { res.status(500).json({ message: safeError(err) }); }
  });

  // ========== API v1 (API key auth) ==========

  async function requireApiKey(req: Request, res: Response, next: any) {
    const key = req.headers["x-api-key"] as string || req.query.api_key as string;
    if (!key) return res.status(401).json({ error: "API key required" });
    const user = await storage.getUserByApiKey(key);
    if (!user) return res.status(401).json({ error: "Invalid API key" });
    (req as any).apiUser = user;
    next();
  }

  app.get("/api/v1/services", async (_req, res) => {
    const allServices = await storage.getAllServices();
    res.json({ services: allServices });
  });

  app.get("/api/v1/balance", requireApiKey, async (req, res) => {
    const user = (req as any).apiUser;
    res.json({ balance: user.balance });
  });

  app.post("/api/v1/order", requireApiKey, orderLimiter, idempotencyGuard("POST:/api/v1/order"), async (req, res) => {
    try {
      const user = (req as any).apiUser;
      const { service } = req.body;
      if (!service) return res.status(400).json({ error: "service name required" });

      const allServices = await storage.getAllServices();
      const svc = allServices.find(s => s.name === service || s.slug === service || s.id === Number(service));
      if (!svc) return res.status(404).json({ error: "Service not found" });

      const freshUser = await storage.getUser(user.id);
      if (!freshUser) return res.status(404).json({ error: "User not found" });
      const balance = parseFloat(freshUser.balance);
      const price = parseFloat(svc.price);
      if (price <= 0) return res.status(400).json({ error: "Invalid service price" });
      if (balance < price) return res.status(400).json({ error: "Insufficient balance" });

      // Call TellaBot
      const tbResult = await tellabotAPI("request", { service: svc.name });
      if (tbResult.status !== "ok" || !tbResult.message?.[0]?.mdn) {
        return res.status(503).json({ error: tbResult.message || "No numbers available" });
      }

      const tbData = tbResult.message[0];
      const phoneNumber = tbData.mdn.startsWith("+") ? tbData.mdn : `+${tbData.mdn}`;
      const idempotencyKey = (req.headers["idempotency-key"] as string) || null;

      // Atomic: deduct balance + create order + create ledger entry
      const now = new Date();
      const expiresAt = new Date(now.getTime() + ORDER_EXPIRATION_MS);

      const order = runTransaction(() => {
        const txUser = syncDb.getUser(user.id);
        if (!txUser) throw new Error("User not found");
        const txBalance = parseFloat(txUser.balance);
        if (txBalance < price) throw new Error("Insufficient balance");

        const newBalance = (txBalance - price).toFixed(2);
        syncDb.updateUserBalance(user.id, newBalance);

        const ord = syncDb.createOrder({
          userId: user.id, serviceId: svc.id, serviceName: svc.name,
          phoneNumber, status: "waiting", otpCode: null, smsMessages: null,
          price: svc.price, tellabotRequestId: tbData.id, tellabotMdn: tbData.mdn,
          createdAt: now.toISOString(), expiresAt: expiresAt.toISOString(), completedAt: null,
        });

        syncDb.createTransaction({
          userId: user.id, type: "purchase", amount: `-${svc.price}`,
          description: `${svc.name} number rental`, orderId: ord.id,
          paymentRef: null,
          idempotencyKey,
          createdAt: now.toISOString(),
        });

        return ord;
      });

      auditLog(req, "api.order.create", {
        targetType: "order", targetId: order.id,
        amount: `-${svc.price}`, status: "success",
      });

      res.json({ orderId: order.id, phoneNumber, status: "waiting", expiresAt: order.expiresAt });
    } catch (err: any) {
      auditLog(req, "api.order.create", { status: "failed" });
      res.status(500).json({ error: safeError(err) });
    }
  });

  app.get("/api/v1/order/:id", requireApiKey, async (req, res) => {
    const user = (req as any).apiUser;
    const order = await storage.getOrder(Number(req.params.id));
    if (!order) return res.status(404).json({ error: "Order not found" });
    if (order.userId !== user.id) return res.status(403).json({ error: "Forbidden" });
    
    // Auto-check SMS if still waiting
    if (order.status === "waiting" && order.tellabotRequestId) {
      try {
        const tbResult = await tellabotAPI("read_sms", { id: order.tellabotRequestId });
        if (tbResult.status === "ok" && Array.isArray(tbResult.message) && tbResult.message.length > 0) {
          const messages = tbResult.message;
          let otpCode: string | null = null;
          for (const msg of messages) {
            const code = extractOTPFromText(msg.text || "");
            if (code) { otpCode = code; break; }
          }
          await storage.updateOrderSms(order.id, JSON.stringify(messages), otpCode || undefined);
          return res.json({
            orderId: order.id, phoneNumber: order.phoneNumber,
            status: "received", otpCode,
            messages: messages.map((m: any) => m.text),
            expiresAt: order.expiresAt,
          });
        }
      } catch (e) {}
    }

    res.json({
      orderId: order.id, phoneNumber: order.phoneNumber,
      status: order.status, otpCode: order.otpCode,
      messages: order.smsMessages ? JSON.parse(order.smsMessages).map((m: any) => m.text) : [],
      expiresAt: order.expiresAt,
    });
  });

  app.post("/api/v1/order/:id/cancel", requireApiKey, financialLimiter, idempotencyGuard("POST:/api/v1/order/cancel"), async (req, res) => {
    try {
      const user = (req as any).apiUser;
      const order = await storage.getOrder(Number(req.params.id));
      if (!order) return res.status(404).json({ error: "Order not found" });
      if (order.userId !== user.id) return res.status(403).json({ error: "Forbidden" });

      // Business logic guards
      if (order.status === "cancelled") return res.status(400).json({ error: "Order already cancelled" });
      if (order.status === "completed" || order.status === "received") {
        return res.status(400).json({ error: "Cannot cancel a fulfilled order" });
      }
      if (order.status !== "waiting") return res.status(400).json({ error: "Cannot cancel" });

      if (order.tellabotRequestId) {
        try { await tellabotAPI("reject", { id: order.tellabotRequestId }); } catch (e) {}
      }

      const idempotencyKey = (req.headers["idempotency-key"] as string) || null;

      // Atomic: cancel order + refund balance + create ledger entry
      runTransaction(() => {
        // Re-check status inside transaction
        const orderNow = sqliteClient.prepare("SELECT status FROM orders WHERE id = ?").get(order.id) as { status: string } | undefined;
        if (!orderNow || orderNow.status !== "waiting") {
          throw new Error("Order is no longer in cancellable state");
        }

        syncDb.cancelOrder(order.id);
        const txUser = syncDb.getUser(user.id);
        if (!txUser) throw new Error("User not found during refund transaction");
        const refundAmount = parseFloat(order.price);
        if (refundAmount <= 0) throw new Error("Invalid refund amount");
        const newBalance = (parseFloat(txUser.balance) + refundAmount).toFixed(2);
        syncDb.updateUserBalance(user.id, newBalance);
        syncDb.createTransaction({
          userId: user.id,
          type: "refund",
          amount: order.price,
          description: "Order cancelled - refund",
          orderId: order.id,
          paymentRef: null,
          idempotencyKey,
          createdAt: new Date().toISOString(),
        });
      });

      auditLog(req, "api.order.cancel", {
        targetType: "order", targetId: order.id,
        amount: order.price, status: "success",
      });

      res.json({ message: "Order cancelled and refunded" });
    } catch (err: any) {
      auditLog(req, "api.order.cancel", { targetType: "order", targetId: String(req.params.id), status: "failed" });
      res.status(500).json({ error: safeError(err) });
    }
  });

  // Profile
  app.post("/api/profile/generate-api-key", requireAuth, async (req, res) => {
    const user = req.user as any;
    auditLog(req, "profile.generate_api_key", { targetType: "user", targetId: user.id, status: "success" });
    res.json({ apiKey: await storage.generateApiKey(user.id) });
  });

  app.post("/api/profile/change-password", requireAuth, passwordLimiter, async (req, res) => {
    try {
      const user = req.user as any;
      const { currentPassword, newPassword } = req.body;
      if (!currentPassword || !newPassword) return res.status(400).json({ message: "Current and new passwords are required" });
      if (typeof newPassword !== "string" || newPassword.length < 8 || newPassword.length > 128) {
        return res.status(400).json({ message: "New password must be 8-128 characters" });
      }
      const freshUser = await storage.getUser(user.id);
      if (!freshUser) return res.status(404).json({ message: "User not found" });
      const isValid = await bcrypt.compare(currentPassword, freshUser.password);
      if (!isValid) {
        auditLog(req, "profile.change_password", { targetType: "user", targetId: user.id, status: "failed" });
        return res.status(400).json({ message: "Current password is incorrect" });
      }
      const hashed = await bcrypt.hash(newPassword, 10);
      await storage.updateUserPassword(user.id, hashed);
      auditLog(req, "profile.change_password", { targetType: "user", targetId: user.id, status: "success" });
      res.json({ message: "Password updated" });
    } catch (err: any) { res.status(500).json({ message: safeError(err) }); }
  });

  // Periodic cleanup: expire idempotency keys
  setInterval(() => {
    try {
      const cleaned = storage.cleanExpiredIdempotencyKeys();
      if (cleaned > 0) {
        console.log(`Cleaned ${cleaned} expired idempotency key(s)`);
      }
    } catch (err) {
      console.error("Idempotency cleanup error:", err);
    }
  }, 60 * 60 * 1000); // Every hour

  // Initial service sync on startup
  fetchTellabotServices().then(() => {
    console.log("TellaBot services synced");
  }).catch(err => {
    console.error("TellaBot initial sync failed:", err);
  });

  return httpServer;
}
