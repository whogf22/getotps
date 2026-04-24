import jwt from "jsonwebtoken";
import crypto from "node:crypto";

export function getJwtSecret(): string {
  const s = process.env.JWT_SECRET;
  if (process.env.NODE_ENV === "production" && !s) {
    throw new Error("FATAL: JWT_SECRET must be set in production.");
  }
  return s || "getotps-dev-jwt-insecure";
}

export function sha256Hex(input: string): string {
  return crypto.createHash("sha256").update(input, "utf8").digest("hex");
}

export type EmailVerifyClaims = { sub: number; typ: "ev"; n: string };

export function signEmailVerificationJwt(userId: number, nonce: string): string {
  return jwt.sign({ sub: userId, typ: "ev", n: nonce }, getJwtSecret(), { expiresIn: "48h" });
}

export function verifyEmailVerificationJwt(token: string): EmailVerifyClaims {
  const p = jwt.verify(token, getJwtSecret()) as jwt.JwtPayload & { n?: string; typ?: string };
  const subNum = typeof p.sub === "string" ? Number(p.sub) : typeof p.sub === "number" ? p.sub : NaN;
  if (p.typ !== "ev" || !Number.isFinite(subNum) || typeof p.n !== "string") {
    throw new Error("Invalid verification token");
  }
  return { sub: subNum, typ: "ev", n: p.n };
}
