import crypto from "crypto";
import { sqliteClient } from "../storage";

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

function countFailedAttemptsInLastHour(email: string): number {
  const row = sqliteClient
    .prepare(
      `SELECT COUNT(*) AS c
       FROM login_events
       WHERE email = ?
         AND event_type = 'login_failed'
         AND datetime(created_at) >= datetime('now', '-1 hour')`,
    )
    .get(email) as { c: number };
  return row?.c ?? 0;
}

export function assessRisk(params: {
  userId?: number | null;
  email: string;
  fingerprintHash: string;
  ipAddress: string;
  country: string;
  asn: string;
}): RiskAssessment {
  let score = 0;
  const reasons: string[] = [];

  if (SUSPICIOUS_ASN_TERMS.some((term) => params.asn.toLowerCase().includes(term))) {
    score += 40;
    reasons.push("vpn_or_datacenter_ip");
  }

  if (params.userId) {
    const hasKnownFingerprint = sqliteClient
      .prepare(
        `SELECT 1 FROM login_events
         WHERE user_id = ? AND fingerprint_hash = ?
         LIMIT 1`,
      )
      .get(params.userId, params.fingerprintHash);
    if (!hasKnownFingerprint) {
      score += 20;
      reasons.push("new_device_fingerprint");
    }

    const lastCountry = sqliteClient
      .prepare(
        `SELECT country FROM login_events
         WHERE user_id = ?
         ORDER BY id DESC
         LIMIT 1`,
      )
      .get(params.userId) as { country?: string } | undefined;
    if (lastCountry?.country && lastCountry.country !== params.country) {
      score += 15;
      reasons.push("country_changed");
    }
  }

  const accountsFromFingerprint = sqliteClient
    .prepare("SELECT COUNT(DISTINCT user_id) AS c FROM login_events WHERE fingerprint_hash = ? AND user_id IS NOT NULL")
    .get(params.fingerprintHash) as { c: number };
  if ((accountsFromFingerprint?.c ?? 0) >= 3) {
    score += 50;
    reasons.push("multi_account_fingerprint");
  }

  const failedAttempts = countFailedAttemptsInLastHour(params.email);
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

export function recordLoginEvent(params: {
  userId?: number | null;
  email: string;
  eventType: "register" | "login_success" | "login_failed";
  fingerprintHash: string;
  ipAddress: string;
  asn: string;
  country: string;
  riskScore: number;
  reasons: string[];
}): void {
  sqliteClient
    .prepare(
      `INSERT INTO login_events (
         user_id, email, event_type, fingerprint_hash, ip_address, asn, country, risk_score, reasons, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
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
    );
}

export function getLinkedAccounts(userId: number): Array<{ id: number; username: string; email: string }> {
  const rows = sqliteClient
    .prepare(
      `SELECT DISTINCT u.id, u.username, u.email
       FROM users u
       JOIN login_events le ON le.user_id = u.id
       WHERE (
         le.fingerprint_hash IN (
           SELECT fingerprint_hash FROM login_events WHERE user_id = ?
         ) OR le.ip_address IN (
           SELECT ip_address FROM login_events WHERE user_id = ?
         )
       ) AND u.id != ?`,
    )
    .all(userId, userId, userId) as Array<{ id: number; username: string; email: string }>;
  return rows;
}
