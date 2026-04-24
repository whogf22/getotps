import { storage } from "../storage";
import { pool } from "../db";
import { creditUser, parseAmountToCents } from "../financial/operations";
import { sendFinancialAlert } from "../financial/alerts";

let cleanupInterval: ReturnType<typeof setInterval> | null = null;
const log = (message: string, source = "cleanup") => {
  console.log(`${new Date().toISOString()} [${source}] ${message}`);
};

export function startCleanupJobs(): void {
  const run = async () => {
    try {
      const staleRes = await pool.query<{
        id: number;
        user_id: number;
        price: string;
        status: string;
        created_at: string;
      }>(
        `SELECT id, user_id, price, status, created_at
         FROM orders
         WHERE status IN ('waiting', 'received')
           AND created_at::timestamptz < now() - interval '10 minutes'`,
      );
      for (const order of staleRes.rows) {
        await pool.query("UPDATE orders SET status = 'failed', completed_at = $1 WHERE id = $2", [
          new Date().toISOString(),
          order.id,
        ]);
        await creditUser({
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

      const expiredDeposits = await storage.expireStalePendingDeposits();
      if (expiredDeposits > 0) {
        log(`Expired ${expiredDeposits} stale pending deposit(s)`, "cleanup");
      }

      const longPending = await pool.query<{ id: number; user_id: number; status: string; created_at: string }>(
        `SELECT id, user_id, status, created_at
         FROM orders
         WHERE status IN ('waiting', 'received', 'pending')
           AND created_at::timestamptz < now() - interval '30 minutes'`,
      );
      if (longPending.rows.length > 0) {
        await sendFinancialAlert("critical", "stuck_pending_transactions", {
          count: longPending.rows.length,
          orderIds: longPending.rows.map((o: { id: number }) => o.id),
        });
      }

      await pool.query(
        `UPDATE support_tickets
         SET status = 'resolved', resolved_at = $1
         WHERE status IN ('open', 'in_progress')
           AND updated_at::timestamptz < now() - interval '7 days'`,
        [new Date().toISOString()],
      );

      const winBackCandidates = await pool.query<{ id: number }>(
        `SELECT u.id
         FROM users u
         WHERE EXISTS (
           SELECT 1 FROM orders o WHERE o.user_id = u.id AND o.created_at::timestamptz >= now() - interval '90 days'
         )
         AND NOT EXISTS (
           SELECT 1 FROM orders o2 WHERE o2.user_id = u.id AND o2.created_at::timestamptz >= now() - interval '14 days'
         )
         AND (
           u.win_back_sent_at IS NULL OR u.win_back_sent_at < now() - interval '30 days'
         )
         LIMIT 100`,
      );
      const now = new Date().toISOString();
      for (const c of winBackCandidates.rows) {
        await pool.query("UPDATE users SET win_back_sent_at = $1 WHERE id = $2", [now, c.id]);
        await pool.query("INSERT INTO win_back_events (user_id, sent_at, bonus_cents) VALUES ($1, $2, $3)", [
          c.id,
          now,
          Number(process.env.WINBACK_CREDIT_CENTS || 50),
        ]);
      }
    } catch (error) {
      log(`Cleanup job failed: ${String(error)}`, "cleanup");
      await sendFinancialAlert("critical", "cleanup_job_failure", { reason: String(error) });
    }
  };

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
