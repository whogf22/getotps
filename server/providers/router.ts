/**
 * SMS provider router.
 *
 *   buyNumber(service)
 *     1. Read enabled providers from DB (table `providers`), sorted by priority asc.
 *     2. Quote each healthy provider for `service`.
 *     3. Pick the cheapest healthy provider that has the service in stock.
 *     4. Try buyNumber. On failure → bump in-mem circuit, mark provider unhealthy,
 *        write audit row, fall through to next provider in the list.
 *     5. Return { provider, providerOrder, costCents, fallbackChain }.
 *
 *   checkSms(providerSlug, providerOrderId)
 *   cancelOrder(providerSlug, providerOrderId)
 *     Dispatch by slug to the right provider impl.
 *
 * Circuit breaker:
 *   3 failures within a 60s rolling window opens the circuit; it auto-resets
 *   60s after the open timestamp. While open, the router skips that provider.
 *
 * The breaker is per-process (in-memory). For a multi-process deployment the
 * health-check worker (writes provider_status to DB) is the cross-process truth
 * source; the in-mem breaker just spares the next request from a known-bad call.
 */

import { pool } from "../db";
import { writeAudit } from "../audit";
import type { ProviderQuote, ProviderSmsResult, ProviderSlug, SmsProvider } from "./types";
import tellabotProvider from "./tellabot";
import fiveSimProvider from "./fivesim";
import smsActivateProvider from "./smsActivate";

const FAIL_WINDOW_MS = 60_000;
const FAIL_THRESHOLD = 3;
const OPEN_TIMEOUT_MS = 60_000;

interface BreakerState {
  failures: number[]; // unix-ms timestamps
  openedAt: number | null;
}

const breakerByProvider = new Map<ProviderSlug, BreakerState>();

function getBreaker(slug: ProviderSlug): BreakerState {
  let s = breakerByProvider.get(slug);
  if (!s) {
    s = { failures: [], openedAt: null };
    breakerByProvider.set(slug, s);
  }
  return s;
}

function isOpen(slug: ProviderSlug): boolean {
  const s = getBreaker(slug);
  if (s.openedAt && Date.now() - s.openedAt < OPEN_TIMEOUT_MS) return true;
  if (s.openedAt && Date.now() - s.openedAt >= OPEN_TIMEOUT_MS) {
    s.openedAt = null;
    s.failures = [];
  }
  return false;
}

function recordFailure(slug: ProviderSlug): void {
  const s = getBreaker(slug);
  const now = Date.now();
  s.failures = s.failures.filter((t) => now - t <= FAIL_WINDOW_MS);
  s.failures.push(now);
  if (s.failures.length >= FAIL_THRESHOLD && !s.openedAt) {
    s.openedAt = now;
  }
}

function recordSuccess(slug: ProviderSlug): void {
  const s = getBreaker(slug);
  s.failures = [];
  s.openedAt = null;
}

const REGISTRY: Record<ProviderSlug, SmsProvider> = {
  tellabot: tellabotProvider,
  fivesim: fiveSimProvider,
  smsactivate: smsActivateProvider,
};

export function getProviderImpl(slug: string): SmsProvider | null {
  return REGISTRY[slug as ProviderSlug] ?? null;
}

export function listKnownProviders(): SmsProvider[] {
  return Object.values(REGISTRY);
}

interface ProviderRow {
  slug: string;
  enabled: boolean;
  priority: number;
}

async function loadEnabledProviders(): Promise<ProviderRow[]> {
  try {
    const r = await pool.query<ProviderRow>(
      "SELECT slug, enabled, priority FROM providers WHERE enabled = true ORDER BY priority ASC, slug ASC",
    );
    if (r.rows.length === 0) {
      return [{ slug: "tellabot", enabled: true, priority: 1 }];
    }
    return r.rows;
  } catch {
    // Table may not be migrated yet — fall back to tellabot only so the legacy
    // path keeps working until `npm run db:push` lands.
    return [{ slug: "tellabot", enabled: true, priority: 1 }];
  }
}

export interface BuyNumberResult {
  provider: SmsProvider;
  providerOrderId: string;
  phoneNumber: string;
  costCents: number;
  /** Slugs we tried in order; the last one is the success. */
  fallbackChain: ProviderSlug[];
}

export interface BuyOptions {
  /** Audit context — passed through to writeAudit when fallback fires. */
  userId?: number;
  reqLike?: Parameters<typeof writeAudit>[0];
}

/** Choose providers in cheapest-healthy order for a given service. */
async function rankCandidates(
  service: string,
): Promise<Array<{ provider: SmsProvider; quote: ProviderQuote }>> {
  const enabled = await loadEnabledProviders();
  const ranked: Array<{ provider: SmsProvider; quote: ProviderQuote }> = [];

  await Promise.all(
    enabled.map(async (row) => {
      const impl = getProviderImpl(row.slug);
      if (!impl) return;
      if (isOpen(impl.slug)) return;
      try {
        const quote = await impl.quote(service);
        if (quote.available && typeof quote.costCents === "number") {
          ranked.push({ provider: impl, quote });
        }
      } catch {
        // quote failures don't open the breaker (some providers are slow/flaky on prices)
      }
    }),
  );

  ranked.sort((a, b) => (a.quote.costCents ?? Infinity) - (b.quote.costCents ?? Infinity));
  return ranked;
}

export async function buyNumber(service: string, opts: BuyOptions = {}): Promise<BuyNumberResult> {
  const ranked = await rankCandidates(service);
  if (ranked.length === 0) {
    // No candidate found via quotes — try every enabled provider blindly so a
    // brand-new install (no quote endpoint reachable yet) still has a chance.
    const enabled = await loadEnabledProviders();
    for (const row of enabled) {
      const impl = getProviderImpl(row.slug);
      if (impl && !isOpen(impl.slug)) {
        ranked.push({
          provider: impl,
          quote: { costCents: 0, available: true, note: "blind-fallback" },
        });
      }
    }
  }
  if (ranked.length === 0) {
    throw new Error("No SMS provider available for this service.");
  }

  const tried: ProviderSlug[] = [];
  let lastErr: Error | null = null;

  for (const cand of ranked) {
    tried.push(cand.provider.slug);
    try {
      const order = await cand.provider.buyNumber(service);
      recordSuccess(cand.provider.slug);
      void markProviderHealthy(cand.provider.slug, null);
      if (tried.length > 1 && opts.reqLike) {
        await writeAudit(
          opts.reqLike,
          "provider_failover",
          {
            service,
            chain: tried,
            picked: cand.provider.slug,
            costCents: cand.quote.costCents,
          },
          opts.userId,
        );
      }
      return {
        provider: cand.provider,
        providerOrderId: order.providerOrderId,
        phoneNumber: order.phoneNumber,
        costCents: cand.quote.costCents ?? 0,
        fallbackChain: tried,
      };
    } catch (err) {
      lastErr = err as Error;
      recordFailure(cand.provider.slug);
      void markProviderHealthy(cand.provider.slug, lastErr.message);
      // continue to next candidate
    }
  }

  if (opts.reqLike) {
    await writeAudit(
      opts.reqLike,
      "provider_exhausted",
      { service, chain: tried, lastError: lastErr?.message },
      opts.userId,
    );
  }
  throw new Error(
    `All SMS providers failed for "${service}" (tried ${tried.join(", ")}): ${lastErr?.message ?? "unknown error"}`,
  );
}

export async function checkSms(providerSlug: string, providerOrderId: string): Promise<ProviderSmsResult> {
  const impl = getProviderImpl(providerSlug) ?? tellabotProvider;
  return impl.checkSms(providerOrderId);
}

export async function cancelOrder(providerSlug: string, providerOrderId: string): Promise<void> {
  const impl = getProviderImpl(providerSlug) ?? tellabotProvider;
  return impl.cancelOrder(providerOrderId);
}

/** Worker hook — refreshes provider health & balance in DB. */
export async function refreshProviderHealth(impl: SmsProvider): Promise<{
  ok: boolean;
  balanceCents: number | null;
  error: string | null;
}> {
  return refreshProviderHealthWithOptions(impl, { includeBalance: true });
}

export async function refreshProviderHealthWithOptions(
  impl: SmsProvider,
  options: { includeBalance: boolean },
): Promise<{
  ok: boolean;
  balanceCents: number | null;
  error: string | null;
}> {
  const h = await impl.health();
  let balanceCents: number | null = null;
  let err: string | null = h.ok ? null : (h.error ?? "health failed");
  if (h.ok && options.includeBalance) {
    try {
      const b = await impl.getBalance();
      balanceCents = b.balanceCents;
    } catch (e) {
      err = (e as Error).message;
    }
  }
  await markProviderHealthy(impl.slug, err, balanceCents);
  return { ok: h.ok && err === null, balanceCents, error: err };
}

async function markProviderHealthy(
  slug: string,
  errorMessage: string | null,
  balanceCents: number | null = null,
): Promise<void> {
  try {
    const defaultEnabled = slug === "tellabot";
    const defaultPriority = slug === "tellabot" ? 1 : slug === "fivesim" ? 2 : 3;
    await pool.query(
      `INSERT INTO providers (slug, name, enabled, priority, last_health_at, last_balance_cents, last_error, updated_at)
       VALUES ($1, $1, $4, $5, NOW(), $2, $3, NOW())
       ON CONFLICT (slug) DO UPDATE SET
         last_health_at = NOW(),
         last_balance_cents = COALESCE(EXCLUDED.last_balance_cents, providers.last_balance_cents),
         last_error = EXCLUDED.last_error,
         updated_at = NOW()`,
      [slug, balanceCents, errorMessage, defaultEnabled, defaultPriority],
    );
  } catch {
    // table may not exist yet
  }
}

// Test hook
export const __testing__ = {
  resetBreakers(): void {
    breakerByProvider.clear();
  },
};
