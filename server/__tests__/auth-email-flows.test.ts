import { beforeAll, describe, expect, test } from "vitest";
import express from "express";
import { createServer } from "http";
import request from "supertest";
import { testEmailCapture } from "../email";

describe("email verification and password reset", () => {
  let app: express.Express;

  beforeAll(async () => {
    process.env.NODE_ENV = "test";
    process.env.SESSION_SECRET = "auth-email-flows-session";
    process.env.JWT_SECRET = "auth-email-flows-jwt";
    process.env.ADMIN_PASSWORD = "StrongAdminPass123!";
    process.env.TELLABOT_API_KEY = "test";
    process.env.TELLABOT_USER = "test@example.com";
    process.env.CRYPTO_WALLET_BTC = "bc1qtestwalletaddress000000000000000000";

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

  test("verify-email rejects bad token", async () => {
    const res = await request(app).post("/api/auth/verify-email").send({ token: "not-a-jwt" });
    expect(res.status).toBe(400);
  });

  test("register sends JWT; verify-email enables account; deposit gated until verified", async () => {
    const agent = request.agent(app);
    const n = Date.now();
    const email = `verify-flow-${n}@example.com`;
    const reg = await agent.post("/api/auth/register").send({
      username: `verify_flow_${n}`,
      email,
      password: "StrongPass123!",
    });
    expect(reg.status).toBe(200);
    expect(reg.body.emailVerified).toBe(false);

    const token = testEmailCapture.lastVerifyJwt;
    expect(token.length).toBeGreaterThan(20);

    const depBefore = await agent.post("/api/crypto/create-deposit").send({ currency: "BTC", amount: "10" });
    expect(depBefore.status).toBe(403);

    const ver = await request(app).post("/api/auth/verify-email").send({ token });
    expect(ver.status).toBe(200);

    const me = await agent.get("/api/auth/me");
    expect(me.status).toBe(200);
    expect(me.body.emailVerified).toBe(true);

    const depAfter = await agent.post("/api/crypto/create-deposit").send({ currency: "BTC", amount: "10" });
    expect(depAfter.status).toBe(200);
    expect(depAfter.body.status).toBe("pending");
  });

  test("resend-verification is rate limited to once per minute", async () => {
    const agent = request.agent(app);
    const n = Date.now() + 1;
    await agent.post("/api/auth/register").send({
      username: `resend_${n}`,
      email: `resend-${n}@example.com`,
      password: "StrongPass123!",
    });
    const a = await agent.post("/api/auth/resend-verification");
    expect(a.status).toBe(200);
    const b = await agent.post("/api/auth/resend-verification");
    expect(b.status).toBe(429);
  });

  test("forgot-password + reset-password", async () => {
    const agent = request.agent(app);
    const n = Date.now() + 2;
    const email = `reset-${n}@example.com`;
    await agent.post("/api/auth/register").send({
      username: `reset_user_${n}`,
      email,
      password: "OriginalPass123!",
    });

    const forgot = await request(app).post("/api/auth/forgot-password").send({ email });
    expect(forgot.status).toBe(200);
    expect(forgot.body.message).toMatch(/account exists/i);

    const tok = testEmailCapture.lastResetToken;
    expect(tok).toContain("|");

    const bad = await request(app)
      .post("/api/auth/reset-password")
      .send({ token: "1|badhexnotvalid", password: "NewPass999!" });
    expect(bad.status).toBe(400);

    const ok = await request(app)
      .post("/api/auth/reset-password")
      .send({ token: tok, password: "NewPass999!" });
    expect(ok.status).toBe(200);

    const login = await agent.post("/api/auth/login").send({ email, password: "NewPass999!" });
    expect(login.status).toBe(200);
  });
});
