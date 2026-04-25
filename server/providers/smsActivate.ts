/**
 * sms-activate.org adapter (https://sms-activate.org/en/api2)
 *
 * sms-activate uses a flat HTTP+query-string API hosted at
 * `https://api.sms-activate.org/stubs/handler_api.php` with `action=*`
 * and an `api_key=*` parameter on every request. Most responses are
 * `KEY:value` strings; getPrices / getBalance / activationStatus return JSON
 * when `format=json` is added.
 *
 * Auth: query-string `api_key` set to `SMSACTIVATE_API_KEY`.
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

const BASE = "https://api.sms-activate.org/stubs/handler_api.php";

function key(): string {
  return process.env.SMSACTIVATE_API_KEY || "";
}
function rubToUsd(): number {
  const v = parseFloat(process.env.SMSACTIVATE_RUB_TO_USD || process.env.FIVESIM_RUB_TO_USD || "0.011");
  return Number.isFinite(v) && v > 0 ? v : 0.011;
}
function markup(): number {
  const v = parseFloat(process.env.SMSACTIVATE_MARKUP || process.env.SMS_DEFAULT_MARKUP || "1.5");
  return Number.isFinite(v) && v > 0 ? v : 1.5;
}
function country(): string {
  // sms-activate uses numeric country codes; 0 = Russia, 12 = USA, 16 = UK, 31 = South Africa, etc.
  return process.env.SMSACTIVATE_COUNTRY || "12";
}

async function call(params: Record<string, string>): Promise<string> {
  if (!key()) throw new Error("SMSACTIVATE_API_KEY missing");
  const url = new URL(BASE);
  url.searchParams.set("api_key", key());
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const res = await fetch(url.toString(), {
    method: "GET",
    headers: { Accept: "application/json, text/plain" },
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) {
    throw new Error(`sms-activate ${params.action} -> ${res.status}`);
  }
  return (await res.text()).trim();
}

// Map our service names to sms-activate codes (https://sms-activate.org/en/api2#services)
// We keep the table small/intentionally — extending later via env override.
function smsActivateServiceCode(service: string): string {
  const slug = service.toLowerCase().replace(/[^a-z0-9]/g, "");
  const map: Record<string, string> = {
    google: "go",
    youtube: "go",
    gmail: "go",
    whatsapp: "wa",
    telegram: "tg",
    discord: "ds",
    facebook: "fb",
    instagram: "ig",
    twitter: "tw",
    x: "tw",
    tiktok: "lf",
    snapchat: "fu",
    uber: "ub",
    lyft: "lf",
    airbnb: "ai",
    amazon: "am",
    apple: "wx",
    microsoft: "mm",
    netflix: "nf",
    paypal: "ts",
    binance: "bn",
    coinbase: "ld",
  };
  return map[slug] ?? slug;
}

const smsActivateProvider: SmsProvider = {
  slug: "smsactivate",
  displayName: "sms-activate",

  async health(): Promise<ProviderHealthResult> {
    const t0 = Date.now();
    try {
      const r = await call({ action: "getBalance" });
      const ok = r.startsWith("ACCESS_BALANCE:") || r.startsWith("ACCESS_BALANCE_FORWARD:");
      return { ok, latencyMs: Date.now() - t0, error: ok ? undefined : r.slice(0, 80) };
    } catch (err) {
      return { ok: false, latencyMs: Date.now() - t0, error: (err as Error).message };
    }
  },

  async getBalance(): Promise<ProviderBalance> {
    const r = await call({ action: "getBalance" });
    if (!r.startsWith("ACCESS_BALANCE")) throw new Error(`sms-activate balance: ${r.slice(0, 60)}`);
    const value = parseFloat(r.split(":").pop() || "0");
    if (!Number.isFinite(value)) throw new Error("sms-activate balance not numeric");
    const usd = value * rubToUsd();
    return {
      balanceCents: Math.round(usd * 100),
      rawCurrency: "RUB",
      rawValue: value,
    };
  },

  async quote(service: string): Promise<ProviderQuote> {
    const code = smsActivateServiceCode(service);
    const r = await call({ action: "getPrices", country: country(), service: code });
    let parsed: Record<string, Record<string, { cost?: number; count?: number }>>;
    try {
      parsed = JSON.parse(r);
    } catch {
      return { costCents: null, available: false };
    }
    const countryMap = parsed[country()];
    const entry = countryMap?.[code];
    if (!entry || !entry.cost) return { costCents: null, available: false };
    const usd = entry.cost * rubToUsd();
    const ourCents = Math.round(usd * markup() * 100);
    return {
      costCents: ourCents,
      available: (entry.count ?? 0) > 0,
      note: `stock=${entry.count ?? 0}`,
    };
  },

  async buyNumber(service: string): Promise<ProviderOrder> {
    const code = smsActivateServiceCode(service);
    const r = await call({ action: "getNumber", service: code, country: country() });
    if (!r.startsWith("ACCESS_NUMBER:")) {
      throw new Error(`sms-activate getNumber failed: ${r.slice(0, 80)}`);
    }
    const [, id, phone] = r.split(":");
    if (!id || !phone) throw new Error("sms-activate malformed ACCESS_NUMBER");
    return {
      providerOrderId: id,
      phoneNumber: phone.startsWith("+") ? phone : `+${phone}`,
    };
  },

  async checkSms(providerOrderId: string): Promise<ProviderSmsResult> {
    const r = await call({ action: "getStatus", id: providerOrderId });
    if (r.startsWith("STATUS_OK:")) {
      const code = r.replace("STATUS_OK:", "").trim();
      return { status: "received", otpCode: code, messages: [{ text: code }] };
    }
    if (r.startsWith("STATUS_WAIT_RETRY:")) {
      const text = r.replace("STATUS_WAIT_RETRY:", "");
      const otp = extractOtpFromText(text);
      const msg: ProviderSmsMessage = { text };
      return { status: "waiting", otpCode: otp, messages: [msg] };
    }
    if (r === "STATUS_CANCEL" || r === "NO_ACTIVATION") {
      return { status: "cancelled", messages: [] };
    }
    return { status: "waiting", messages: [] };
  },

  async cancelOrder(providerOrderId: string): Promise<void> {
    try {
      // setStatus 8 = "cancel activation"
      await call({ action: "setStatus", status: "8", id: providerOrderId });
    } catch {
      /* best-effort */
    }
  },
};

export default smsActivateProvider;
