import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import express from "express";
import { createServer } from "http";
import request from "supertest";
import speakeasy from "speakeasy";
import { pool } from "../db";

describe("admin TOTP 2FA", () => {
  let app: express.Express;
  const adminEmail = process.env.ADMIN_EMAIL || "admin@getotps.com";
  const adminPassword = process.env.ADMIN_PASSWORD || "StrongAdminPass123!";

  beforeAll(async () => {
    process.env.NODE_ENV = "test";
    process.env.SESSION_SECRET = "admin-2fa-test-session";
    process.env.JWT_SECRET = "admin-2fa-test-jwt";
    process.env.ADMIN_PASSWORD = adminPassword;
    process.env.ADMIN_EMAIL = adminEmail;
    process.env.TELLABOT_API_KEY = "test";
    process.env.TELLABOT_USER = "test@example.com";

    await pool.query(
      `UPDATE users SET admin_totp_secret = NULL, admin_totp_enabled = FALSE WHERE email = $1`,
      [adminEmail],
    );

    global.fetch = vi.fn(async () =>
      ({
        ok: true,
        status: 200,
        text: async () => "STATUS_WAIT_CODE",
        json: async () => ({ status: "ok", message: [] }),
      }) as Response,
    ) as typeof fetch;

    app = express();
    app.use(express.json());
    app.use(express.urlencoded({ extended: false }));
    const { registerRoutes } = await import("../routes");
    await registerRoutes(createServer(app), app);

    for (let i = 0; i < 50; i++) {
      const r = await pool.query<{ id: string }>("SELECT id FROM users WHERE email = $1 LIMIT 1", [adminEmail]);
      if (r.rows[0]) break;
      await new Promise((resolve) => setTimeout(resolve, 100));
      if (i === 49) throw new Error(`Admin user ${adminEmail} not seeded`);
    }
  });

  afterAll(async () => {
    await pool.query(
      `UPDATE users SET admin_totp_secret = NULL, admin_totp_enabled = FALSE WHERE email = $1`,
      [adminEmail],
    );
  });

  test("setup → verify enables; stats requires TOTP; header unlocks; disable clears", async () => {
    const agent = request.agent(app);

    const login = await agent.post("/api/auth/login").send({
      email: adminEmail,
      password: adminPassword,
    });
    expect(login.status).toBe(200);

    const setup = await agent.post("/api/admin/2fa/setup").send({});
    expect(setup.status).toBe(200);
    const { otpauthUrl } = setup.body as { otpauthUrl: string };
    expect(otpauthUrl).toContain("otpauth://");
    const secretMatch = otpauthUrl.match(/secret=([^&]+)/);
    expect(secretMatch).toBeTruthy();
    const secretBase32 = decodeURIComponent(secretMatch![1]!);
    const token = speakeasy.totp({ secret: secretBase32, encoding: "base32" });

    const verify = await agent.post("/api/admin/2fa/verify").send({ token });
    expect(verify.status).toBe(200);

    const blocked = await agent.get("/api/admin/stats");
    expect(blocked.status).toBe(403);
    expect(blocked.body.code).toBe("ADMIN_TOTP_REQUIRED");

    const ok = await agent.get("/api/admin/stats").set("x-admin-totp", token);
    expect(ok.status).toBe(200);

    const disable = await agent.post("/api/admin/2fa/disable").send({ token });
    expect(disable.status).toBe(200);

    const after = await agent.get("/api/admin/stats");
    expect(after.status).toBe(200);
  });

  test("admin login requires totpCode when 2FA enabled", async () => {
    await pool.query(
      `UPDATE users SET admin_totp_secret = NULL, admin_totp_enabled = FALSE WHERE email = $1`,
      [adminEmail],
    );

    const agent = request.agent(app);
    let login = await agent.post("/api/auth/login").send({
      email: adminEmail,
      password: adminPassword,
    });
    expect(login.status).toBe(200);

    const setup = await agent.post("/api/admin/2fa/setup").send({});
    expect(setup.status).toBe(200);
    const otpauthUrl = (setup.body as { otpauthUrl: string }).otpauthUrl;
    const secretBase32 = decodeURIComponent(otpauthUrl.match(/secret=([^&]+)/)![1]!);
    const token = speakeasy.totp({ secret: secretBase32, encoding: "base32" });
    await agent.post("/api/admin/2fa/verify").send({ token });

    await agent.post("/api/auth/logout").send({});

    login = await agent.post("/api/auth/login").send({
      email: adminEmail,
      password: adminPassword,
    });
    expect(login.status).toBe(401);

    const login2 = await agent.post("/api/auth/login").send({
      email: adminEmail,
      password: adminPassword,
      totpCode: token,
    });
    expect(login2.status).toBe(200);

    await agent.post("/api/admin/2fa/disable").send({ token });
    await pool.query(
      `UPDATE users SET admin_totp_secret = NULL, admin_totp_enabled = FALSE WHERE email = $1`,
      [adminEmail],
    );
  });
});
