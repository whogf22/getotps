import { beforeAll, describe, expect, test, vi } from "vitest";
import express from "express";
import { createServer } from "http";
import request from "supertest";
import { rm } from "fs/promises";

describe("otp lifecycle with mocked tellabot/circle", () => {
  let app: express.Express;
  let storage: any;

  beforeAll(async () => {
    process.env.NODE_ENV = "test";
    process.env.SESSION_SECRET = "test-session-secret";
    process.env.DATABASE_PATH = "./data.test.otp.db";
    process.env.TELLABOT_API_KEY = "test-key";
    process.env.CIRCLE_API_KEY = "circle-key";
    process.env.CIRCLE_ENTITY_SECRET = "entity-secret";
    process.env.CIRCLE_WALLET_SET_ID = "wallet-set-id";
    process.env.CIRCLE_USDC_TOKEN_ADDRESS = "0xUSDC";
    process.env.CIRCLE_MASTER_WALLET_ADDRESS = "0xMASTER";
    process.env.CIRCLE_WALLET_BLOCKCHAIN = "ETH-SEPOLIA";
    await rm("./data.test.otp.db", { force: true });

    const fetchMock = vi.fn(async (input: string | URL) => {
      const url = String(input);

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
        return { ok: true, status: 200, json: async () => ({ data: { id: "tx-1" } }) } as Response;
      }

      if (url.includes("/transactions/tx-1")) {
        return { ok: true, status: 200, json: async () => ({ data: { state: "COMPLETE" } }) } as Response;
      }

      if (url.includes("handler_api.php")) {
        if (url.includes("action=getNumber")) {
          return { ok: true, status: 200, text: async () => "ACCESS_NUMBER:act-1:15550001111" } as Response;
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
          json: async () => ({
            status: "ok",
            message: [{ name: "WhatsApp", price: "0.30", otp_available: "100" }],
          }),
        } as Response;
      }

      return { ok: true, status: 200, json: async () => ({ status: "ok", message: [] }), text: async () => "OK" } as Response;
    });

    global.fetch = fetchMock as unknown as typeof fetch;

    const storageModule = await import("../storage");
    storage = storageModule.storage;
    await storage.upsertServices([
      { name: "WhatsApp", slug: "whatsapp", price: "0.50", icon: null, category: "Messaging", isActive: 1 },
    ]);

    app = express();
    app.use(express.json());
    app.use(express.urlencoded({ extended: false }));
    const { registerRoutes } = await import("../routes");
    await registerRoutes(createServer(app), app);
  });

  test("buy number and fetch sms code", async () => {
    const agent = request.agent(app);
    const random = Date.now();

    await agent.post("/api/auth/register").send({
      username: `otp_user_${random}`,
      email: `otp-user-${random}@example.com`,
      password: "StrongPass123!",
    });

    const buy = await agent.post("/api/buy-number").send({ service: "whatsapp" });
    expect(buy.status).toBe(200);
    expect(buy.body.phoneNumber).toContain("15550001111");
    expect(buy.body.orderId).toBeTypeOf("number");

    const check = await agent.get(`/api/check-sms/${buy.body.orderId}`);
    expect(check.status).toBe(200);
    expect(check.body.code).toBe("123456");
    expect(check.body.refunded).toBe(false);
  });
});
