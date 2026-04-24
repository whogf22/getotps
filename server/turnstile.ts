import type { Request, Response, NextFunction } from "express";

function tokenFrom(req: Request): string | undefined {
  const body = (req.body || {}) as Record<string, unknown>;
  const fromBody =
    typeof body.cfTurnstileResponse === "string"
      ? body.cfTurnstileResponse
      : typeof body.turnstileToken === "string"
        ? body.turnstileToken
        : undefined;
  const header = req.headers["cf-turnstile-response"];
  const fromHeader = typeof header === "string" ? header : Array.isArray(header) ? header[0] : undefined;
  return fromBody || fromHeader;
}

/**
 * Verifies Cloudflare Turnstile when TURNSTILE_SECRET is set.
 * In test, skips unless TURNSTILE_ENFORCE_IN_TEST=1.
 */
export async function verifyTurnstileToken(req: Request): Promise<boolean> {
  const secret = process.env.TURNSTILE_SECRET;
  if (!secret) return true;
  if (process.env.NODE_ENV === "test" && process.env.TURNSTILE_ENFORCE_IN_TEST !== "1") {
    return true;
  }

  const token = tokenFrom(req);
  if (!token) return false;

  const params = new URLSearchParams();
  params.set("secret", secret);
  params.set("response", token);
  const ip = req.ip;
  if (ip) params.set("remoteip", ip);

  const res = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: params.toString(),
  });
  if (!res.ok) return false;
  const data = (await res.json()) as { success?: boolean };
  return Boolean(data.success);
}

export function verifyTurnstile(): (req: Request, res: Response, next: NextFunction) => void {
  return (req, res, next) => {
    void verifyTurnstileToken(req).then((ok) => {
      if (!ok) return res.status(400).json({ message: "Captcha verification failed" });
      next();
    });
  };
}
