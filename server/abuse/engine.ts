import { sqliteClient } from "../storage";

function nowIso(): string {
  return new Date().toISOString();
}

export function recordAbuseEvent(params: {
  userId?: number | null;
  ip?: string | null;
  fingerprintHash?: string | null;
  eventType: string;
  details?: Record<string, unknown>;
}): void {
  sqliteClient
    .prepare(
      `INSERT INTO abuse_events (user_id, ip_address, fingerprint_hash, event_type, details, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(
      params.userId ?? null,
      params.ip ?? null,
      params.fingerprintHash ?? null,
      params.eventType,
      JSON.stringify(params.details ?? {}),
      nowIso(),
    );
}

export function isUserSoftBlocked(userId: number): boolean {
  const row = sqliteClient
    .prepare(
      `SELECT blocked_until FROM abuse_blocks
       WHERE scope = 'user' AND scope_id = ?
       ORDER BY id DESC LIMIT 1`,
    )
    .get(String(userId)) as { blocked_until?: string } | undefined;
  if (!row?.blocked_until) return false;
  return new Date(row.blocked_until).getTime() > Date.now();
}

export function isIpHardBlocked(ipAddress: string): boolean {
  const row = sqliteClient
    .prepare(
      `SELECT blocked_until FROM abuse_blocks
       WHERE scope = 'ip' AND scope_id = ?
       ORDER BY id DESC LIMIT 1`,
    )
    .get(ipAddress) as { blocked_until?: string } | undefined;
  if (!row?.blocked_until) return false;
  return new Date(row.blocked_until).getTime() > Date.now();
}

export function applyBuyAbuseProtection(params: { userId: number; ipAddress: string; fingerprintHash?: string | null }): {
  allow: boolean;
  message?: string;
} {
  const isLocalIp =
    params.ipAddress === "127.0.0.1" ||
    params.ipAddress === "::1" ||
    params.ipAddress.startsWith("::ffff:127.");
  if (isLocalIp) {
    return { allow: true };
  }

  if (isIpHardBlocked(params.ipAddress)) {
    return { allow: false, message: "Too many requests. Please wait." };
  }
  if (isUserSoftBlocked(params.userId)) {
    return { allow: false, message: "Temporarily blocked due to unusual activity." };
  }

  const userCount = sqliteClient
    .prepare(
      `SELECT COUNT(*) AS c FROM orders
       WHERE user_id = ?
         AND datetime(created_at) >= datetime('now', '-2 minutes')`,
    )
    .get(params.userId) as { c: number };
  if ((userCount?.c ?? 0) > 5) {
    const blockedUntil = new Date(Date.now() + 10 * 60 * 1000).toISOString();
    sqliteClient
      .prepare(
        `INSERT INTO abuse_blocks (scope, scope_id, blocked_until, reason, created_at)
         VALUES ('user', ?, ?, ?, ?)`,
      )
      .run(String(params.userId), blockedUntil, "sms_pumping_user", nowIso());
    recordAbuseEvent({
      userId: params.userId,
      ip: params.ipAddress,
      fingerprintHash: params.fingerprintHash ?? null,
      eventType: "sms_pumping_user_soft_block",
    });
    return { allow: false, message: "Temporarily blocked due to unusual activity." };
  }

  const ipCount = sqliteClient
    .prepare(
      `SELECT COUNT(*) AS c FROM orders
       WHERE created_at >= datetime('now', '-5 minutes')
         AND user_id IN (SELECT id FROM users)`,
    )
    .get() as { c: number };
  if ((ipCount?.c ?? 0) > 10) {
    const blockedUntil = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    sqliteClient
      .prepare(
        `INSERT INTO abuse_blocks (scope, scope_id, blocked_until, reason, created_at)
         VALUES ('ip', ?, ?, ?, ?)`,
      )
      .run(params.ipAddress, blockedUntil, "sms_pumping_ip_hard_block", nowIso());
    recordAbuseEvent({
      userId: params.userId,
      ip: params.ipAddress,
      fingerprintHash: params.fingerprintHash ?? null,
      eventType: "sms_pumping_ip_hard_block",
    });
    return { allow: false, message: "Too many requests. Please wait." };
  }

  return { allow: true };
}

export function trackApiKeyUse(apiKey: string, userId: number): { revoked: boolean } {
  sqliteClient
    .prepare(
      `INSERT INTO api_key_usage (api_key, user_id, used_at) VALUES (?, ?, ?)`,
    )
    .run(apiKey, userId, nowIso());
  const row = sqliteClient
    .prepare(
      `SELECT COUNT(*) AS c
       FROM api_key_usage
       WHERE api_key = ?
         AND datetime(used_at) >= datetime('now', '-5 minutes')`,
    )
    .get(apiKey) as { c: number };

  if ((row?.c ?? 0) > 200) {
    sqliteClient.prepare("UPDATE users SET api_key = NULL WHERE id = ?").run(userId);
    recordAbuseEvent({ userId, eventType: "api_key_auto_revoked", details: { requests5m: row.c } });
    return { revoked: true };
  }
  return { revoked: false };
}
