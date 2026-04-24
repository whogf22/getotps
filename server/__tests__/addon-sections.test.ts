import { beforeAll, describe, expect, test } from "vitest";
import express from "express";
import { createServer } from "http";
import request from "supertest";
import { rm, writeFile } from "fs/promises";
import { assessRisk, computeFingerprintHash, recordLoginEvent } from "../abuse/risk";
import { sqliteClient } from "../storage";
import { applyBuyAbuseProtection, trackApiKeyUse } from "../abuse/engine";

describe("addon sections controls", () => {
  let app: express.Express;

  beforeAll(async () => {
    process.env.NODE_ENV = "test";
    process.env.SESSION_SECRET = "test-session-secret";
    process.env.DATABASE_PATH = "./data.test.addon.db";
    await rm("./data.test.addon.db", { force: true });
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

  test("VPN-style ASN elevates risk score", () => {
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
    const risk = assessRisk({
      email: "vpn@example.com",
      fingerprintHash: fp,
      ipAddress: "1.1.1.1",
      country: "US",
      asn: "cloud hosting provider",
    });
    expect(risk.score).toBeGreaterThanOrEqual(40);
  });

  test("same fingerprint across 3+ accounts triggers multi-account risk", () => {
    const fp = "fingerprint-shared";
    recordLoginEvent({
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
    recordLoginEvent({
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
    recordLoginEvent({
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
    const risk = assessRisk({
      userId: 3,
      email: "c@a.com",
      fingerprintHash: fp,
      ipAddress: "1.1.1.3",
      country: "US",
      asn: "isp",
    });
    expect(risk.score).toBeGreaterThanOrEqual(50);
  });

  test("rapid buy detection creates soft block", () => {
    const userId = 9999;
    for (let i = 0; i < 6; i += 1) {
      sqliteClient
        .prepare(
          "INSERT INTO orders (user_id, service_id, service_name, phone_number, status, price, created_at, expires_at) VALUES (?, 1, 'x', '+1000', 'completed', '0.10', datetime('now'), datetime('now', '+20 minutes'))",
        )
        .run(userId);
    }
    const gate = applyBuyAbuseProtection({ userId, ipAddress: "2.2.2.2", fingerprintHash: "fp-user" });
    expect(gate.allow).toBe(false);
  });

  test("API key 201 requests in 5m auto-revokes", () => {
    sqliteClient
      .prepare("INSERT OR REPLACE INTO users (id, username, email, password, balance, role, api_key) VALUES (777, 'u777', 'u777@example.com', 'x', '0.00', 'user', 'k777')")
      .run();
    for (let i = 0; i < 201; i += 1) trackApiKeyUse("k777", 777);
    const row = sqliteClient.prepare("SELECT api_key FROM users WHERE id = 777").get() as { api_key: string | null };
    expect(row.api_key).toBeNull();
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
