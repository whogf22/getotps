import type { NextFunction, Request, Response } from "express";
import { getIdempotencyRecord, saveIdempotencyRecord, sha256 } from "./core";

const REQUIRED_FINANCIAL_PATHS = new Set([
  "/api/buy-number",
  "/api/deposit",
  "/api/withdraw",
  "/api/upgrade",
]);

function shouldRequireKey(req: Request): boolean {
  if (req.method !== "POST") return false;
  if (REQUIRED_FINANCIAL_PATHS.has(req.path)) return true;
  return req.path.startsWith("/api/payment/");
}

export function financialIdempotencyMiddleware(req: Request, res: Response, next: NextFunction): void {
  if (!shouldRequireKey(req)) return next();

  const key = req.header("Idempotency-Key");
  if (!key) {
    res.status(400).json({ message: "Idempotency-Key header is required for financial requests" });
    return;
  }

  const bodyHash = sha256(JSON.stringify(req.body ?? {}));
  const existing = getIdempotencyRecord(key);
  if (existing) {
    if (existing.bodyHash !== bodyHash) {
      res.status(409).json({ message: "Idempotency key reused with different payload" });
      return;
    }
    res.status(existing.statusCode).json(JSON.parse(existing.responseBody));
    return;
  }

  const originalJson = res.json.bind(res);
  res.json = ((body: unknown) => {
    if (res.statusCode >= 200 && res.statusCode < 600) {
      saveIdempotencyRecord({
        key,
        bodyHash,
        responseBody: JSON.stringify(body),
        statusCode: res.statusCode,
      });
    }
    return originalJson(body);
  }) as typeof res.json;

  next();
}
