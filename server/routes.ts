import type { Express, Request, Response } from "express";
import { createServer, type Server } from "http";
import { storage, sqliteClient, runTransaction, syncDb } from "./storage";
import session from "express-session";
import passport from "passport";
import { Strategy as LocalStrategy } from "passport-local";
import bcrypt from "bcryptjs";
import rateLimit from "express-rate-limit";
import BetterSqlite3SessionStore from "better-sqlite3-session-store";

// Extend session type
declare module "express-session" {
  interface SessionData {
    userId?: number;
  }
}

// Safe error response — hide internals in production
function safeError(err: any): string {
  if (process.env.NODE_ENV === "production") {
    return "Something went wrong. Please try again.";
  }
  return err?.message || "Unknown error";
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

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {

  // Session setup with SQLite-backed store
  const SqliteStore = BetterSqlite3SessionStore(session);

  const isProduction = process.env.NODE_ENV === "production";

  if (!process.env.SESSION_SECRET) {
    if (isProduction) {
      throw new Error("FATAL: SESSION_SECRET must be set in production. Refusing to start with insecure default.");
    }
    console.warn("WARNING: SESSION_SECRET not set. Using insecure default. Set it in .env for production!");
  }

  app.use(
    session({
      store: new SqliteStore({
        client: sqliteClient,
        expired: { clear: true, intervalMs: 15 * 60 * 1000 }, // cleanup every 15 min
      }),
      secret: process.env.SESSION_SECRET || "getotps-dev-insecure-fallback",
      resave: false,
      saveUninitialized: false,
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

  // Apply general API limiter to all /api routes
  app.use("/api", apiLimiter);

  // ========== AUTH ROUTES ==========

  app.post("/api/auth/register", authLimiter, async (req, res) => {
    try {
      const { username, email, password } = req.body;
      if (!username || !email || !password) {
        return res.status(400).json({ message: "All fields required" });
      }
      const existing = await storage.getUserByEmail(email);
      if (existing) return res.status(400).json({ message: "Email already registered" });
      const existingUsername = await storage.getUserByUsername(username);
      if (existingUsername) return res.status(400).json({ message: "Username already taken" });

      const hashedPassword = await bcrypt.hash(password, 10);
      const user = await storage.createUser({ username, email, password: hashedPassword });

      req.login(user, (err) => {
        if (err) return res.status(500).json({ message: "Login failed after registration" });
        const { password: _, ...safeUser } = user;
        res.json(safeUser);
      });
    } catch (err: any) {
      res.status(500).json({ message: safeError(err) });
    }
  });

  app.post("/api/auth/login", authLimiter, (req, res, next) => {
    passport.authenticate("local", (err: any, user: any, info: any) => {
      if (err) return res.status(500).json({ message: safeError(err) });
      if (!user) return res.status(401).json({ message: info?.message || "Invalid credentials" });
      req.login(user, (loginErr) => {
        if (loginErr) return res.status(500).json({ message: "Login failed" });
        const { password: _, ...safeUser } = user;
        res.json(safeUser);
      });
    })(req, res, next);
  });

  app.post("/api/auth/logout", (req, res) => {
    req.logout(() => { res.json({ message: "Logged out" }); });
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

  app.post("/api/orders", requireAuth, orderLimiter, async (req, res) => {
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

      // Atomic: deduct balance + create order + create transaction
      const now = new Date();
      const expiresAt = new Date(now.getTime() + 20 * 60 * 1000);

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
          createdAt: now.toISOString(),
        });

        return ord;
      });

      res.json({ ...order, service });
    } catch (err: any) {
      console.error("Order error:", err);
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
    if (process.env.NODE_ENV === "production") {
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

  app.post("/api/orders/:id/cancel", requireAuth, async (req, res) => {
    try {
      const user = req.user as any;
      const order = await storage.getOrder(Number(req.params.id));
      if (!order) return res.status(404).json({ message: "Order not found" });
      if (order.userId !== user.id) return res.status(403).json({ message: "Forbidden" });
      if (order.status !== "waiting") return res.status(400).json({ message: "Cannot cancel this order" });

      // Reject on TellaBot side
      if (order.tellabotRequestId) {
        try {
          await tellabotAPI("reject", { id: order.tellabotRequestId });
        } catch (e) {
          console.error("TellaBot reject error:", e);
        }
      }

      // Atomic: cancel order + refund balance + create transaction
      runTransaction(() => {
        syncDb.cancelOrder(order.id);
        const txUser = syncDb.getUser(user.id);
        if (txUser) {
          const newBalance = (parseFloat(txUser.balance) + parseFloat(order.price)).toFixed(2);
          syncDb.updateUserBalance(user.id, newBalance);
          syncDb.createTransaction({
            userId: user.id,
            type: "refund",
            amount: order.price,
            description: "Order cancelled - refund",
            orderId: order.id,
            paymentRef: null,
            createdAt: new Date().toISOString(),
          });
        }
      });

      res.json({ message: "Order cancelled and refunded" });
    } catch (err: any) {
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

  app.post("/api/crypto/create-deposit", requireAuth, async (req, res) => {
    try {
      const user = req.user as any;
      const { currency, amount } = req.body;
      if (!currency || !amount) return res.status(400).json({ message: "Currency and amount are required" });
      const usdAmount = parseFloat(amount);
      if (isNaN(usdAmount) || usdAmount < 1) return res.status(400).json({ message: "Minimum deposit is $1.00" });
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
      res.json(deposit);
    } catch (err: any) { res.status(500).json({ message: safeError(err) }); }
  });

  app.get("/api/crypto/deposits", requireAuth, async (req, res) => {
    const user = req.user as any;
    res.json(await storage.getUserCryptoDeposits(user.id));
  });

  app.post("/api/crypto/:id/submit-hash", requireAuth, async (req, res) => {
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
      res.json({ message: "Transaction hash submitted. Awaiting confirmation." });
    } catch (err: any) { res.status(500).json({ message: safeError(err) }); }
  });

  app.post("/api/crypto/:id/simulate-confirm", requireAuth, async (req, res) => {
    if (process.env.NODE_ENV === "production") {
      return res.status(403).json({ message: "Simulation endpoints are disabled in production" });
    }
    try {
      const user = req.user as any;
      const deposit = await storage.getCryptoDeposit(Number(req.params.id));
      if (!deposit) return res.status(404).json({ message: "Deposit not found" });
      if (deposit.userId !== user.id) return res.status(403).json({ message: "Forbidden" });
      if (deposit.status !== "confirming") return res.status(400).json({ message: "Deposit must be in confirming state" });
      // Atomic: complete deposit + credit balance + create transaction
      const now = new Date().toISOString();
      const newBalance = runTransaction(() => {
        syncDb.updateCryptoDeposit(deposit.id, { status: "completed", completedAt: now } as any);
        const txUser = syncDb.getUser(user.id);
        if (!txUser) throw new Error("User not found");
        const bal = (parseFloat(txUser.balance) + parseFloat(deposit.amount)).toFixed(2);
        syncDb.updateUserBalance(user.id, bal);
        syncDb.createTransaction({
          userId: user.id, type: "deposit", amount: deposit.amount,
          description: `Crypto deposit (${deposit.currency}) confirmed`,
          orderId: null, paymentRef: null, createdAt: now,
        });
        return bal;
      });
      res.json({ message: "Deposit confirmed", newBalance });
    } catch (err: any) { res.status(500).json({ message: safeError(err) }); }
  });

  app.post("/api/admin/crypto/:id/confirm", requireAdmin, async (req, res) => {
    try {
      const deposit = await storage.getCryptoDeposit(Number(req.params.id));
      if (!deposit) return res.status(404).json({ message: "Deposit not found" });
      if (deposit.status === "completed") return res.status(400).json({ message: "Already completed" });
      // Atomic: complete deposit + credit balance + create transaction
      const now = new Date().toISOString();
      runTransaction(() => {
        syncDb.updateCryptoDeposit(deposit.id, { status: "completed", completedAt: now } as any);
        const txUser = syncDb.getUser(deposit.userId);
        if (!txUser) throw new Error("User not found");
        const newBalance = (parseFloat(txUser.balance) + parseFloat(deposit.amount)).toFixed(2);
        syncDb.updateUserBalance(deposit.userId, newBalance);
        syncDb.createTransaction({
          userId: deposit.userId, type: "deposit", amount: deposit.amount,
          description: `Crypto deposit (${deposit.currency}) confirmed by admin`,
          orderId: null, paymentRef: null, createdAt: now,
        });
      });
      res.json({ message: "Deposit confirmed and balance credited" });
    } catch (err: any) { res.status(500).json({ message: safeError(err) }); }
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

  app.put("/api/admin/services/:id", requireAdmin, async (req, res) => {
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

  app.post("/api/v1/order", requireApiKey, orderLimiter, async (req, res) => {
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
      if (balance < price) return res.status(400).json({ error: "Insufficient balance" });

      // Call TellaBot
      const tbResult = await tellabotAPI("request", { service: svc.name });
      if (tbResult.status !== "ok" || !tbResult.message?.[0]?.mdn) {
        return res.status(503).json({ error: tbResult.message || "No numbers available" });
      }

      const tbData = tbResult.message[0];
      const phoneNumber = tbData.mdn.startsWith("+") ? tbData.mdn : `+${tbData.mdn}`;

      // Atomic: deduct balance + create order + create transaction
      const now = new Date();
      const expiresAt = new Date(now.getTime() + 20 * 60 * 1000);

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
          paymentRef: null, createdAt: now.toISOString(),
        });

        return ord;
      });

      res.json({ orderId: order.id, phoneNumber, status: "waiting", expiresAt: order.expiresAt });
    } catch (err: any) { res.status(500).json({ error: safeError(err) }); }
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

  app.post("/api/v1/order/:id/cancel", requireApiKey, async (req, res) => {
    try {
      const user = (req as any).apiUser;
      const order = await storage.getOrder(Number(req.params.id));
      if (!order) return res.status(404).json({ error: "Order not found" });
      if (order.userId !== user.id) return res.status(403).json({ error: "Forbidden" });
      if (order.status !== "waiting") return res.status(400).json({ error: "Cannot cancel" });

      if (order.tellabotRequestId) {
        try { await tellabotAPI("reject", { id: order.tellabotRequestId }); } catch (e) {}
      }

      await storage.cancelOrder(order.id);
      const freshUser = await storage.getUser(user.id);
      if (freshUser) {
        const newBalance = (parseFloat(freshUser.balance) + parseFloat(order.price)).toFixed(2);
        await storage.updateUserBalance(user.id, newBalance);
      }
      res.json({ message: "Order cancelled and refunded" });
    } catch (err: any) { res.status(500).json({ error: safeError(err) }); }
  });

  // Profile
  app.post("/api/profile/generate-api-key", requireAuth, async (req, res) => {
    const user = req.user as any;
    res.json({ apiKey: await storage.generateApiKey(user.id) });
  });

  app.post("/api/profile/change-password", requireAuth, async (req, res) => {
    try {
      const user = req.user as any;
      const { currentPassword, newPassword } = req.body;
      const freshUser = await storage.getUser(user.id);
      if (!freshUser) return res.status(404).json({ message: "User not found" });
      const isValid = await bcrypt.compare(currentPassword, freshUser.password);
      if (!isValid) return res.status(400).json({ message: "Current password is incorrect" });
      const hashed = await bcrypt.hash(newPassword, 10);
      await storage.updateUserPassword(user.id, hashed);
      res.json({ message: "Password updated" });
    } catch (err: any) { res.status(500).json({ message: safeError(err) }); }
  });

  // Initial service sync on startup
  fetchTellabotServices().then(() => {
    console.log("TellaBot services synced");
  }).catch(err => {
    console.error("TellaBot initial sync failed:", err);
  });

  return httpServer;
}
