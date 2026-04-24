import { pool } from "../db";

function nowIso(): string {
  return new Date().toISOString();
}

export async function recordAbuseEvent(params: {
  userId?: number | null;
  ip?: string | null;
  fingerprintHash?: string | null;
  eventType: string;
  details?: Record<string, unknown>;
}): Promise<void> {
  await pool.query(
    `INSERT INTO abuse_events (user_id, ip_address, fingerprint_hash, event_type, details, created_at)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [
      params.userId ?? null,
      params.ip ?? null,
      params.fingerprintHash ?? null,
      params.eventType,
      JSON.stringify(params.details ?? {}),
      nowIso(),
    ],
  );
}

export async function isUserSoftBlocked(userId: number): Promise<boolean> {
  const r = await pool.query<{ blocked_until: string }>(
    `SELECT blocked_until FROM abuse_blocks
     WHERE scope = 'user' AND scope_id = $1
     ORDER BY id DESC LIMIT 1`,
    [String(userId)],
  );
  const row = r.rows[0];
  if (!row?.blocked_until) return false;
  return new Date(row.blocked_until).getTime() > Date.now();
}

export async function isIpHardBlocked(ipAddress: string): Promise<boolean> {
  const r = await pool.query<{ blocked_until: string }>(
    `SELECT blocked_until FROM abuse_blocks
     WHERE scope = 'ip' AND scope_id = $1
     ORDER BY id DESC LIMIT 1`,
    [ipAddress],
  );
  const row = r.rows[0];
  if (!row?.blocked_until) return false;
  return new Date(row.blocked_until).getTime() > Date.now();
}

export async function applyBuyAbuseProtection(params: {
  userId: number;
  ipAddress: string;
  fingerprintHash?: string | null;
}): Promise<{
  allow: boolean;
  message?: string;
}> {
  const isLocalIp =
    params.ipAddress === "127.0.0.1" ||
    params.ipAddress === "::1" ||
    params.ipAddress.startsWith("::ffff:127.");
  if (isLocalIp) {
    return { allow: true };
  }

  if (await isIpHardBlocked(params.ipAddress)) {
    return { allow: false, message: "Too many requests. Please wait." };
  }
  if (await isUserSoftBlocked(params.userId)) {
    return { allow: false, message: "Temporarily blocked due to unusual activity." };
  }

  const userCount = await pool.query<{ c: string }>(
    `SELECT COUNT(*)::text AS c FROM orders
     WHERE user_id = $1
       AND created_at::timestamptz >= now() - interval '2 minutes'`,
    [params.userId],
  );
  if (Number(userCount.rows[0]?.c ?? 0) > 5) {
    const blockedUntil = new Date(Date.now() + 10 * 60 * 1000).toISOString();
    await pool.query(
      `INSERT INTO abuse_blocks (scope, scope_id, blocked_until, reason, created_at)
       VALUES ('user', $1, $2, $3, $4)`,
      [String(params.userId), blockedUntil, "sms_pumping_user", nowIso()],
    );
    await recordAbuseEvent({
      userId: params.userId,
      ip: params.ipAddress,
      fingerprintHash: params.fingerprintHash ?? null,
      eventType: "sms_pumping_user_soft_block",
    });
    return { allow: false, message: "Temporarily blocked due to unusual activity." };
  }

  const ipCount = await pool.query<{ c: string }>(
    `SELECT COUNT(*)::text AS c FROM orders
     WHERE created_at::timestamptz >= now() - interval '5 minutes'`,
  );
  if (Number(ipCount.rows[0]?.c ?? 0) > 10) {
    const blockedUntil = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    await pool.query(
      `INSERT INTO abuse_blocks (scope, scope_id, blocked_until, reason, created_at)
       VALUES ('ip', $1, $2, $3, $4)`,
      [params.ipAddress, blockedUntil, "sms_pumping_ip_hard_block", nowIso()],
    );
    await recordAbuseEvent({
      userId: params.userId,
      ip: params.ipAddress,
      fingerprintHash: params.fingerprintHash ?? null,
      eventType: "sms_pumping_ip_hard_block",
    });
    return { allow: false, message: "Too many requests. Please wait." };
  }

  return { allow: true };
}

export async function trackApiKeyUse(apiKey: string, userId: number): Promise<{ revoked: boolean }> {
  const usedAt = nowIso();
  await pool.query(`INSERT INTO api_key_usage (api_key, user_id, used_at) VALUES ($1, $2, $3)`, [apiKey, userId, usedAt]);
  const row = await pool.query<{ c: string }>(
    `SELECT COUNT(*)::text AS c
     FROM api_key_usage
     WHERE api_key = $1
       AND used_at::timestamptz >= now() - interval '5 minutes'`,
    [apiKey],
  );
  const c = Number(row.rows[0]?.c ?? 0);
  if (c > 200) {
    await pool.query("UPDATE users SET api_key = NULL WHERE id = $1", [userId]);
    await recordAbuseEvent({ userId, eventType: "api_key_auto_revoked", details: { requests5m: c } });
    return { revoked: true };
  }
  return { revoked: false };
}
