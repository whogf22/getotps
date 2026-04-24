/**
 * Background worker: Tron deposit polling, order/deposit cleanup, financial reconciliation.
 * Run alongside the HTTP app in production (`npm run start:worker` or PM2).
 */
import "dotenv/config";
import { logger } from "./logger";
import { initFinancialSchema } from "./financial/core";
import { startTronPoller, stopTronPoller } from "./tronPoller";
import { startCleanupJobs, stopCleanupJobs } from "./jobs/cleanup";
import { startReconciliationJob, stopReconciliationJob } from "./financial/reconciliation";
import { closePool } from "./db";
import { closeRedis } from "./redis";

void (async () => {
  await initFinancialSchema();
  startTronPoller();
  startCleanupJobs();
  startReconciliationJob();
  logger.info("background_worker_started");

  let shuttingDown = false;
  const shutdown = (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, "worker_graceful_shutdown");
    stopCleanupJobs();
    stopTronPoller();
    stopReconciliationJob();
    void closePool()
      .catch((e) => logger.error({ err: e }, "pool_close"))
      .finally(() =>
        void closeRedis()
          .catch((e) => logger.error({ err: e }, "redis_close"))
          .finally(() => process.exit(0)),
      );
  };

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
})();
