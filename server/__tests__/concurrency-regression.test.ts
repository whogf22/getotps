import { beforeAll, describe, expect, test } from "vitest";
import type { InsertService } from "@shared/schema";
import { debitUserForPurchase } from "../financial/operations";

describe("advisory lock regressions", () => {
  let storage: typeof import("../storage").storage;

  beforeAll(async () => {
    process.env.NODE_ENV = "test";
    const mod = await import("../storage");
    storage = mod.storage;
  });

  test("parallel upsertServices with same slug set completes without error", async () => {
    const slug = `lock-test-${Date.now()}`;
    const row: InsertService = {
      name: "LockTestSvc",
      slug,
      price: "1.00",
      icon: null,
      category: "Test",
      isActive: 1,
    };
    await Promise.all(Array.from({ length: 12 }, () => storage.upsertServices([{ ...row }])));
    const list = await storage.getAllServices();
    const found = list.filter((s) => s.slug === slug);
    expect(found.length).toBe(1);
    expect(found[0]?.price).toBe("1.00");
  });

  test("parallel debitUserForPurchase serializes per user (no negative balance)", async () => {
    const u = await storage.createUser({
      username: `deb_${Date.now()}`,
      email: `deb-${Date.now()}@example.com`,
      password: "hashed-placeholder",
    });
    await storage.updateUserBalance(u.id, "3.00");

    const base = Date.now();
    const attempts = await Promise.all(
      [0, 1, 2, 3].map(async (i) => {
        try {
          return await debitUserForPurchase({
            userId: u.id,
            amountCents: 100,
            idempotencyKey: `conc-debit-${base}-${i}`,
            type: "concurrency_test_debit",
            metadata: { i },
          });
        } catch {
          return null;
        }
      }),
    );

    const successes = attempts.filter((a) => a !== null);
    expect(successes.length).toBe(3);

    const fresh = await storage.getUser(u.id);
    expect(fresh?.balanceCents).toBe(0);
  });
});
