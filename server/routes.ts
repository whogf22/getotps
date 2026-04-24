import type { Express, Request, Response, NextFunction } from "express";
import { createServer, type Server } from "http";
import { storage, syncDb } from "./storage";
import { pool, runTransaction, healthCheckDb } from "./db";
import { isRedisConfigured, pingRedis } from "./redis";
import session from "express-session";
import connectPgSimple from "connect-pg-simple";
import passport from "passport";
import { Strategy as LocalStrategy } from "passport-local";
import bcrypt from "bcryptjs";
import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import {
  buyNumberFromTellabot,
  cancelTellabotNumber,
  waitForSmsCode,
} from "./services/tellabot.service";
import {
  createUserWallet,
  getUserUsdcBalance,
  transferFromUserToMaster,
} from "./services/circle.service";
import { getUsdcSellPrice } from "./services/pricing.service";
import { sendFinancialAlert } from "./financial/alerts";
import { logFinancialEvent } from "./financial/logging";
import { verifyWebhookSignature } from "./financial/webhook-security";
import {
  creditUser,
  debitUserForPurchase,
  parseAmountToCents,
  recordRevenueAndCost,
  withProviderCircuit,
} from "./financial/operations";
import {
  createFinancialTransaction,
  getIdempotencyRecord,
  saveIdempotencyRecord,
  sha256,
} from "./financial/core";
import { assessRisk, computeFingerprintHash, getLinkedAccounts, recordLoginEvent } from "./abuse/risk";
import { applyBuyAbuseProtection, recordAbuseEvent, trackApiKeyUse } from "./abuse/engine";
import { scrubValue, safeProviderNeutralMessage } from "./security/provider-scrub";
import { readAppVersion } from "./security/version";
import type { User } from "@shared/schema";
import { randomBytes } from "node:crypto";
import { sha256Hex, signEmailVerificationJwt, verifyEmailVerificationJwt } from "./auth-tokens";
import { sendEmailVerificationMessage, sendPasswordResetMessage } from "./email";
import { writeAudit } from "./audit";
import { verifyTurnstile } from "./turnstile";
import { validateBody } from "./middleware/validate";
import {
  registerBodySchema,
  loginBodySchema,
  forgotPasswordBodySchema,
  resetPasswordBodySchema,
  verifyEmailBodySchema,
  createDepositBodySchema,
} from "@shared/validators";

// Extend session type
declare module "express-session" {
  interface SessionData {
    userId?: number;
  }
}

// Safe error response — hide internals in production
function safeError(err: any): string {
  const raw = String(err?.message || "");
  if (/validation/i.test(raw)) return "Validation failed.";
  if (/insufficient/i.test(raw)) return "Insufficient balance.";
  if (/unauthorized|forbidden|invalid credentials/i.test(raw)) return "Unauthorized.";
  if (/provider|circle|tellabot|wallet|upstream|api_command|handler_api/i.test(raw)) {
    return safeProviderNeutralMessage();
  }
  return "Something went wrong. Please contact support.";
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
const responseCache = new Map<string, { expiresAt: number; payload: unknown }>();

function withCache<T>(key: string, ttlMs: number, fetcher: () => Promise<T>): Promise<T> {
  const cached = responseCache.get(key);
  if (cached && cached.expiresAt > Date.now()) {
    return Promise.resolve(cached.payload as T);
  }
  return fetcher().then((payload) => {
    responseCache.set(key, { expiresAt: Date.now() + ttlMs, payload });
    return payload;
  });
}

async function fetchTellabotServices(): Promise<any[]> {
  if (servicesCache && Date.now() - servicesCache.updatedAt < SERVICE_CACHE_TTL) {
    return servicesCache.data;
  }
  try {
    const result = await tellabotAPI("list_services");
    if (result.status === "ok" && Array.isArray(result.message)) {
      if (result.message.length === 0) {
        console.warn("TellaBot list_services returned empty catalog; keeping existing DB services");
        return servicesCache?.data || [];
      }
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

function resolveClientIp(req: Request): string {
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded.length) {
    return forwarded.split(",")[0].trim();
  }
  return req.ip || "0.0.0.0";
}

function extractFingerprintPayload(req: Request) {
  const b = (req.body || {}) as Record<string, unknown>;
  const device = (b.device || {}) as Record<string, unknown>;
  return {
    userAgent: String(req.get("user-agent") || ""),
    acceptLanguage: String(req.get("accept-language") || ""),
    screenResolution: String(device.screenResolution || ""),
    timezoneOffset: String(device.timezoneOffset || ""),
    canvasHash: String(device.canvasHash || ""),
    ipAddress: resolveClientIp(req),
    asn: String(req.get("x-client-asn") || "unknown"),
    country: String(req.get("x-client-country") || "unknown"),
  };
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
  const version = readAppVersion();

  app.get("/api/version", (_req, res) => {
    res.setHeader("Cache-Control", "no-store");
    return res.status(200).json(version);
  });

  app.get("/healthz", (_req, res) => {
    return res.status(200).json({
      status: "ok",
      uptime: process.uptime(),
      version: version.version,
      cache: "ok",
    });
  });

  app.get("/readyz", async (_req, res) => {
    const dbOk = await healthCheckDb();
    let tellabotOk = false;
    try {
      const tb = await tellabotAPI("balance");
      tellabotOk = tb?.status === "ok";
    } catch {
      tellabotOk = false;
    }
    const redisRequired = isRedisConfigured();
    const redisOk = await pingRedis();
    const allOk = dbOk && tellabotOk && redisOk;
    const body = {
      status: allOk ? "ready" : "not_ready",
      db: dbOk,
      tellabot: tellabotOk,
      redis: redisRequired ? redisOk : "skipped",
    };
    if (allOk) {
      return res.status(200).json(body);
    }
    return res.status(503).json(body);
  });

  const PgSession = connectPgSimple(session);
  const isProduction = process.env.NODE_ENV === "production";

  if (!process.env.SESSION_SECRET) {
    if (isProduction) {
      throw new Error("FATAL: SESSION_SECRET must be set in production. Refusing to start with insecure default.");
    }
    console.warn("WARNING: SESSION_SECRET not set. Using insecure default. Set it in .env for production!");
  }

  if (!process.env.JWT_SECRET) {
    if (isProduction) {
      throw new Error("FATAL: JWT_SECRET must be set in production. Refusing to start with insecure default.");
    }
    console.warn("WARNING: JWT_SECRET not set. Using insecure default. Set it in .env for production!");
  }

  app.use(
    session({
      store: new PgSession({
        pool,
        tableName: "session",
        createTableIfMissing: true,
        pruneSessionInterval: 15 * 60,
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
    }),
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

  function requireVerifiedEmail(req: Request, res: Response, next: NextFunction) {
    const u = req.user as User | undefined;
    if (!u?.emailVerified) {
      return res.status(403).json({ message: "Please verify your email before continuing." });
    }
    next();
  }

  function requireAdmin(req: Request, res: Response, next: any) {
    if (req.isAuthenticated() && (req.user as any)?.role === "admin") return next();
    res.status(403).json({ message: "Forbidden" });
  }

  function sanitizeOrderForClient(order: any) {
    const { tellabotRequestId: _tbid, tellabotMdn: _tbmdn, activationId: _aid, costPrice: _cost, ...safe } = order;
    return safe;
  }

  // ========== RATE LIMITING ==========

  // Strict limiter for auth routes (login, register)
  const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 10, // 10 attempts per window
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => ipKeyGenerator(req.ip || "127.0.0.1"),
    message: { message: "Too many attempts. Please try again in 15 minutes." },
  });

  // General API limiter
  const apiLimiter = rateLimit({
    windowMs: 1 * 60 * 1000, // 1 minute
    max: 60, // 60 requests per minute
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => ipKeyGenerator(req.ip || "127.0.0.1"),
    message: { message: "Too many requests. Please slow down." },
  });

  // Order creation limiter (prevents abuse). Key by user when logged in so parallel e2e / Vitest workers do not share one IP bucket.
  const orderLimiter = rateLimit({
    windowMs: 1 * 60 * 1000, // 1 minute
    max: 10, // 10 orders per minute
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => {
      const r = req as Request & { user?: { id?: number }; apiUser?: { id?: number } };
      const uid = r.user?.id ?? r.apiUser?.id;
      if (typeof uid === "number") return `order:user:${uid}`;
      return `order:ip:${ipKeyGenerator(req.ip || "127.0.0.1")}`;
    },
    message: { message: "Too many order requests. Please slow down." },
  });

  const resendVerificationLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 1,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => {
      const r = req as Request & { user?: { id?: number } };
      if (typeof r.user?.id === "number") return `resend-verify:${r.user.id}`;
      return `resend-verify:ip:${ipKeyGenerator(req.ip || "127.0.0.1")}`;
    },
    message: { message: "You can resend verification once per minute." },
  });

  // Apply general API limiter to all /api routes
  app.use("/api", apiLimiter);

  // ========== AUTH ROUTES ==========

  app.post(
    "/api/auth/register",
    authLimiter,
    verifyTurnstile(),
    validateBody(registerBodySchema),
    async (req, res) => {
    try {
      const { username, email, password } = req.body as {
        username: string;
        email: string;
        password: string;
      };
      const existing = await storage.getUserByEmail(email);
      if (existing) return res.status(400).json({ message: "Email already registered" });
      const existingUsername = await storage.getUserByUsername(username);
      if (existingUsername) return res.status(400).json({ message: "Username already taken" });

      const hashedPassword = await bcrypt.hash(password, 10);
      const user = await storage.createUser({ username, email, password: hashedPassword });
      const verifyNonce = randomBytes(24).toString("hex");
      const verifyJwt = signEmailVerificationJwt(user.id, verifyNonce);
      await storage.setUserEmailVerification(user.id, {
        tokenHash: sha256Hex(verifyNonce),
        expiresAt: new Date(Date.now() + 48 * 60 * 60 * 1000),
        sentAt: new Date(),
      });
      void sendEmailVerificationMessage({ to: user.email, verifyToken: verifyJwt }).catch(() => {});
      const fpPayload = extractFingerprintPayload(req);
      const fingerprintHash = computeFingerprintHash(fpPayload);
      const risk = await assessRisk({
        userId: user.id,
        email,
        fingerprintHash,
        ipAddress: fpPayload.ipAddress,
        country: fpPayload.country,
        asn: fpPayload.asn,
      });
      await recordLoginEvent({
        userId: user.id,
        email,
        eventType: "register",
        fingerprintHash,
        ipAddress: fpPayload.ipAddress,
        asn: fpPayload.asn,
        country: fpPayload.country,
        riskScore: risk.score,
        reasons: risk.reasons,
      });
      if (risk.blockedForReview) {
        await recordAbuseEvent({
          userId: user.id,
          ip: fpPayload.ipAddress,
          fingerprintHash,
          eventType: "high_risk_registration",
          details: { score: risk.score, reasons: risk.reasons },
        });
      }

      req.login(user, async (err) => {
        if (err) return res.status(500).json({ message: "Login failed after registration" });
        await writeAudit(req, "register", { email }, user.id);
        const { password: _, apiKey: __, ...safeUser } = user;
        const linkedAccounts = await getLinkedAccounts(user.id);
        return res.json(
          scrubValue({
            ...safeUser,
            security: {
              riskScore: risk.score,
              captchaRequired: risk.requireCaptcha,
              otpRequired: risk.requireOtp,
              linkedAccountsCount: linkedAccounts.length,
            },
          }),
        );
      });
    } catch (err: any) {
      res.status(500).json({ message: safeError(err) });
    }
  });

  app.post("/api/auth/verify-email", authLimiter, validateBody(verifyEmailBodySchema), async (req, res) => {
    try {
      const token = String((req.body as { token: string }).token || "");
      if (!token) return res.status(400).json({ message: "Token required" });
      let claims: ReturnType<typeof verifyEmailVerificationJwt>;
      try {
        claims = verifyEmailVerificationJwt(token);
      } catch {
        return res.status(400).json({ message: "Invalid or expired verification link" });
      }
      const row = await storage.getUser(claims.sub);
      if (!row) return res.status(400).json({ message: "User not found" });
      if (row.emailVerified) return res.json({ message: "Already verified" });
      if (!row.emailVerifyTokenHash || !row.emailVerifyExpiresAt) {
        return res.status(400).json({ message: "No pending verification" });
      }
      if (new Date(row.emailVerifyExpiresAt) < new Date()) {
        return res.status(400).json({ message: "Verification link expired" });
      }
      if (row.emailVerifyTokenHash !== sha256Hex(claims.n)) {
        return res.status(400).json({ message: "Invalid verification link" });
      }
      await storage.markUserEmailVerified(row.id);
      await writeAudit(req, "email_verified", { email: row.email }, row.id);
      res.json({ message: "Email verified" });
    } catch (err: any) {
      res.status(500).json({ message: safeError(err) });
    }
  });

  const forgotPasswordResponse = {
    message: "If an account exists for that email, you will receive reset instructions.",
  };

  app.post(
    "/api/auth/forgot-password",
    authLimiter,
    verifyTurnstile(),
    validateBody(forgotPasswordBodySchema),
    async (req, res) => {
    try {
      const email = String((req.body as { email: string }).email || "").trim();
      if (!email) {
        return res.json(forgotPasswordResponse);
      }
      const user = await storage.getUserByEmail(email);
      if (!user) return res.json(forgotPasswordResponse);
      const raw = randomBytes(32).toString("hex");
      const hash = sha256Hex(raw);
      await storage.setUserPasswordReset(user.id, hash, new Date(Date.now() + 60 * 60 * 1000));
      void sendPasswordResetMessage({ to: user.email, resetToken: `${user.id}|${raw}` }).catch(() => {});
      await writeAudit(req, "password_reset", { stage: "requested", email }, user.id);
      return res.json(forgotPasswordResponse);
    } catch (err: any) {
      res.status(500).json({ message: safeError(err) });
    }
  });

  app.post("/api/auth/reset-password", authLimiter, validateBody(resetPasswordBodySchema), async (req, res) => {
    try {
      const token = String((req.body as { token: string }).token || "");
      const newPassword = String((req.body as { password: string }).password || "");
      if (!token || !newPassword) return res.status(400).json({ message: "Token and password required" });
      if (newPassword.length < 8) {
        return res.status(400).json({ message: "Password must be at least 8 characters" });
      }
      const pipe = token.indexOf("|");
      if (pipe < 1) return res.status(400).json({ message: "Invalid token" });
      const userId = Number(token.slice(0, pipe));
      const raw = token.slice(pipe + 1);
      if (!Number.isFinite(userId) || raw.length < 16) return res.status(400).json({ message: "Invalid token" });
      const hash = sha256Hex(raw);
      const user = await storage.getUserByPasswordResetTokenHash(hash);
      if (!user || user.id !== userId) return res.status(400).json({ message: "Invalid or expired reset link" });
      if (!user.passwordResetExpiresAt || new Date(user.passwordResetExpiresAt) < new Date()) {
        return res.status(400).json({ message: "Invalid or expired reset link" });
      }
      const hashedPassword = await bcrypt.hash(newPassword, 10);
      await storage.updateUserPassword(user.id, hashedPassword);
      await storage.clearUserPasswordReset(user.id);
      await writeAudit(req, "password_reset", { stage: "completed" }, user.id);
      res.json({ message: "Password updated" });
    } catch (err: any) {
      res.status(500).json({ message: safeError(err) });
    }
  });

  app.post("/api/auth/login", authLimiter, verifyTurnstile(), validateBody(loginBodySchema), (req, res, next) => {
    passport.authenticate("local", (err: unknown, user: false | User | undefined, _info: { message?: string }) => {
      void (async () => {
        if (err) return res.status(500).json({ message: safeError(err) });
        const fpPayload = extractFingerprintPayload(req);
        const fingerprintHash = computeFingerprintHash(fpPayload);
        const email = String((req.body || {}).email || "");
        if (!user) {
          const failedRisk = await assessRisk({
            email,
            fingerprintHash,
            ipAddress: fpPayload.ipAddress,
            country: fpPayload.country,
            asn: fpPayload.asn,
          });
          await recordLoginEvent({
            userId: null,
            email,
            eventType: "login_failed",
            fingerprintHash,
            ipAddress: fpPayload.ipAddress,
            asn: fpPayload.asn,
            country: fpPayload.country,
            riskScore: failedRisk.score,
            reasons: failedRisk.reasons,
          });
          return res.status(401).json({ message: "Invalid credentials." });
        }

        const risk = await assessRisk({
          userId: user.id as number,
          email: String(user.email),
          fingerprintHash,
          ipAddress: fpPayload.ipAddress,
          country: fpPayload.country,
          asn: fpPayload.asn,
        });
        await recordLoginEvent({
          userId: user.id as number,
          email: String(user.email),
          eventType: "login_success",
          fingerprintHash,
          ipAddress: fpPayload.ipAddress,
          asn: fpPayload.asn,
          country: fpPayload.country,
          riskScore: risk.score,
          reasons: risk.reasons,
        });
        if (risk.blockedForReview) {
          await recordAbuseEvent({
            userId: user.id as number,
            ip: fpPayload.ipAddress,
            fingerprintHash,
            eventType: "high_risk_login_block_review",
            details: { score: risk.score, reasons: risk.reasons },
          });
        }
        req.login(user, (loginErr) => {
          if (loginErr) return res.status(500).json({ message: "Login failed" });
          void writeAudit(req, "login", { email: String(user.email) }, user.id as number);
          const { password: _, apiKey: __, ...safeUser } = user;
          return res.json(
            scrubValue({
              ...safeUser,
              security: {
                riskScore: risk.score,
                captchaRequired: risk.requireCaptcha,
                otpRequired: risk.requireOtp,
                blockedForReview: risk.blockedForReview,
              },
            }),
          );
        });
      })().catch((e) => res.status(500).json({ message: safeError(e) }));
    })(req, res, next);
  });

  app.post("/api/auth/logout", (req, res) => {
    const uid = (req.user as { id: number } | undefined)?.id;
    req.logout(async () => {
      if (uid != null) await writeAudit(req, "logout", {}, uid);
      res.json({ message: "Logged out" });
    });
  });

  app.get("/api/auth/me", requireAuth, async (req, res) => {
    const user = req.user as any;
    const freshUser = await storage.getUser(user.id);
    if (!freshUser) return res.status(404).json({ message: "User not found" });
    const { password: _, apiKey: __, ...safeUser } = freshUser;
    res.json(safeUser);
  });

  app.post("/api/auth/resend-verification", requireAuth, resendVerificationLimiter, async (req, res) => {
    try {
      const user = req.user as User;
      if (user.emailVerified) return res.status(400).json({ message: "Email already verified" });
      const verifyNonce = randomBytes(24).toString("hex");
      const verifyJwt = signEmailVerificationJwt(user.id, verifyNonce);
      await storage.setUserEmailVerification(user.id, {
        tokenHash: sha256Hex(verifyNonce),
        expiresAt: new Date(Date.now() + 48 * 60 * 60 * 1000),
        sentAt: new Date(),
      });
      await sendEmailVerificationMessage({ to: user.email, verifyToken: verifyJwt }).catch(() => {});
      res.json({ message: "Verification email sent" });
    } catch (err: any) {
      res.status(500).json({ message: safeError(err) });
    }
  });

  // ========== CIRCLE WALLET ==========
  app.post("/api/wallet/create", requireAuth, async (req, res) => {
    try {
      const user = req.user as any;
      const freshUser = await storage.getUser(user.id);
      if (!freshUser) return res.status(404).json({ message: "User not found" });

      if (freshUser.circleWalletId && freshUser.circleWalletAddress) {
        return res.json({
          walletAddress: freshUser.circleWalletAddress,
          blockchain: freshUser.circleWalletBlockchain,
        });
      }

      const wallet = await createUserWallet();
      await storage.updateUserCircleWallet(user.id, wallet);
      return res.json({
        walletAddress: wallet.address,
        blockchain: wallet.blockchain,
      });
    } catch (err: any) {
      return res.status(500).json({ message: safeError(err) });
    }
  });

  app.get("/api/wallet/balance", requireAuth, async (req, res) => {
    try {
      const user = req.user as any;
      const freshUser = await storage.getUser(user.id);
      if (!freshUser) return res.status(404).json({ message: "User not found" });
      if (!freshUser.circleWalletId) return res.json({ balanceUsdc: 0 });

      const balanceUsdc = await getUserUsdcBalance(freshUser.circleWalletId);
      return res.json({
        balanceUsdc,
        walletAddress: freshUser.circleWalletAddress,
        blockchain: freshUser.circleWalletBlockchain,
      });
    } catch (err: any) {
      return res.status(500).json({ message: safeError(err) });
    }
  });

  // ========== OTP PURCHASE (CIRCLE + TELLABOT HIDDEN UPSTREAM) ==========
  app.post("/api/buy-number", requireAuth, orderLimiter, async (req, res) => {
    try {
      const user = req.user as any;
      const fpPayload = extractFingerprintPayload(req);
      const fingerprintHash = computeFingerprintHash(fpPayload);
      const abuseGate = await applyBuyAbuseProtection({
        userId: user.id,
        ipAddress: fpPayload.ipAddress,
        fingerprintHash,
      });
      if (!abuseGate.allow) {
        return res.status(429).json({ message: abuseGate.message });
      }
      const idempotencyKey = req.header("Idempotency-Key") || null;
      const { service } = req.body as { service?: string };
      if (!service || typeof service !== "string") {
        return res.status(400).json({ message: "service is required" });
      }

      const cleanService = service.trim().toLowerCase();
      const idemBodyHash = idempotencyKey
        ? sha256(JSON.stringify({ service: cleanService, userId: user.id }))
        : null;
      if (idempotencyKey && idemBodyHash) {
        const idemStorageKey = `${user.id}:${idempotencyKey}`;
        const cached = await getIdempotencyRecord(idemStorageKey);
        if (cached && cached.bodyHash === idemBodyHash) {
          return res.status(cached.statusCode).json(JSON.parse(cached.responseBody) as Record<string, unknown>);
        }
      }

      const normalizeServiceKey = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, "");
      const matchedService =
        (await storage.getServiceBySlug(cleanService)) ||
        (await storage.getAllServices()).find((svc) => {
          const serviceSlug = normalizeServiceKey(svc.slug || "");
          const serviceName = normalizeServiceKey(svc.name || "");
          const requested = normalizeServiceKey(cleanService);
          return serviceSlug === requested || serviceName === requested;
        });

      if (!matchedService) {
        return res.status(404).json({ message: "Service not found" });
      }

      const freshUser = await storage.getUser(user.id);
      if (!freshUser) return res.status(404).json({ message: "User not found" });

      let walletId = freshUser.circleWalletId;
      if (!walletId) {
        const wallet = await withProviderCircuit("circle", "create_wallet", () => createUserWallet(), {
          userId: user.id,
        });
        await storage.updateUserCircleWallet(user.id, wallet);
        walletId = wallet.id;
      }

      const yourPrice = getUsdcSellPrice(cleanService, matchedService.price);
      const amountCents = parseAmountToCents(yourPrice);
      const bundleCredit = await storage.findUserBundleCredit(user.id, cleanService);
      const balanceUsdc = await withProviderCircuit("circle", "check_wallet_balance", () =>
        getUserUsdcBalance(walletId),
      );
      if (!bundleCredit && (balanceUsdc < Number.parseFloat(yourPrice) || parseAmountToCents(freshUser.balance) < amountCents)) {
        return res.status(402).json({ message: "Insufficient balance." });
      }

      const debit = bundleCredit
        ? {
            transactionId: await createFinancialTransaction({
              idempotencyKey,
              userId: user.id,
              type: "buy_number_bundle_credit",
              status: "success",
              amountCents: 0,
              metadata: { service: cleanService, bundleCreditId: bundleCredit.id },
            }),
            newBalanceCents: parseAmountToCents(freshUser.balance),
          }
        : await debitUserForPurchase({
            userId: user.id,
            amountCents,
            idempotencyKey,
            type: "buy_number_debit",
            metadata: { service: cleanService },
          });

      let upstream: { activationId: string; phoneNumber: string; raw: string };
      try {
        if (!bundleCredit) {
          await withProviderCircuit("circle", "transfer_user_to_master", () => transferFromUserToMaster(walletId, yourPrice), {
            userId: user.id,
            amountCents,
          });
        }
        upstream = await withProviderCircuit("tellabot", "buy_number", () => buyNumberFromTellabot(cleanService), {
          userId: user.id,
          service: cleanService,
        });
        if (bundleCredit) {
          await storage.decrementUserBundleCredit(bundleCredit.id);
        } else {
          await recordRevenueAndCost({
            transactionId: debit.transactionId,
            totalDebitCents: amountCents,
            tellabotCostCents: amountCents,
          });
        }
      } catch (providerError) {
        if (!bundleCredit) {
          await creditUser({
            userId: user.id,
            amountCents,
            idempotencyKey: idempotencyKey ? `${idempotencyKey}:reversal` : null,
            type: "buy_number_reversal",
            metadata: { reason: "provider_failure", service: cleanService },
          });
        }
        await sendFinancialAlert("warning", "buy_number_reversed", {
          userId: user.id,
          amountCents,
          reason: "provider_failure",
        });
        return res.status(503).json({ message: "Service temporarily unavailable. Please try again." });
      }

      const now = new Date();
      const expiresAt = new Date(now.getTime() + 20 * 60 * 1000);

      const order = await storage.createOrder({
        userId: user.id,
        serviceId: matchedService.id,
        serviceName: matchedService.name,
        phoneNumber: upstream.phoneNumber.startsWith("+")
          ? upstream.phoneNumber
          : `+${upstream.phoneNumber}`,
        status: "waiting",
        otpCode: null,
        smsMessages: null,
        price: yourPrice,
        tellabotRequestId: null,
        activationId: upstream.activationId,
        tellabotMdn: null,
        costPrice: null,
        createdAt: now.toISOString(),
        expiresAt: expiresAt.toISOString(),
        completedAt: null,
      });

      const responsePayload = { orderId: order.id, phoneNumber: order.phoneNumber };
      if (idempotencyKey && idemBodyHash) {
        await saveIdempotencyRecord({
          key: `${user.id}:${idempotencyKey}`,
          bodyHash: idemBodyHash,
          responseBody: JSON.stringify(responsePayload),
          statusCode: 200,
        });
      }

      return res.json(responsePayload);
    } catch (err: any) {
      if (String(err?.message || "").toLowerCase().includes("insufficient")) {
        return res.status(402).json({ message: "Insufficient funds" });
      }
      return res.status(500).json({ message: safeError(err) });
    }
  });

  app.get("/api/check-sms/:orderId", requireAuth, async (req, res) => {
    try {
      const user = req.user as any;
      const rawOrderId = Array.isArray(req.params.orderId) ? req.params.orderId[0] : req.params.orderId;
      const orderId = Number.parseInt(rawOrderId, 10);
      if (Number.isNaN(orderId)) return res.status(400).json({ message: "Invalid order id" });

      const order = await storage.getOrder(orderId);
      if (!order) return res.status(404).json({ message: "Order not found" });
      if (order.userId !== user.id) return res.status(403).json({ message: "Forbidden" });

      if (!order.activationId) {
        return res.status(400).json({ message: "Order has no active upstream reservation" });
      }

      const code = await waitForSmsCode(order.activationId);
      if (code) {
        await storage.updateOrderStatus(order.id, "completed", code);
        return res.json({ code, refunded: false });
      }

      await storage.updateOrderStatus(order.id, "failed");
      await cancelTellabotNumber(order.activationId);
      await creditUser({
        userId: user.id,
        amountCents: parseAmountToCents(order.price),
        idempotencyKey: `sms-fail-refund:${order.id}`,
        type: "order_refund",
        metadata: { orderId: order.id, reason: "sms_timeout" },
      });
      return res.json({ code: null, refunded: true });
    } catch (err: any) {
      return res.status(500).json({ message: safeError(err) });
    }
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

  app.post("/api/orders", requireAuth, requireVerifiedEmail, orderLimiter, async (req, res) => {
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

      const order = await runTransaction(async () => {
        const txUser = await syncDb.getUser(user.id);
        if (!txUser) throw new Error("User not found");
        const txBalance = parseFloat(txUser.balance);
        if (txBalance < price) throw new Error("Insufficient balance");

        const newBalance = (txBalance - price).toFixed(2);
        await syncDb.updateUserBalance(user.id, newBalance);

        const ord = await syncDb.createOrder({
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

        await syncDb.createTransaction({
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
    res.json(userOrders.map(sanitizeOrderForClient));
  });

  app.get("/api/orders/active", requireAuth, async (req, res) => {
    const user = req.user as any;
    const activeOrders = await storage.getActiveOrders(user.id);
    res.json(activeOrders.map(sanitizeOrderForClient));
  });

  app.get("/api/orders/:id", requireAuth, async (req, res) => {
    const user = req.user as any;
    const order = await storage.getOrder(Number(req.params.id));
    if (!order) return res.status(404).json({ message: "Order not found" });
    if (order.userId !== user.id && (req.user as any)?.role !== "admin") {
      return res.status(403).json({ message: "Forbidden" });
    }
    res.json(sanitizeOrderForClient(order));
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
        return res.status(400).json({ message: "No provider request linked" });
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

      await runTransaction(async () => {
        await syncDb.cancelOrder(order.id);
        const txUser = await syncDb.getUser(user.id);
        if (txUser) {
          const newBalance = (parseFloat(txUser.balance) + parseFloat(order.price)).toFixed(2);
          await syncDb.updateUserBalance(user.id, newBalance);
          await syncDb.createTransaction({
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

  app.get("/api/status", async (_req, res) => {
    res.json({
      smsProvider: "Online",
      walletProvider: "Online",
      updatedAt: new Date().toISOString(),
    });
  });

  app.get("/api/bundles", requireAuth, async (_req, res) => {
    const bundles = await storage.getActiveServiceBundles();
    res.json({ bundles });
  });

  app.post("/api/bundles/:id/purchase", requireAuth, async (req, res) => {
    const user = req.user as any;
    const bundleId = Number(req.params.id);
    const bundle = await storage.getServiceBundleById(bundleId);
    if (!bundle) return res.status(404).json({ message: "Bundle not found" });
    try {
      const debit = await debitUserForPurchase({
        userId: user.id,
        amountCents: bundle.priceCents,
        idempotencyKey: req.header("Idempotency-Key") || null,
        type: "bundle_purchase",
        metadata: { bundleId: bundle.id },
      });
      const expiresAt = new Date(Date.now() + bundle.expiresDays * 24 * 60 * 60 * 1000).toISOString();
      await storage.createUserBundleCredit({
        userId: user.id,
        bundleId: bundle.id,
        service: bundle.service,
        remainingCredits: bundle.quantity,
        expiresAt,
        createdAt: new Date().toISOString(),
      });
      await recordRevenueAndCost({
        transactionId: debit.transactionId,
        totalDebitCents: bundle.priceCents,
        tellabotCostCents: 0,
      });
      res.json({ ok: true });
    } catch (err) {
      res.status(402).json({ message: safeError(err) });
    }
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

  app.post(
    "/api/crypto/create-deposit",
    requireAuth,
    requireVerifiedEmail,
    verifyTurnstile(),
    validateBody(createDepositBodySchema),
    async (req, res) => {
    try {
      const user = req.user as any;
      const { currency, amount } = req.body as { currency: string; amount: string };
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
      await writeAudit(req, "deposit_create", { depositId: deposit.id, currency, amount: usdAmount.toFixed(2) });
      res.json(deposit);
    } catch (err: any) { res.status(500).json({ message: safeError(err) }); }
  });

  // Financial alias endpoint retained for strict idempotency middleware path coverage.
  app.post("/api/deposit", requireAuth, async (req, res) => {
    req.url = "/api/crypto/create-deposit";
    return res.status(307).json({ message: "Use /api/crypto/create-deposit", forwarded: true });
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
      await runTransaction(async () => {
        await syncDb.updateCryptoDeposit(deposit.id, { status: "completed", completedAt: now });
      });
      const credit = await creditUser({
        userId: user.id,
        amountCents: parseAmountToCents(deposit.amount),
        idempotencyKey: `deposit-confirm:${deposit.id}`,
        type: "deposit_credit",
        metadata: { depositId: deposit.id, currency: deposit.currency },
      });
      res.json({ message: "Deposit confirmed", newBalance: (credit.newBalanceCents / 100).toFixed(2) });
    } catch (err: any) { res.status(500).json({ message: safeError(err) }); }
  });

  app.post("/api/admin/crypto/:id/confirm", requireAdmin, async (req, res) => {
    try {
      const deposit = await storage.getCryptoDeposit(Number(req.params.id));
      if (!deposit) return res.status(404).json({ message: "Deposit not found" });
      if (deposit.status === "completed") return res.status(400).json({ message: "Already completed" });
      // Atomic: complete deposit + credit balance + create transaction
      const now = new Date().toISOString();
      await runTransaction(async () => {
        await syncDb.updateCryptoDeposit(deposit.id, { status: "completed", completedAt: now });
      });
      await creditUser({
        userId: deposit.userId,
        amountCents: parseAmountToCents(deposit.amount),
        idempotencyKey: `admin-deposit-confirm:${deposit.id}`,
        type: "admin_deposit_credit",
        metadata: { depositId: deposit.id, adminId: (req.user as any).id },
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

    // Check SMS provider balance (masked name)
    let smsProviderBalance = "N/A";
    try {
      const tbBal = await tellabotAPI("balance");
      if (tbBal.status === "ok") smsProviderBalance = `$${tbBal.message}`;
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
      smsProviderBalance,
      providerStatus: {
        smsProvider: "Online",
        walletProvider: "Online",
      },
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

  app.post("/api/admin/users/:id/add-balance", requireAdmin, async (req, res) => {
    try {
      const { amount } = req.body;
      if (!amount || isNaN(Number(amount)) || Number(amount) === 0) {
        return res.status(400).json({ message: "Valid non-zero amount required" });
      }
      const numAmount = Number(amount);
      if (numAmount > 10000) {
        return res.status(400).json({ message: "Maximum single adjustment is $10,000" });
      }
      const targetUser = await storage.getUser(Number(req.params.id));
      if (!targetUser) return res.status(404).json({ message: "User not found" });
      const cents = parseAmountToCents(Math.abs(numAmount));
      const result = numAmount > 0
        ? await creditUser({
            userId: targetUser.id,
            amountCents: cents,
            idempotencyKey: `admin-adjust:${targetUser.id}:${Date.now()}`,
            type: "admin_credit",
            metadata: { adminId: (req.user as any).id },
          })
        : await debitUserForPurchase({
            userId: targetUser.id,
            amountCents: cents,
            idempotencyKey: `admin-adjust:${targetUser.id}:${Date.now()}`,
            type: "admin_debit",
            metadata: { adminId: (req.user as any).id },
          });
      res.json({ message: "Balance updated", newBalance: (result.newBalanceCents / 100).toFixed(2) });
    } catch (err: any) { res.status(500).json({ message: safeError(err) }); }
  });

  app.post("/api/webhooks/circle", async (req, res) => {
    const secret = process.env.CIRCLE_WEBHOOK_SECRET;
    if (!secret) return res.status(500).json({ message: "Webhook secret not configured" });

    const verification = await verifyWebhookSignature({
      provider: "circle",
      req,
      secret,
      signatureHeader: "x-circle-signature",
      timestampHeader: "x-circle-timestamp",
      webhookIdHeader: "x-circle-webhook-id",
    });

    if (!verification.ok) {
      await sendFinancialAlert("critical", "webhook_signature_failed", { provider: "circle", reason: verification.reason });
      return res.status(401).json({ message: "Invalid webhook signature" });
    }

    if (verification.duplicate) {
      return res.status(200).json({ message: "Duplicate ignored" });
    }

    // Additive webhook skeleton: safely acknowledge validated payload.
    logFinancialEvent("circle_webhook_processed", {
      status: "accepted",
      webhookId: verification.webhookId,
      sourceIp: req.ip,
      userAgent: req.get("user-agent") || null,
    });

    return res.status(200).json({ ok: true });
  });

  app.get("/api/plans", requireAuth, async (_req, res) => {
    const monthly = [
      { id: "starter", name: "Starter", monthlyPriceCents: 500, cashbackPct: 2 },
      { id: "gold", name: "Gold", monthlyPriceCents: 1200, cashbackPct: 6 },
      { id: "reseller", name: "Reseller", monthlyPriceCents: 2000, cashbackPct: 0, resellerDiscountPct: 5 },
    ];
    const plans = monthly.map((p) => ({
      ...p,
      annualPriceCents: Math.round(p.monthlyPriceCents * 12 * 0.8),
    }));
    res.json({ plans });
  });

  app.post("/api/upgrade", requireAuth, async (req, res) => {
    const user = req.user as any;
    const { planId, billingCycle } = req.body as { planId?: string; billingCycle?: "monthly" | "annual" };
    if (!planId || !billingCycle) return res.status(400).json({ message: "planId and billingCycle are required" });
    const planMap: Record<string, number> = {
      starter: 500,
      gold: 1200,
      reseller: 2000,
    };
    const monthly = planMap[planId];
    if (!monthly) return res.status(400).json({ message: "Invalid plan." });
    const amountCents = billingCycle === "annual" ? Math.round(monthly * 12 * 0.8) : monthly;
    try {
      const debit = await debitUserForPurchase({
        userId: user.id,
        amountCents,
        idempotencyKey: req.header("Idempotency-Key") || null,
        type: "upgrade_payment",
        metadata: { planId, billingCycle },
      });
      await recordRevenueAndCost({
        transactionId: debit.transactionId,
        totalDebitCents: amountCents,
        tellabotCostCents: 0,
      });
      if (billingCycle === "annual") {
        await storage.setUserAnnualBadge(user.id, true);
      }
      res.json({
        ok: true,
        planId,
        billingCycle,
        annualBadge: billingCycle === "annual",
      });
    } catch (err) {
      res.status(402).json({ message: safeError(err) });
    }
  });

  // ========== API v1 (API key auth) ==========

  async function requireApiKey(req: Request, res: Response, next: any) {
    const key = req.headers["x-api-key"] as string || req.query.api_key as string;
    if (!key) return res.status(401).json({ error: "API key required" });
    const user = await storage.getUserByApiKey(key);
    if (!user) return res.status(401).json({ error: "Invalid API key" });
    const usage = await trackApiKeyUse(key, user.id);
    if (usage.revoked) {
      await sendFinancialAlert("critical", "api_key_auto_revoked", { userId: user.id });
      return res.status(429).json({ error: "Too many requests. Please wait." });
    }
    (req as any).apiUser = user;
    next();
  }

  app.get("/api/v1/services", async (req, res) => {
    const tier = String(req.headers["x-plan-tier"] || "standard").toLowerCase();
    const cacheKey = `services:${tier}`;
    const payload = await withCache(cacheKey, 5 * 60 * 1000, async () => {
      const allServices = await storage.getAllServices();
      return { services: allServices };
    });
    res.json(payload);
  });

  app.get("/api/services/:service/stats", async (req, res) => {
    const service = String(req.params.service || "").toLowerCase();
    const payload = await withCache(`service_stats:${service}`, 5 * 60 * 1000, async () => {
      const statRes = await pool.query(
        `SELECT
           COUNT(*)::int AS total,
           COALESCE(SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END), 0)::int AS completed
         FROM orders
         WHERE LOWER(service_name) = LOWER($1::text)`,
        [service],
      );
      const rows = statRes.rows[0] as { total: number; completed: number };
      const total = rows?.total ?? 0;
      const completed = rows?.completed ?? 0;
      return {
        service,
        total,
        completed,
        successRate: total > 0 ? Number(((completed / total) * 100).toFixed(2)) : 0,
      };
    });
    res.json(payload);
  });

  app.get("/api/stats", async (_req, res) => {
    const payload = await withCache("homepage_stats", 5 * 60 * 1000, async () => {
      const u = await pool.query("SELECT COUNT(*)::int AS c FROM users");
      const o = await pool.query("SELECT COUNT(*)::int AS c FROM orders WHERE status = 'completed'");
      const totalUsers = u.rows[0] as { c: number };
      const completedOrders = o.rows[0] as { c: number };
      return { users: totalUsers.c, completedOrders: completedOrders.c };
    });
    res.json(payload);
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

      const order = await runTransaction(async () => {
        const txUser = await syncDb.getUser(user.id);
        if (!txUser) throw new Error("User not found");
        const txBalance = parseFloat(txUser.balance);
        if (txBalance < price) throw new Error("Insufficient balance");

        const newBalance = (txBalance - price).toFixed(2);
        await syncDb.updateUserBalance(user.id, newBalance);

        const ord = await syncDb.createOrder({
          userId: user.id, serviceId: svc.id, serviceName: svc.name,
          phoneNumber, status: "waiting", otpCode: null, smsMessages: null,
          price: svc.price, tellabotRequestId: tbData.id, tellabotMdn: tbData.mdn,
          createdAt: now.toISOString(), expiresAt: expiresAt.toISOString(), completedAt: null,
        });

        await syncDb.createTransaction({
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
      if (!newPassword || newPassword.length < 8) {
        return res.status(400).json({ message: "New password must be at least 8 characters" });
      }
      const freshUser = await storage.getUser(user.id);
      if (!freshUser) return res.status(404).json({ message: "User not found" });
      const isValid = await bcrypt.compare(currentPassword, freshUser.password);
      if (!isValid) return res.status(400).json({ message: "Current password is incorrect" });
      const hashed = await bcrypt.hash(newPassword, 10);
      await storage.updateUserPassword(user.id, hashed);
      res.json({ message: "Password updated" });
    } catch (err: any) { res.status(500).json({ message: safeError(err) }); }
  });

  // ========== CHANGELOG ==========
  app.get("/api/changelog", requireAuth, async (req, res) => {
    const user = req.user as any;
    const { rows } = await pool.query(
      `SELECT c.*, CASE WHEN cr.id IS NULL THEN 0 ELSE 1 END AS is_read
       FROM changelogs c
       LEFT JOIN changelog_reads cr ON cr.changelog_id = c.id AND cr.user_id = $1
       ORDER BY c.published_at DESC`,
      [user.id],
    );
    res.json(scrubValue(rows));
  });

  app.post("/api/changelog/read-all", requireAuth, async (req, res) => {
    const user = req.user as any;
    const now = new Date().toISOString();
    await pool.query(
      `INSERT INTO changelog_reads (user_id, changelog_id, read_at)
       SELECT $1::int, c.id, $2::text FROM changelogs c
       ON CONFLICT (user_id, changelog_id) DO NOTHING`,
      [user.id, now],
    );
    res.json({ ok: true });
  });

  app.post("/api/admin/changelog", requireAdmin, async (req, res) => {
    const { title, body, type, showModal } = req.body;
    if (!title || !body || !type) return res.status(400).json({ message: "Missing required fields" });
    await pool.query(
      "INSERT INTO changelogs (title, body, type, show_modal, published_at) VALUES ($1, $2, $3, $4, $5)",
      [String(title), String(body), String(type), showModal ? 1 : 0, new Date().toISOString()],
    );
    res.json({ ok: true });
  });

  // ========== SUPPORT + FAQ ==========
  app.get("/api/faq", async (_req, res) => {
    const { rows } = await pool.query(
      "SELECT * FROM faq_entries WHERE is_active = 1 ORDER BY sort_order ASC, id DESC",
    );
    res.json(rows);
  });

  app.post("/api/admin/faq", requireAdmin, async (req, res) => {
    const { question, answer, sortOrder } = req.body;
    if (!question || !answer) return res.status(400).json({ message: "Question and answer required" });
    await pool.query(
      "INSERT INTO faq_entries (question, answer, sort_order, is_active, created_at) VALUES ($1, $2, $3, 1, $4)",
      [String(question), String(answer), Number(sortOrder || 0), new Date().toISOString()],
    );
    res.json({ ok: true });
  });

  app.get("/api/support", requireAuth, async (req, res) => {
    const user = req.user as any;
    const { rows } = await pool.query(
      "SELECT * FROM support_tickets WHERE user_id = $1 ORDER BY id DESC",
      [user.id],
    );
    res.json(rows);
  });

  app.post("/api/support", requireAuth, async (req, res) => {
    const user = req.user as any;
    const { subject, message } = req.body;
    if (!subject || !message) return res.status(400).json({ message: "Subject and message are required" });
    const now = new Date().toISOString();
    const ins = await pool.query(
      `INSERT INTO support_tickets (user_id, subject, message, status, priority, created_at, updated_at)
       VALUES ($1, $2, $3, 'open', 'normal', $4, $5) RETURNING id`,
      [user.id, String(subject), String(message), now, now],
    );
    const ticketId = Number(ins.rows[0]?.id);
    await pool.query(
      "INSERT INTO support_ticket_messages (ticket_id, sender_role, sender_id, message, created_at) VALUES ($1, 'user', $2, $3, $4)",
      [ticketId, user.id, String(message), now],
    );
    res.json({ ok: true, ticketId });
  });

  app.get("/api/admin/support", requireAdmin, async (_req, res) => {
    const { rows } = await pool.query("SELECT * FROM support_tickets ORDER BY id DESC");
    res.json(rows);
  });

  app.post("/api/admin/support/:id/reply", requireAdmin, async (req, res) => {
    const ticketId = Number(req.params.id);
    const { message, status } = req.body;
    if (!message) return res.status(400).json({ message: "Reply message required" });
    const now = new Date().toISOString();
    const st = String(status || "in_progress");
    await pool.query(
      "INSERT INTO support_ticket_messages (ticket_id, sender_role, sender_id, message, created_at) VALUES ($1, 'admin', $2, $3, $4)",
      [ticketId, (req.user as any).id, String(message), now],
    );
    await pool.query(
      `UPDATE support_tickets SET status = $1, updated_at = $2,
       resolved_at = CASE WHEN $1 = 'resolved' THEN $2 ELSE resolved_at END WHERE id = $3`,
      [st, now, ticketId],
    );
    res.json({ ok: true });
  });

  app.get("/api/admin/abuse-events", requireAdmin, async (_req, res) => {
    const { rows } = await pool.query("SELECT * FROM abuse_events ORDER BY id DESC LIMIT 500");
    res.json(rows);
  });

  app.get("/api/admin/high-risk-accounts", requireAdmin, async (_req, res) => {
    const { rows } = await pool.query(
      `SELECT le.user_id AS "userId", u.email, u.username, MAX(le.risk_score) AS "maxRisk", MAX(le.created_at) AS "lastSeen"
       FROM login_events le
       JOIN users u ON u.id = le.user_id
       WHERE le.risk_score > 70
       GROUP BY le.user_id, u.email, u.username
       ORDER BY "maxRisk" DESC, "lastSeen" DESC`,
    );
    res.json(rows);
  });

  app.post("/api/admin/abuse-events/:id/resolve", requireAdmin, async (req, res) => {
    await pool.query("UPDATE abuse_events SET resolved_at = $1 WHERE id = $2", [
      new Date().toISOString(),
      Number(req.params.id),
    ]);
    res.json({ ok: true });
  });

  app.get("/api/admin/users/:id/linked-accounts", requireAdmin, async (req, res) => {
    const linked = await getLinkedAccounts(Number(req.params.id));
    res.json({ linkedAccounts: linked });
  });

  // Initial service sync on startup
  fetchTellabotServices().then(() => {
    console.log("TellaBot services synced");
  }).catch(err => {
    console.error("TellaBot initial sync failed:", err);
  });

  return httpServer;
}
