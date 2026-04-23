import "dotenv/config";
import express, { type Request, Response, NextFunction } from "express";
import helmet from "helmet";
import { registerRoutes } from "./routes";
import { serveStatic } from "./static";
import { startTronPoller } from "./tronPoller";
import { startCleanupJobs } from "./jobs/cleanup";
import { createServer } from "http";

const app = express();
const httpServer = createServer(app);
const isProduction = process.env.NODE_ENV === "production";

// Respect reverse proxies (nginx / Cloudflare / host ingress) for real client IP and secure cookies.
app.set("trust proxy", isProduction ? 1 : false);

declare module "http" {
  interface IncomingMessage {
    rawBody: unknown;
  }
}

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      fontSrc: ["'self'", "https://fonts.gstatic.com"],
      imgSrc: ["'self'", "data:", "https:"],
      connectSrc: ["'self'"],
      frameSrc: ["'none'"],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
      formAction: ["'self'"],
      frameAncestors: ["'self'"],
      scriptSrcAttr: ["'none'"],
      upgradeInsecureRequests: [],
    },
  },
  referrerPolicy: { policy: "strict-origin-when-cross-origin" },
  frameguard: { action: "deny" },
}));

const allowedOrigins = new Set(
  (process.env.ALLOWED_ORIGINS || process.env.APP_URL || "http://localhost:5000")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean),
);
allowedOrigins.add("http://localhost:5000");
allowedOrigins.add("http://127.0.0.1:5000");

app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (!origin) return next();
  if (allowedOrigins.has(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Access-Control-Allow-Credentials", "true");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-CSRF-Token, X-API-Key");
    res.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,PATCH,DELETE,OPTIONS");
    res.setHeader("Vary", "Origin");
  }
  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }
  return next();
});

// Basic CSRF defense for cookie-authenticated mutating requests.
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

export function log(message: string, source = "express") {
  const formattedTime = new Date().toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });

  console.log(`${formattedTime} [${source}] ${message}`);
}

app.use((req, res, next) => {
  const start = Date.now();
  const path = req.path;
  let capturedJsonResponse: Record<string, any> | undefined = undefined;

  const originalResJson = res.json;
  res.json = function (bodyJson, ...args) {
    capturedJsonResponse = bodyJson;
    return originalResJson.apply(res, [bodyJson, ...args]);
  };

  res.on("finish", () => {
    const duration = Date.now() - start;
    if (path.startsWith("/api")) {
      let logLine = `${req.method} ${path} ${res.statusCode} in ${duration}ms`;
      if (capturedJsonResponse && process.env.NODE_ENV !== "production") {
        logLine += ` :: ${JSON.stringify(capturedJsonResponse).slice(0, 200)}`;
      }

      log(logLine);
    }
  });

  next();
});

(async () => {
  await registerRoutes(httpServer, app);

  app.use((err: any, _req: Request, res: Response, next: NextFunction) => {
    const status = err.status || err.statusCode || 500;
    const message = process.env.NODE_ENV === "production"
      ? "Internal Server Error"
      : (err.message || "Internal Server Error");

    console.error("Internal Server Error:", err);

    if (res.headersSent) {
      return next(err);
    }

    return res.status(status).json({ message });
  });

  // importantly only setup vite in development and after
  // setting up all the other routes so the catch-all route
  // doesn't interfere with the other routes
  if (process.env.NODE_ENV === "production") {
    serveStatic(app);
  } else {
    const { setupVite } = await import("./vite");
    await setupVite(httpServer, app);
  }

  // ALWAYS serve the app on the port specified in the environment variable PORT
  // Other ports are firewalled. Default to 5000 if not specified.
  // this serves both the API and the client.
  // It is the only port that is not firewalled.
  const port = parseInt(process.env.PORT || "5000", 10);
  httpServer.listen(
    {
      port,
      host: "0.0.0.0",
      reusePort: true,
    },
    () => {
      log(`serving on port ${port}`);

      // Start TronGrid USDT deposit poller
      startTronPoller();
      startCleanupJobs();
    },
  );
})();
