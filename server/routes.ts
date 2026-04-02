import type { Express, Request, Response } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import session from "express-session";
import passport from "passport";
import { Strategy as LocalStrategy } from "passport-local";
import bcrypt from "bcryptjs";

// Extend session type
declare module "express-session" {
  interface SessionData {
    userId?: number;
  }
}

// ========== TELLABOT API INTEGRATION ==========
const TELLABOT_BASE = "https://www.tellabot.com/api_command.php";
const TELLABOT_USER = process.env.TELLABOT_USER || "siyamhasan4@gmail.com";
const TELLABOT_KEY = process.env.TELLABOT_API_KEY || "hGwpWflQbP0i0Lz2ls2IkJ8dTDyYMLxt";
const MARKUP_MULTIPLIER = 1.5; // 50% markup on TellaBot cost

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

// Crypto wallet addresses
const CRYPTO_WALLETS: Record<string, string> = {
  BTC: "bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh",
  ETH: "0x71C7656EC7ab88b098defB751B7401B5f6d8976F",
  USDT_TRC20: "TN2Y5mFKbE2BC3RLeFz4BEMnGpGEaVNbHv",
  USDT_ERC20: "0x71C7656EC7ab88b098defB751B7401B5f6d8976F",
  USDC: "0x71C7656EC7ab88b098defB751B7401B5f6d8976F",
  LTC: "ltc1qw508d6qejxtdg4y5r3zarvary0c5xw7kgmn4n9",
};

const CRYPTO_RATES: Record<string, number> = {
  BTC: 84250.00, ETH: 3420.00, USDT_TRC20: 1.00,
  USDT_ERC20: 1.00, USDC: 1.00, LTC: 92.50,
};

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {

  // Session setup
  app.use(
    session({
      secret: process.env.SESSION_SECRET || "getotps-secret-key-2024",
      resave: false,
      saveUninitialized: false,
      cookie: { secure: false, maxAge: 7 * 24 * 60 * 60 * 1000 },
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

  // ========== AUTH ROUTES ==========

  app.post("/api/auth/register", async (req, res) => {
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
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/auth/login", (req, res, next) => {
    passport.authenticate("local", (err: any, user: any, info: any) => {
      if (err) return res.status(500).json({ message: err.message });
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

  app.post("/api/orders", requireAuth, async (req, res) => {
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

      // Deduct balance
      const newBalance = (balance - price).toFixed(2);
      await storage.updateUserBalance(user.id, newBalance);

      const now = new Date();
      const expiresAt = new Date(now.getTime() + 20 * 60 * 1000);

      const order = await storage.createOrder({
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

      await storage.createTransaction({
        userId: user.id,
        type: "purchase",
        amount: `-${service.price}`,
        description: `${service.name} number rental`,
        orderId: order.id,
        stripeSessionId: null,
        createdAt: now.toISOString(),
      });

      res.json({ ...order, service });
    } catch (err: any) {
      console.error("Order error:", err);
      res.status(500).json({ message: err.message });
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
      res.status(500).json({ message: err.message });
    }
  });

  // Keep simulate-sms for demo/fallback (when TellaBot balance is low)
  app.post("/api/orders/:id/simulate-sms", requireAuth, async (req, res) => {
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
      res.status(500).json({ message: err.message });
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

      await storage.cancelOrder(order.id);

      // Refund balance
      const freshUser = await storage.getUser(user.id);
      if (freshUser) {
        const newBalance = (parseFloat(freshUser.balance) + parseFloat(order.price)).toFixed(2);
        await storage.updateUserBalance(user.id, newBalance);
        await storage.createTransaction({
          userId: user.id,
          type: "refund",
          amount: order.price,
          description: "Order cancelled - refund",
          orderId: order.id,
          stripeSessionId: null,
          createdAt: new Date().toISOString(),
        });
      }

      res.json({ message: "Order cancelled and refunded" });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
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
      const deposit = await storage.createCryptoDeposit({
        userId: user.id, currency, amount: usdAmount.toFixed(2), cryptoAmount,
        walletAddress, txHash: null, status: "pending",
        createdAt: now.toISOString(), expiresAt: expiresAt.toISOString(), completedAt: null,
      });
      res.json(deposit);
    } catch (err: any) { res.status(500).json({ message: err.message }); }
  });

  app.get("/api/crypto/deposits", requireAuth, async (req, res) => {
    const user = req.user as any;
    res.json(await storage.getUserCryptoDeposits(user.id));
  });

  app.post("/api/crypto/:id/submit-hash", requireAuth, async (req, res) => {
    try {
      const user = req.user as any;
      const { txHash } = req.body;
      if (!txHash) return res.status(400).json({ message: "Transaction hash is required" });
      const deposit = await storage.getCryptoDeposit(Number(req.params.id));
      if (!deposit) return res.status(404).json({ message: "Deposit not found" });
      if (deposit.userId !== user.id) return res.status(403).json({ message: "Forbidden" });
      if (deposit.status !== "pending") return res.status(400).json({ message: "Deposit is not pending" });
      await storage.updateCryptoDeposit(deposit.id, { txHash, status: "confirming" });
      res.json({ message: "Transaction hash submitted. Awaiting confirmation." });
    } catch (err: any) { res.status(500).json({ message: err.message }); }
  });

  app.post("/api/crypto/:id/simulate-confirm", requireAuth, async (req, res) => {
    try {
      const user = req.user as any;
      const deposit = await storage.getCryptoDeposit(Number(req.params.id));
      if (!deposit) return res.status(404).json({ message: "Deposit not found" });
      if (deposit.userId !== user.id) return res.status(403).json({ message: "Forbidden" });
      if (deposit.status !== "confirming") return res.status(400).json({ message: "Deposit must be in confirming state" });
      const now = new Date().toISOString();
      await storage.updateCryptoDeposit(deposit.id, { status: "completed", completedAt: now });
      const freshUser = await storage.getUser(user.id);
      if (freshUser) {
        const newBalance = (parseFloat(freshUser.balance) + parseFloat(deposit.amount)).toFixed(2);
        await storage.updateUserBalance(user.id, newBalance);
        await storage.createTransaction({
          userId: user.id, type: "deposit", amount: deposit.amount,
          description: `Crypto deposit (${deposit.currency}) confirmed`,
          orderId: null, stripeSessionId: null, createdAt: now,
        });
      }
      res.json({ message: "Deposit confirmed", newBalance: (parseFloat(freshUser!.balance) + parseFloat(deposit.amount)).toFixed(2) });
    } catch (err: any) { res.status(500).json({ message: err.message }); }
  });

  app.post("/api/admin/crypto/:id/confirm", requireAdmin, async (req, res) => {
    try {
      const deposit = await storage.getCryptoDeposit(Number(req.params.id));
      if (!deposit) return res.status(404).json({ message: "Deposit not found" });
      if (deposit.status === "completed") return res.status(400).json({ message: "Already completed" });
      const now = new Date().toISOString();
      await storage.updateCryptoDeposit(deposit.id, { status: "completed", completedAt: now });
      const freshUser = await storage.getUser(deposit.userId);
      if (freshUser) {
        const newBalance = (parseFloat(freshUser.balance) + parseFloat(deposit.amount)).toFixed(2);
        await storage.updateUserBalance(deposit.userId, newBalance);
        await storage.createTransaction({
          userId: deposit.userId, type: "deposit", amount: deposit.amount,
          description: `Crypto deposit (${deposit.currency}) confirmed by admin`,
          orderId: null, stripeSessionId: null, createdAt: now,
        });
      }
      res.json({ message: "Deposit confirmed and balance credited" });
    } catch (err: any) { res.status(500).json({ message: err.message }); }
  });

  app.get("/api/admin/crypto/pending", requireAdmin, async (_req, res) => {
    res.json(await storage.getAllPendingCryptoDeposits());
  });

  app.get("/api/transactions", requireAuth, async (req, res) => {
    const user = req.user as any;
    res.json(await storage.getUserTransactions(user.id));
  });

  // ========== ADMIN ==========

  app.get("/api/admin/users", requireAdmin, async (_req, res) => {
    const allUsers = await storage.getAllUsers();
    res.json(allUsers.map(({ password: _, ...u }) => u));
  });

  app.get("/api/admin/stats", requireAdmin, async (_req, res) => {
    const allUsers = await storage.getAllUsers();
    const allOrders = await storage.getAllOrders();
    const completedOrders = allOrders.filter(o => o.status === "completed" || o.status === "received");
    const revenue = completedOrders.reduce((sum, o) => sum + parseFloat(o.price), 0);
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
      tellabotBalance,
    });
  });

  app.put("/api/admin/services/:id", requireAdmin, async (req, res) => {
    try {
      await storage.updateService(Number(req.params.id), req.body);
      res.json({ message: "Service updated" });
    } catch (err: any) { res.status(500).json({ message: err.message }); }
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

  app.post("/api/v1/order", requireApiKey, async (req, res) => {
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

      const newBalance = (balance - price).toFixed(2);
      await storage.updateUserBalance(user.id, newBalance);

      const now = new Date();
      const expiresAt = new Date(now.getTime() + 20 * 60 * 1000);

      const order = await storage.createOrder({
        userId: user.id, serviceId: svc.id, serviceName: svc.name,
        phoneNumber, status: "waiting", otpCode: null, smsMessages: null,
        price: svc.price, tellabotRequestId: tbData.id, tellabotMdn: tbData.mdn,
        createdAt: now.toISOString(), expiresAt: expiresAt.toISOString(), completedAt: null,
      });

      await storage.createTransaction({
        userId: user.id, type: "purchase", amount: `-${svc.price}`,
        description: `${svc.name} number rental`, orderId: order.id,
        stripeSessionId: null, createdAt: now.toISOString(),
      });

      res.json({ orderId: order.id, phoneNumber, status: "waiting", expiresAt: order.expiresAt });
    } catch (err: any) { res.status(500).json({ error: err.message }); }
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
    } catch (err: any) { res.status(500).json({ error: err.message }); }
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
    } catch (err: any) { res.status(500).json({ message: err.message }); }
  });

  // Initial service sync on startup
  fetchTellabotServices().then(() => {
    console.log("TellaBot services synced");
  }).catch(err => {
    console.error("TellaBot initial sync failed:", err);
  });

  return httpServer;
}
