import { storage } from "../storage";
import { sqliteClient } from "../storage";
import { creditUser, parseAmountToCents } from "../financial/operations";
import { sendFinancialAlert } from "../financial/alerts";

let cleanupInterval: ReturnType<typeof setInterval> | null = null;
const log = (message: string, source = "cleanup") => {
  console.log(`${new Date().toISOString()} [${source}] ${message}`);
};

export function startCleanupJobs(): void {
  const run = async () => {
    try {
      const staleOrders = sqliteClient
        .prepare(
          `SELECT id, user_id, price, status, created_at
           FROM orders
           WHERE status IN ('waiting', 'received')
             AND datetime(created_at) < datetime('now', '-10 minutes')`,
        )
        .all() as Array<{ id: number; user_id: number; price: string; status: string; created_at: string }>;
      for (const order of staleOrders) {
        sqliteClient
          .prepare("UPDATE orders SET status = 'failed', completed_at = ? WHERE id = ?")
          .run(new Date().toISOString(), order.id);
        creditUser({
          userId: order.user_id,
          amountCents: parseAmountToCents(order.price),
          idempotencyKey: `cleanup-refund:${order.id}`,
          type: "order_timeout_refund",
          metadata: { orderId: order.id, reason: "timeout_cleanup" },
        });
      }

      const expiredOrders = await storage.expireStaleOrders();
      if (expiredOrders > 0) {
        log(`Expired ${expiredOrders} stale order(s)`, "cleanup");
      }

      const expiredDeposits = storage.expireStalePendingDeposits();
      if (expiredDeposits > 0) {
        log(`Expired ${expiredDeposits} stale pending deposit(s)`, "cleanup");
      }

      const longPending = sqliteClient
        .prepare(
          `SELECT id, user_id, status, created_at
           FROM orders
           WHERE status IN ('waiting', 'received', 'pending')
             AND datetime(created_at) < datetime('now', '-30 minutes')`,
        )
        .all() as Array<{ id: number; user_id: number; status: string; created_at: string }>;
      if (longPending.length > 0) {
        await sendFinancialAlert("critical", "stuck_pending_transactions", {
          count: longPending.length,
          orderIds: longPending.map((o) => o.id),
        });
      }
    } catch (error) {
      log(`Cleanup job failed: ${String(error)}`, "cleanup");
      await sendFinancialAlert("critical", "cleanup_job_failure", { reason: String(error) });
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
