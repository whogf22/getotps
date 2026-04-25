/**
 * Provider health & balance poller.
 *
 *   health   — every 60s for every enabled provider
 *   balance  — every 5min for every enabled provider (rate-limit friendlier)
 *
 * Updates the `providers` table with `last_health_at`, `last_balance_cents`,
 * `last_error`. The router consults the in-mem circuit breaker on every call,
 * so the health poller is not on the critical path; it just gives operators
 * an "at-a-glance" health board and ensures stale providers eventually
 * recover their `last_balance_cents` after a transient outage.
 */

import { logger } from "../logger";
import { pool } from "../db";
import { listKnownProviders, refreshProviderHealthWithOptions, seedProviders } from "../providers";

const HEALTH_INTERVAL_MS = 60_000;
const BALANCE_INTERVAL_MS = 5 * 60_000;

let healthTimer: ReturnType<typeof setInterval> | null = null;
let balanceTimer: ReturnType<typeof setInterval> | null = null;

async function runOnce(intent: "health" | "balance"): Promise<void> {
  const known = listKnownProviders();
  let enabled = new Set<string>(["tellabot"]);
  try {
    const r = await pool.query<{ slug: string }>("SELECT slug FROM providers WHERE enabled = true");
    if (r.rows.length > 0) enabled = new Set(r.rows.map((x) => x.slug));
  } catch {
    // keep tellabot default
  }

  for (const impl of known) {
    if (!enabled.has(impl.slug)) continue;
    try {
      const r = await refreshProviderHealthWithOptions(impl, { includeBalance: intent === "balance" });
      logger.info(
        {
          provider: impl.slug,
          intent,
          ok: r.ok,
          balanceCents: r.balanceCents,
          error: r.error,
        },
        "provider_health_tick",
      );
    } catch (err) {
      logger.warn({ provider: impl.slug, err: (err as Error).message }, "provider_health_tick_failed");
    }
  }
}

export async function startProviderHealthPoller(): Promise<void> {
  await seedProviders().catch((err) => logger.warn({ err: (err as Error).message }, "provider_seed_failed"));

  // Kick off one immediate run (don't await — background only).
  void runOnce("health").catch(() => {});

  healthTimer = setInterval(() => {
    void runOnce("health").catch(() => {});
  }, HEALTH_INTERVAL_MS);
  balanceTimer = setInterval(() => {
    void runOnce("balance").catch(() => {});
  }, BALANCE_INTERVAL_MS);

  logger.info(
    { healthIntervalMs: HEALTH_INTERVAL_MS, balanceIntervalMs: BALANCE_INTERVAL_MS },
    "provider_health_poller_started",
  );
}

export function stopProviderHealthPoller(): void {
  if (healthTimer) {
    clearInterval(healthTimer);
    healthTimer = null;
  }
  if (balanceTimer) {
    clearInterval(balanceTimer);
    balanceTimer = null;
  }
}
