import { beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import express from "express";
import { createServer } from "http";
import request from "supertest";
import { rm } from "fs/promises";
import crypto from "crypto";
import { runFinancialReconciliation } from "../financial/reconciliation";
import { assertTransactionBalanced, isFinancialFreezeEnabled, setFinancialFreeze } from "../financial/core";
import { startCleanupJobs, stopCleanupJobs } from "../jobs/cleanup";
import { sqliteClient } from "../storage";

describe("financial hardening controls", () => {
  let app: express.Express;
  let storage: any;
  let failTellabot = false;
  let telegramCalls = 0;

  beforeAll(async () => {
    process.env.NODE_ENV = "test";
    process.env.SESSION_SECRET = "financial-hardening-test-secret";
    process.env.DATABASE_PATH = "./data.test.financial.db";
    process.env.TELLABOT_API_KEY = "tellabot-key";
    process.env.CIRCLE_API_KEY = "circle-key";
    process.env.CIRCLE_ENTITY_SECRET = "entity-secret";
    process.env.CIRCLE_WALLET_SET_ID = "wallet-set-id";
    process.env.CIRCLE_USDC_TOKEN_ADDRESS = "0xUSDC";
    process.env.CIRCLE_MASTER_WALLET_ADDRESS = "0xMASTER";
    process.env.CIRCLE_WALLET_BLOCKCHAIN = "ETH-SEPOLIA";
    process.env.CIRCLE_WEBHOOK_SECRET = "circle-webhook-secret";
    process.env.TELEGRAM_BOT_TOKEN = "bot-token";
    process.env.TELEGRAM_CHAT_ID = "chat-id";
    await rm("./data.test.financial.db", { force: true });

    global.fetch = vi.fn(async (input: string | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("api.telegram.org")) {
        telegramCalls += 1;
        return { ok: true, status: 200, json: async () => ({ ok: true }) } as Response;
      }
      if (url.includes("/developer/wallets")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ data: { wallets: [{ id: "w1", address: "0xUSER", blockchain: "ETH-SEPOLIA" }] } }),
        } as Response;
      }
      if (url.includes("/wallets/w1/balances")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ data: { tokenBalances: [{ token: { address: "0xUSDC" }, amount: "10.00" }] } }),
        } as Response;
      }
      if (url.includes("/developer/transactions/transfer")) {
        return { ok: true, status: 200, json: async () => ({ data: { id: "tx-ok" } }) } as Response;
      }
      if (url.includes("/transactions/tx-ok")) {
        return { ok: true, status: 200, json: async () => ({ data: { state: "COMPLETE" } }) } as Response;
      }
      if (url.includes("handler_api.php")) {
        if (url.includes("action=getNumber")) {
          if (failTellabot) {
            return { ok: true, status: 200, text: async () => "NO_NUMBERS" } as Response;
          }
          return { ok: true, status: 200, text: async () => "ACCESS_NUMBER:act-fin:15551234567" } as Response;
        }
        if (url.includes("action=getStatus")) {
          return { ok: true, status: 200, text: async () => "STATUS_OK:123456" } as Response;
        }
        if (url.includes("action=setStatus")) {
          return { ok: true, status: 200, text: async () => "ACCESS_CANCEL" } as Response;
        }
      }
      if (url.includes("api_command.php")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ status: "ok", message: [{ name: "WhatsApp", price: "0.80", otp_available: "100" }] }),
        } as Response;
      }
      return { ok: true, status: 200, json: async () => ({ ok: true }), text: async () => "OK" } as Response;
    }) as typeof fetch;

    const storageModule = await import("../storage");
    storage = storageModule.storage;
    await storage.upsertServices([
      { name: "WhatsApp", slug: "whatsapp", price: "0.80", icon: null, category: "Messaging", isActive: 1 },
    ]);

    app = express();
    app.use(
      express.json({
        verify: (req: any, _res, buf) => {
          req.rawBody = buf;
        },
      }),
    );
    app.use(express.urlencoded({ extended: false }));
    const { registerRoutes } = await import("../routes");
    await registerRoutes(createServer(app), app);
  });

  beforeEach(() => {
    failTellabot = false;
    telegramCalls = 0;
  });

  async function registerAndFund(balance = "100.00") {
    const agent = request.agent(app);
    const random = `${Date.now()}-${Math.floor(Math.random() * 10000)}`;
    const reg = await agent.post("/api/auth/register").send({
      username: `fin_${random}`,
      email: `fin-${random}@example.com`,
      password: "StrongPass123!",
    });
    const userId = reg.body.id as number;
    await storage.updateUserBalance(userId, balance);
    return { agent, userId };
  }

  test("concurrent buy-number allows only one success", async () => {
    const { agent, userId } = await registerAndFund("0.80");
    const [a, b] = await Promise.all([
      agent
        .post("/api/buy-number")
        .set("Origin", "http://localhost:5000")
        .set("Idempotency-Key", `conc-a-${Date.now()}`)
        .send({ service: "whatsapp" }),
      agent
        .post("/api/buy-number")
        .set("Origin", "http://localhost:5000")
        .set("Idempotency-Key", `conc-b-${Date.now()}`)
        .send({ service: "whatsapp" }),
    ]);
    const successCount = [a.status, b.status].filter((s) => s === 200).length;
    expect(successCount).toBeLessThanOrEqual(1);
    const user = await storage.getUser(userId);
    expect(Number.parseFloat(user.balance)).toBeGreaterThanOrEqual(0);
  });

  test("same idempotency key returns cached response without double charge", async () => {
    const { agent, userId } = await registerAndFund("100.00");
    const key = `idem-${Date.now()}`;
    const one = await agent
      .post("/api/buy-number")
      .set("Origin", "http://localhost:5000")
      .set("Idempotency-Key", key)
      .send({ service: "whatsapp" });
    const afterFirst = await storage.getUser(userId);
    const two = await agent
      .post("/api/buy-number")
      .set("Origin", "http://localhost:5000")
      .set("Idempotency-Key", key)
      .send({ service: "whatsapp" });
    expect(one.status).toBe(200);
    expect(two.status).toBe(200);
    expect(typeof two.body.orderId).toBe("number");
    const afterSecond = await storage.getUser(userId);
    expect(afterSecond.balance).toBe(afterFirst.balance);
  });

  test("webhook with wrong HMAC signature is rejected", async () => {
    const res = await request(app)
      .post("/api/webhooks/circle")
      .set("x-circle-webhook-id", "wh-bad-1")
      .set("x-circle-timestamp", `${Math.floor(Date.now() / 1000)}`)
      .set("x-circle-signature", "bad-signature")
      .send({ event: "deposit.confirmed" });
    expect(res.status).toBe(401);
  });

  test("webhook older than 300 seconds is rejected", async () => {
    const body = JSON.stringify({ event: "deposit.confirmed" });
    const ts = Math.floor(Date.now() / 1000) - 301;
    const sig = crypto.createHmac("sha256", "circle-webhook-secret").update(`${ts}.${body}`).digest("hex");
    const res = await request(app)
      .post("/api/webhooks/circle")
      .set("Content-Type", "application/json")
      .set("x-circle-webhook-id", "wh-old-1")
      .set("x-circle-timestamp", `${ts}`)
      .set("x-circle-signature", sig)
      .send(JSON.parse(body));
    expect(res.status).toBe(401);
  });

  test("duplicate webhook_id is ignored idempotently", async () => {
    const body = JSON.stringify({ event: "deposit.confirmed" });
    const ts = Math.floor(Date.now() / 1000);
    const sig = crypto.createHmac("sha256", "circle-webhook-secret").update(`${ts}.${body}`).digest("hex");
    const first = await request(app)
      .post("/api/webhooks/circle")
      .set("Content-Type", "application/json")
      .set("x-circle-webhook-id", "wh-dup-1")
      .set("x-circle-timestamp", `${ts}`)
      .set("x-circle-signature", sig)
      .send(JSON.parse(body));
    const second = await request(app)
      .post("/api/webhooks/circle")
      .set("Content-Type", "application/json")
      .set("x-circle-webhook-id", "wh-dup-1")
      .set("x-circle-timestamp", `${ts}`)
      .set("x-circle-signature", sig)
      .send(JSON.parse(body));
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(second.body.message).toContain("Duplicate");
  });

  test("tellabot failure mid-flow restores balance", async () => {
    const { agent, userId } = await registerAndFund("100.00");
    failTellabot = true;
    const res = await agent
      .post("/api/buy-number")
      .set("Origin", "http://localhost:5000")
      .set("Idempotency-Key", `fail-${Date.now()}`)
      .send({ service: "whatsapp" });
    expect(res.status).toBe(503);
    const user = await storage.getUser(userId);
    expect(user.balance).toBe("100.00");
  });

  test("successful buy transaction remains ledger-balanced", async () => {
    const { agent } = await registerAndFund("100.00");
    const res = await agent
      .post("/api/buy-number")
      .set("Idempotency-Key", `ledger-${Date.now()}`)
      .send({ service: "whatsapp" });
    expect(res.status).toBe(200);

    const row = sqliteClient.prepare("SELECT id FROM financial_transactions ORDER BY id DESC LIMIT 1").get() as {
      id: number;
    };
    expect(assertTransactionBalanced(row.id)).toBe(true);
  });

  test("reconciliation mismatch triggers freeze and alert behavior", async () => {
    sqliteClient.exec(
      "UPDATE users SET balance_cents = balance_cents + 2, balance = printf('%.2f', (balance_cents + 2)/100.0) WHERE id IN (SELECT id FROM users LIMIT 1)",
    );
    await runFinancialReconciliation();
    expect(isFinancialFreezeEnabled()).toBe(true);
  });

  test("cleanup job refunds stale pending order older than 10 minutes", async () => {
    setFinancialFreeze(false);
    const { userId } = await registerAndFund("0.00");
    await storage.createOrder({
      userId,
      serviceId: 1,
      serviceName: "WhatsApp",
      phoneNumber: "+15555550101",
      status: "waiting",
      otpCode: null,
      smsMessages: null,
      price: "0.80",
      tellabotRequestId: null,
      activationId: null,
      tellabotMdn: null,
      costPrice: null,
      createdAt: new Date(Date.now() - 11 * 60 * 1000).toISOString(),
      expiresAt: new Date(Date.now() - 1 * 60 * 1000).toISOString(),
      completedAt: null,
    });
    startCleanupJobs();
    await new Promise((resolve) => setTimeout(resolve, 300));
    stopCleanupJobs();
    const user = await storage.getUser(userId);
    expect(user.balance).toBe("0.80");
  });

  test("upgrade route remains available (compatibility)", async () => {
    const { agent } = await registerAndFund("100.00");
    const res = await agent
      .post("/api/upgrade")
      .set("Origin", "http://localhost:5000")
      .set("Idempotency-Key", `upg-${Date.now()}`)
      .send({ plan: "pro" });
    expect(res.status).not.toBe(404);
  });
});
