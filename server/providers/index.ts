/**
 * Provider registry public surface + boot-time seed.
 *
 * Importing this module is safe at any point — it never touches the network.
 * `seedProviders()` is called from server/index.ts after the financial schema
 * is ready and from the worker on startup.
 */

import { pool } from "../db";
import { listKnownProviders } from "./router";

export {
  buyNumber,
  cancelOrder,
  checkSms,
  getProviderImpl,
  listKnownProviders,
  refreshProviderHealth,
  refreshProviderHealthWithOptions,
} from "./router";

export type {
  ProviderBalance,
  ProviderHealthResult,
  ProviderOrder,
  ProviderQuote,
  ProviderSlug,
  ProviderSmsMessage,
  ProviderSmsResult,
  ProviderSmsStatus,
  SmsProvider,
} from "./types";

const PRIORITY_DEFAULTS: Record<string, number> = {
  tellabot: 1,
  fivesim: 2,
  smsactivate: 3,
};

const DEFAULT_ENABLED: Record<string, boolean> = {
  tellabot: true,
  // 5sim & sms-activate stay disabled by default until the operator actually
  // sets the API key. Admin UI can flip them on once balance > 0.
  fivesim: false,
  smsactivate: false,
};

/**
 * Idempotent: inserts any provider rows that aren't already in the DB.
 * Never overwrites operator-set `enabled` / `priority` values.
 */
export async function seedProviders(): Promise<void> {
  const known = listKnownProviders();
  for (const impl of known) {
    try {
      await pool.query(
        `INSERT INTO providers (slug, name, enabled, priority, updated_at)
         VALUES ($1, $2, $3, $4, NOW())
         ON CONFLICT (slug) DO NOTHING`,
        [
          impl.slug,
          impl.displayName,
          DEFAULT_ENABLED[impl.slug] ?? false,
          PRIORITY_DEFAULTS[impl.slug] ?? 100,
        ],
      );
    } catch {
      // table may not be migrated yet; npm run db:push fixes it
    }
  }
}
