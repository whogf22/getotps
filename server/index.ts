import "dotenv/config";
import express, { type Request, Response, NextFunction } from "express";
import helmet from "helmet";
import compression from "compression";
import cors from "cors";
import pinoHttp from "pino-http";
import slowDown from "express-slow-down";
import { randomUUID } from "node:crypto";
import { registerRoutes } from "./routes";
import { serveStatic } from "./static";
import { stopCleanupJobs } from "./jobs/cleanup";
import { initFinancialSchema } from "./financial/core";
import { financialIdempotencyMiddleware } from "./financial/idempotency";
import { stopReconciliationJob } from "./financial/reconciliation";
import { createServer } from "http";
import { scrubValue } from "./security/provider-scrub";
import { toSafeErrorResponse } from "./security/errors";
import { logger } from "./logger";
import { closePool } from "./db";
import { closeRedis } from "./redis";

const app = express();
const httpServer = createServer(app);
const isProduction = process.env.NODE_ENV === "production";
let inflightRequests = 0;
let shuttingDown = false;

app.set("trust proxy", isProduction ? 1 : false);

declare module "http" {
  interface IncomingMessage {
    rawBody: unknown;
  }
}

if (isProduction) {
  app.use((req, res, next) => {
    if (process.env.ENFORCE_HTTPS === "false") return next();
    const xfProto = req.headers["x-forwarded-proto"];
    const secure = req.secure || xfProto === "https";
    if (secure) return next();
    const host = req.headers.host || "";
    return res.redirect(301, `https://${host}${req.url}`);
  });
}

app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'", "https://challenges.cloudflare.com"],
        styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
        fontSrc: ["'self'", "https://fonts.gstatic.com"],
        imgSrc: ["'self'", "data:", "https:"],
        connectSrc: ["'self'"],
        frameSrc: ["'self'", "https://challenges.cloudflare.com"],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
        frameAncestors: ["'self'"],
        scriptSrcAttr: ["'none'"],
        ...(isProduction ? { upgradeInsecureRequests: [] as [] } : {}),
      },
    },
    referrerPolicy: { policy: "strict-origin-when-cross-origin" },
    frameguard: { action: "deny" },
  }),
);

app.use(compression());

const allowedOrigins = new Set<string>(
  [
    process.env.FRONTEND_URL,
    process.env.APP_URL,
    ...(process.env.ALLOWED_ORIGINS || "").split(",").map((o) => o.trim()),
    "http://localhost:5000",
    "http://127.0.0.1:5000",
  ].filter((o): o is string => Boolean(o)),
);

app.use(
  cors({
    origin: (origin, cb) => {
      if (!origin) return cb(null, true);
      if (allowedOrigins.has(origin)) return cb(null, true);
      return cb(null, false);
    },
    credentials: true,
    methods: ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "X-CSRF-Token", "X-API-Key", "X-Request-Id", "X-Admin-Totp"],
  }),
);

app.use((req, res, next) => {
  if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return next();
  if (!req.path.startsWith("/api")) return next();

  const apiKeyHeader = req.headers["x-api-key"];
  if (apiKeyHeader) return next();

  const origin = req.headers.origin;
  const referer = req.headers.referer;
  if (!origin && !referer) return res.status(403).json({ message: "Blocked request origin" });

  const candidate = origin || referer || "";
  const matched = Array.from(allowedOrigins).some((allowed) => candidate.startsWith(allowed));
  if (!matched) {
    return res.status(403).json({ message: "Invalid request origin" });
  }
  return next();
});

app.use((_req, res, next) => {
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=()");
  next();
});

app.use(
  express.json({
    verify: (req, _res, buf) => {
      req.rawBody = buf;
    },
  }),
);

app.use(express.urlencoded({ extended: false }));
app.use(financialIdempotencyMiddleware);

if (process.env.NODE_ENV !== "test") {
  app.use(
    "/api",
    slowDown({
      windowMs: 60_000,
      delayAfter: 120,
      delayMs: () => 100,
      maxDelayMs: 5000,
    }),
  );
}

app.use(
  pinoHttp({
    logger,
    genReqId: (req) => (req.headers["x-request-id"] as string) || randomUUID(),
    customLogLevel(_req, res, err) {
      if (err || res.statusCode >= 500) return "error";
      if (res.statusCode >= 400) return "warn";
      return "info";
    },
  }),
);

export function log(message: string, source = "express") {
  logger.info({ source }, message);
}

app.use((req, res, next) => {
  inflightRequests += 1;
  res.on("finish", () => {
    inflightRequests = Math.max(0, inflightRequests - 1);
  });

  if (shuttingDown) {
    return res.status(503).json({ message: "Service temporarily unavailable. Please try again." });
  }

  if (req.path.startsWith("/api")) {
    res.setHeader("Cache-Control", "no-store");
  }

  res.removeHeader("X-Powered-By");
  res.setHeader("Server", "getotps");

  const originalResJson = res.json;
  res.json = function (bodyJson, ...args) {
    const sanitized = scrubValue(bodyJson);
    return originalResJson.apply(res, [sanitized, ...args]);
  };

  next();
});

(async () => {
  await initFinancialSchema();
  await registerRoutes(httpServer, app);

  app.use((err: unknown, _req: Request, res: Response, next: NextFunction) => {
    const mapped = toSafeErrorResponse(err);
    const status =
      typeof err === "object" && err !== null && "status" in err
        ? Number((err as { status?: number }).status)
        : typeof err === "object" && err !== null && "statusCode" in err
          ? Number((err as { statusCode?: number }).statusCode)
          : mapped.status;
    const message = mapped.message;

    logger.error({ err }, "unhandled_error");

    if (res.headersSent) {
      return next(err);
    }

    return res.status(status).json({ message: scrubValue(message) });
  });

  if (process.env.NODE_ENV === "production") {
    serveStatic(app);
  } else {
    const { setupVite } = await import("./vite");
    await setupVite(httpServer, app);
  }

  const port = parseInt(process.env.PORT || "5000", 10);
  httpServer.    listen(
    {
      port,
      host: "0.0.0.0",
      reusePort: true,
    },
    () => {
      logger.info({ port }, "http_listen");
      // Background jobs run in `server/worker.ts` (see npm run start:worker / PM2 worker app).
    },
  );

  let shutdownStarted = false;
  const shutdown = (signal: string) => {
    if (shutdownStarted) return;
    shutdownStarted = true;
    shuttingDown = true;
    logger.info({ signal }, "graceful_shutdown_start");
    stopCleanupJobs();
    stopReconciliationJob();

    const deadline = Date.now() + 30_000;
    const waitAndClose = () => {
      if (inflightRequests === 0 || Date.now() >= deadline) {
        if (inflightRequests > 0) {
          logger.warn({ inflightRequests }, "shutdown_timeout_inflight");
        }
        httpServer.close((closeErr) => {
          if (closeErr) logger.error({ err: closeErr }, "http_server_close");
          void closePool()
            .catch((e) => logger.error({ err: e }, "pool_close"))
            .finally(() =>
              void closeRedis()
                .catch((e) => logger.error({ err: e }, "redis_close"))
                .finally(() => process.exit(0)),
            );
        });
        return;
      }
      setTimeout(waitAndClose, 250);
    };
    waitAndClose();
  };

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
})();
