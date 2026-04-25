/**
 * 5sim.net adapter (https://docs.5sim.net/)
 *
 * 5sim returns:
 *   - prices in RUB (we convert with FIVESIM_RUB_TO_USD env, default 0.011)
 *   - balance in RUB
 *   - service ids equal to lowercase product names (e.g. "google", "telegram")
 *   - phone numbers WITHOUT a leading "+" (we add one)
 *
 * Auth: bearer token in `FIVESIM_API_KEY`.
 *
 * No new behaviour against production 5sim is exercised at module-load time.
 */

import {
  extractOtpFromText,
  type ProviderBalance,
  type ProviderHealthResult,
  type ProviderOrder,
  type ProviderQuote,
  type ProviderSmsMessage,
  type ProviderSmsResult,
  type SmsProvider,
} from "./types";

const BASE = "https://5sim.net/v1";

function key(): string {
  return process.env.FIVESIM_API_KEY || "";
}
function rubToUsd(): number {
  const v = parseFloat(process.env.FIVESIM_RUB_TO_USD || "0.011");
  return Number.isFinite(v) && v > 0 ? v : 0.011;
}
function markup(): number {
  const v = parseFloat(process.env.FIVESIM_MARKUP || process.env.SMS_DEFAULT_MARKUP || "1.5");
  return Number.isFinite(v) && v > 0 ? v : 1.5;
}
function country(): string {
  return process.env.FIVESIM_COUNTRY || "any";
}
function operator(): string {
  return process.env.FIVESIM_OPERATOR || "any";
}

async function call(path: string, init?: RequestInit): Promise<unknown> {
  if (!key()) throw new Error("FIVESIM_API_KEY missing");
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${key()}`,
      Accept: "application/json",
      ...(init?.headers as Record<string, string> | undefined),
    },
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`5sim ${path} -> ${res.status}: ${body.slice(0, 200)}`);
  }
  // Some 5sim endpoints return raw text/strings (e.g. /user/balance returns a number).
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function normalizeServiceSlug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, "");
}

interface ProfileResponse {
  balance: number;
  rating?: number;
}

interface PriceCountryEntry {
  cost: number;
  count: number;
  rate?: number;
}

const fiveSimProvider: SmsProvider = {
  slug: "fivesim",
  displayName: "5sim",

  async health(): Promise<ProviderHealthResult> {
    const t0 = Date.now();
    try {
      const r = (await call("/user/profile")) as ProfileResponse;
      const ok = typeof r?.balance === "number";
      return { ok, latencyMs: Date.now() - t0, error: ok ? undefined : "no balance in profile" };
    } catch (err) {
      return { ok: false, latencyMs: Date.now() - t0, error: (err as Error).message };
    }
  },

  async getBalance(): Promise<ProviderBalance> {
    const r = (await call("/user/profile")) as ProfileResponse;
    if (typeof r?.balance !== "number") throw new Error("5sim balance missing");
    const usd = r.balance * rubToUsd();
    return {
      balanceCents: Math.round(usd * 100),
      rawCurrency: "RUB",
      rawValue: r.balance,
    };
  },

  async quote(service: string): Promise<ProviderQuote> {
    const slug = normalizeServiceSlug(service);
    const r = (await call(`/guest/prices?product=${encodeURIComponent(slug)}`)) as Record<
      string,
      Record<string, Record<string, PriceCountryEntry>>
    >;
    // Shape: { product: { country: { operator: { cost, count, rate } } } }
    const productMap = r?.[slug];
    if (!productMap) return { costCents: null, available: false };

    const targetCountry = country();
    const candidates: PriceCountryEntry[] = [];
    if (targetCountry === "any") {
      for (const ops of Object.values(productMap)) {
        for (const entry of Object.values(ops)) candidates.push(entry);
      }
    } else {
      const ops = productMap[targetCountry];
      if (ops) for (const entry of Object.values(ops)) candidates.push(entry);
    }
    const inStock = candidates.filter((c) => (c.count ?? 0) > 0);
    if (inStock.length === 0) return { costCents: null, available: false };
    const cheapest = inStock.reduce((a, b) => (a.cost <= b.cost ? a : b));
    const usd = cheapest.cost * rubToUsd();
    const ourCents = Math.round(usd * markup() * 100);
    return { costCents: ourCents, available: true, note: `stock=${cheapest.count}` };
  },

  async buyNumber(service: string): Promise<ProviderOrder> {
    const slug = normalizeServiceSlug(service);
    const path = `/user/buy/activation/${encodeURIComponent(country())}/${encodeURIComponent(operator())}/${encodeURIComponent(slug)}`;
    const r = (await call(path)) as { id?: number | string; phone?: string };
    if (!r?.id || !r?.phone) {
      throw new Error(`5sim buy failed (no id/phone): ${JSON.stringify(r).slice(0, 200)}`);
    }
    const phone = String(r.phone);
    return {
      providerOrderId: String(r.id),
      phoneNumber: phone.startsWith("+") ? phone : `+${phone}`,
    };
  },

  async checkSms(providerOrderId: string): Promise<ProviderSmsResult> {
    const r = (await call(`/user/check/${encodeURIComponent(providerOrderId)}`)) as {
      status?: string;
      sms?: Array<{ code?: string; text?: string; sender?: string; date?: string }>;
    };
    const messages: ProviderSmsMessage[] = (r?.sms ?? []).map((m) => ({
      text: m.text ?? "",
      sender: m.sender,
      timestamp: m.date,
    }));
    let otp: string | undefined;
    for (const m of r?.sms ?? []) {
      if (m.code) {
        otp = m.code;
        break;
      }
      const guess = extractOtpFromText(m.text ?? "");
      if (guess) {
        otp = guess;
        break;
      }
    }
    if (otp || (messages.length > 0 && r?.status === "RECEIVED")) {
      return { status: "received", otpCode: otp, messages };
    }
    if (r?.status === "CANCELED" || r?.status === "TIMEOUT") {
      return { status: "cancelled", messages };
    }
    if (r?.status === "BANNED") {
      return { status: "failed", messages };
    }
    return { status: "waiting", messages };
  },

  async cancelOrder(providerOrderId: string): Promise<void> {
    try {
      await call(`/user/cancel/${encodeURIComponent(providerOrderId)}`, { method: "GET" });
    } catch {
      /* best-effort */
    }
  },
};

export default fiveSimProvider;
