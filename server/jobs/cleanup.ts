import { storage } from "../storage";
import { log } from "../index";

let cleanupInterval: ReturnType<typeof setInterval> | null = null;

export function startCleanupJobs(): void {
  const run = async () => {
    try {
      const expiredOrders = await storage.expireStaleOrders();
      if (expiredOrders > 0) {
        log(`Expired ${expiredOrders} stale order(s)`, "cleanup");
      }

      const expiredDeposits = storage.expireStalePendingDeposits();
      if (expiredDeposits > 0) {
        log(`Expired ${expiredDeposits} stale pending deposit(s)`, "cleanup");
      }
    } catch (error) {
      log(`Cleanup job failed: ${String(error)}`, "cleanup");
    }
  };

  // initial sweep + every 5 minutes
  void run();
  cleanupInterval = setInterval(() => {
    void run();
  }, 5 * 60 * 1000);
}

export function stopCleanupJobs(): void {
  if (cleanupInterval) {
    clearInterval(cleanupInterval);
    cleanupInterval = null;
  }
}
