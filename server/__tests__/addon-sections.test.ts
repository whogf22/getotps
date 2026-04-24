import { beforeAll, describe, expect, test } from "vitest";
import express from "express";
import { createServer } from "http";
import request from "supertest";
import { writeFile } from "fs/promises";
import { assessRisk, computeFingerprintHash, recordLoginEvent } from "../abuse/risk";
import { pool } from "../db";
import { applyBuyAbuseProtection, trackApiKeyUse } from "../abuse/engine";

describe("addon sections controls", () => {
  let app: express.Express;

  beforeAll(async () => {
    process.env.NODE_ENV = "test";
    process.env.SESSION_SECRET = "test-session-secret";
    await writeFile(
      "./VERSION",
      JSON.stringify({ version: "testhash", built_at: new Date().toISOString(), branch: "test" }),
      "utf-8",
    );

    process.env.TELLABOT_API_KEY = "test";
    process.env.TELLABOT_USER = "test@example.com";
    global.fetch = (async () =>
      ({
        ok: true,
        status: 200,
        text: async () => "STATUS_WAIT_CODE",
        json: async () => ({ status: "ok", message: [] }),
      }) as Response) as typeof fetch;

    app = express();
    app.use(express.json());
    app.use(express.urlencoded({ extended: false }));
    const { registerRoutes } = await import("../routes");
    await registerRoutes(createServer(app), app);
  });

  test("VPN-style ASN elevates risk score", async () => {
    const fp = computeFingerprintHash({
      userAgent: "ua",
      acceptLanguage: "en",
      screenResolution: "1920x1080",
      timezoneOffset: "0",
      canvasHash: "abc",
      ipAddress: "1.1.1.1",
      asn: "cloud hosting provider",
      country: "US",
    });
    const risk = await assessRisk({
      email: "vpn@example.com",
      fingerprintHash: fp,
      ipAddress: "1.1.1.1",
      country: "US",
      asn: "cloud hosting provider",
    });
    expect(risk.score).toBeGreaterThanOrEqual(40);
  });

  test("same fingerprint across 3+ accounts triggers multi-account risk", async () => {
    const fp = `fingerprint-shared-${Date.now()}`;
    await recordLoginEvent({
      userId: 1,
      email: "a@a.com",
      eventType: "login_success",
      fingerprintHash: fp,
      ipAddress: "1.1.1.1",
      asn: "isp",
      country: "US",
      riskScore: 0,
      reasons: [],
    });
    await recordLoginEvent({
      userId: 2,
      email: "b@a.com",
      eventType: "login_success",
      fingerprintHash: fp,
      ipAddress: "1.1.1.2",
      asn: "isp",
      country: "US",
      riskScore: 0,
      reasons: [],
    });
    await recordLoginEvent({
      userId: 3,
      email: "c@a.com",
      eventType: "login_success",
      fingerprintHash: fp,
      ipAddress: "1.1.1.3",
      asn: "isp",
      country: "US",
      riskScore: 0,
      reasons: [],
    });
    const risk = await assessRisk({
      userId: 3,
      email: "c@a.com",
      fingerprintHash: fp,
      ipAddress: "1.1.1.3",
      country: "US",
      asn: "isp",
    });
    expect(risk.score).toBeGreaterThanOrEqual(50);
    await pool.query("DELETE FROM login_events WHERE fingerprint_hash = $1", [fp]);
  });

  test("rapid buy detection creates soft block", async () => {
    const userId = 9999;
    await pool.query("DELETE FROM orders WHERE user_id = $1", [userId]);
    const now = new Date().toISOString();
    const exp = new Date(Date.now() + 20 * 60 * 1000).toISOString();
    for (let i = 0; i < 6; i += 1) {
      await pool.query(
        `INSERT INTO orders (
           user_id, service_id, service_name, phone_number, status, otp_code, sms_messages,
           price, tellabot_request_id, activation_id, tellabot_mdn, cost_price, created_at, expires_at, completed_at
         ) VALUES ($1, 1, 'x', '+1000', 'completed', null, null, '0.10', null, null, null, null, $2, $3, null)`,
        [userId, now, exp],
      );
    }
    const gate = await applyBuyAbuseProtection({ userId, ipAddress: "2.2.2.2", fingerprintHash: "fp-user" });
    expect(gate.allow).toBe(false);
    await pool.query("DELETE FROM orders WHERE user_id = $1", [userId]);
    await pool.query("DELETE FROM abuse_blocks WHERE scope = 'user' AND scope_id = $1", [String(userId)]);
  });

  test("API key 201 requests in 5m auto-revokes", async () => {
    await pool.query("DELETE FROM api_key_usage WHERE user_id = $1", [777]);
    await pool.query("DELETE FROM users WHERE id = $1", [777]);
    const refCode = `r${Date.now().toString(36)}`.slice(0, 12);
    await pool.query(
      `INSERT INTO users (
         id, username, email, password, balance, balance_cents, role, api_key,
         email_verified, annual_badge, admin_totp_enabled, banned, referral_code
       ) VALUES (
         777, 'u777', 'u777@example.com', 'x', '0.00', 0, 'user', 'k777',
         true, false, false, false, $1
       )`,
      [refCode],
    );
    for (let i = 0; i < 201; i += 1) await trackApiKeyUse("k777", 777);
    const row = await pool.query<{ api_key: string | null }>("SELECT api_key FROM users WHERE id = 777");
    expect(row.rows[0]?.api_key).toBeNull();
    await pool.query("DELETE FROM api_key_usage WHERE user_id = $1", [777]);
    await pool.query("DELETE FROM users WHERE id = $1", [777]);
  });

  test("version + health endpoints are available and scrubbed", async () => {
    const version = await request(app).get("/api/version");
    expect(version.status).toBe(200);
    expect(version.body.version).toBeTruthy();

    const health = await request(app).get("/healthz");
    expect(health.status).toBe(200);
    expect(health.body.status).toBe("ok");
    expect(String(version.text).toLowerCase()).not.toContain("tellabot");
    expect(String(version.text).toLowerCase()).not.toContain("circle-fin");
  });
});
