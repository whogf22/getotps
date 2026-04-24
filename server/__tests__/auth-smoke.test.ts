import { beforeAll, describe, expect, test } from "vitest";
import express from "express";
import { createServer } from "http";
import request from "supertest";

describe("auth flow smoke", () => {
  let app: express.Express;

  beforeAll(async () => {
    process.env.NODE_ENV = "test";
    process.env.SESSION_SECRET = "test-session-secret";
    process.env.JWT_SECRET = "test-jwt-secret";
    process.env.ADMIN_PASSWORD = "StrongAdminPass123!";

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

  test("register + session + auth me", async () => {
    const agent = request.agent(app);
    const random = Date.now();
    const registerRes = await agent.post("/api/auth/register").send({
      username: `smoke_auth_user_${random}`,
      email: `smoke-auth-${random}@example.com`,
      password: "StrongPass123!",
    });
    expect(registerRes.status).toBe(200);
    expect(registerRes.body.email).toBe(`smoke-auth-${random}@example.com`);

    const meRes = await agent.get("/api/auth/me");
    expect(meRes.status).toBe(200);
    expect(meRes.body.username).toBe(`smoke_auth_user_${random}`);
  });
});
