import { beforeAll, describe, expect, test } from "vitest";
import { rm } from "fs/promises";

describe("pending cleanup jobs", () => {
  let storage: any;

  beforeAll(async () => {
    process.env.NODE_ENV = "test";
    process.env.DATABASE_PATH = "./data.test.cleanup.db";
    await rm("./data.test.cleanup.db", { force: true });
    process.env.SESSION_SECRET = "cleanup-secret";
    process.env.ADMIN_PASSWORD = "StrongAdminPass123!";

    const storageModule = await import("../storage");
    storage = storageModule.storage;
  });

  test("expires stale waiting orders safely", async () => {
    const random = Date.now();
    const user = await storage.createUser({
      username: `cleanup_user_${random}`,
      email: `cleanup-${random}@example.com`,
      password: "hashed",
    });
    await storage.upsertServices([
      { name: "Telegram", slug: "telegram", price: "0.40", icon: null, category: "Messaging", isActive: 1 },
    ]);
    const service = await storage.getServiceBySlug("telegram");

    await storage.createOrder({
      userId: user.id,
      serviceId: service.id,
      serviceName: service.name,
      phoneNumber: "+15550002222",
      status: "waiting",
      otpCode: null,
      smsMessages: null,
      price: "0.40",
      tellabotRequestId: null,
      activationId: null,
      tellabotMdn: null,
      costPrice: null,
      createdAt: new Date(Date.now() - 40 * 60 * 1000).toISOString(),
      expiresAt: new Date(Date.now() - 20 * 60 * 1000).toISOString(),
      completedAt: null,
    });

    const changed = await storage.expireStaleOrders();
    expect(changed).toBeGreaterThanOrEqual(1);

    const orders = await storage.getUserOrders(user.id);
    expect(orders[0].status).toBe("expired");
  });
});
