import crypto from "crypto";
import { pool } from "../db";

export type FingerprintPayload = {
  userAgent: string;
  acceptLanguage: string;
  screenResolution: string;
  timezoneOffset: string;
  canvasHash: string;
  ipAddress: string;
  asn: string;
  country: string;
};

export type RiskAssessment = {
  score: number;
  requireCaptcha: boolean;
  requireOtp: boolean;
  blockedForReview: boolean;
  reasons: string[];
};

const SUSPICIOUS_ASN_TERMS = ["hosting", "cloud", "vpn", "proxy", "tor", "datacenter"];

export function computeFingerprintHash(payload: FingerprintPayload): string {
  const normalized = [
    payload.userAgent,
    payload.acceptLanguage,
    payload.screenResolution,
    payload.timezoneOffset,
    payload.canvasHash,
    payload.ipAddress,
    payload.asn,
    payload.country,
  ].join("|");
  return crypto.createHash("sha256").update(normalized).digest("hex");
}

async function countFailedAttemptsInLastHour(email: string): Promise<number> {
  const r = await pool.query<{ c: string }>(
    `SELECT COUNT(*)::text AS c FROM login_events
     WHERE email = $1 AND event_type = 'login_failed'
       AND created_at::timestamptz >= now() - interval '1 hour'`,
    [email],
  );
  return Number(r.rows[0]?.c ?? 0);
}

export async function assessRisk(params: {
  userId?: number | null;
  email: string;
  fingerprintHash: string;
  ipAddress: string;
  country: string;
  asn: string;
}): Promise<RiskAssessment> {
  let score = 0;
  const reasons: string[] = [];

  if (SUSPICIOUS_ASN_TERMS.some((term) => params.asn.toLowerCase().includes(term))) {
    score += 40;
    reasons.push("vpn_or_datacenter_ip");
  }

  if (params.userId) {
    const fpRes = await pool.query(
      `SELECT 1 FROM login_events
       WHERE user_id = $1 AND fingerprint_hash = $2
       LIMIT 1`,
      [params.userId, params.fingerprintHash],
    );
    if (fpRes.rowCount === 0) {
      score += 20;
      reasons.push("new_device_fingerprint");
    }

    const countryRes = await pool.query<{ country: string }>(
      `SELECT country FROM login_events
       WHERE user_id = $1
       ORDER BY id DESC
       LIMIT 1`,
      [params.userId],
    );
    const lastCountry = countryRes.rows[0];
    if (lastCountry?.country && lastCountry.country !== params.country) {
      score += 15;
      reasons.push("country_changed");
    }
  }

  const multiRes = await pool.query<{ c: string }>(
    "SELECT COUNT(DISTINCT user_id)::text AS c FROM login_events WHERE fingerprint_hash = $1 AND user_id IS NOT NULL",
    [params.fingerprintHash],
  );
  if (Number(multiRes.rows[0]?.c ?? 0) >= 3) {
    score += 50;
    reasons.push("multi_account_fingerprint");
  }

  const failedAttempts = await countFailedAttemptsInLastHour(params.email);
  if (failedAttempts > 0) {
    score += failedAttempts * 10;
    reasons.push("recent_failed_attempts");
  }

  return {
    score,
    requireCaptcha: score > 70,
    requireOtp: score > 70,
    blockedForReview: score > 90,
    reasons,
  };
}

export async function recordLoginEvent(params: {
  userId?: number | null;
  email: string;
  eventType: "register" | "login_success" | "login_failed";
  fingerprintHash: string;
  ipAddress: string;
  asn: string;
  country: string;
  riskScore: number;
  reasons: string[];
}): Promise<void> {
  await pool.query(
    `INSERT INTO login_events (
       user_id, email, event_type, fingerprint_hash, ip_address, asn, country, risk_score, reasons, created_at
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [
      params.userId ?? null,
      params.email,
      params.eventType,
      params.fingerprintHash,
      params.ipAddress,
      params.asn,
      params.country,
      params.riskScore,
      JSON.stringify(params.reasons),
      new Date().toISOString(),
    ],
  );
}

export async function getLinkedAccounts(userId: number): Promise<Array<{ id: number; username: string; email: string }>> {
  const r = await pool.query<{ id: number; username: string; email: string }>(
    `SELECT DISTINCT u.id, u.username, u.email
     FROM users u
     JOIN login_events le ON le.user_id = u.id
     WHERE (
       le.fingerprint_hash IN (
         SELECT fingerprint_hash FROM login_events WHERE user_id = $1
       ) OR le.ip_address IN (
         SELECT ip_address FROM login_events WHERE user_id = $1
       )
     ) AND u.id != $2`,
    [userId, userId],
  );
  return r.rows;
}
