/**
 * TellaBot adapter — wraps the legacy `services/tellabot.service.ts` helpers
 * (which speak `handler_api.php`, the SMS-Activate-style endpoint) and the
 * separate `api_command.php` balance/list endpoint behind the unified
 * SmsProvider interface.
 *
 * No new HTTP behaviour beyond what the existing service already does.
 */

import { buyNumberFromTellabot, cancelTellabotNumber, getTellabotStatus } from "../services/tellabot.service";
import {
  extractOtpFromText,
  type ProviderBalance,
  type ProviderHealthResult,
  type ProviderOrder,
  type ProviderQuote,
  type ProviderSmsResult,
  type SmsProvider,
} from "./types";

const COMMAND_BASE = "https://www.tellabot.com/api_command.php";

function envUser(): string {
  return process.env.TELLABOT_USER || "";
}
function envKey(): string {
  return process.env.TELLABOT_API_KEY || "";
}
function markup(): number {
  const m = parseFloat(process.env.TELLABOT_MARKUP || "1.5");
  return Number.isFinite(m) && m > 0 ? m : 1.5;
}

async function commandApi(cmd: string, params: Record<string, string> = {}): Promise<unknown> {
  const url = new URL(COMMAND_BASE);
  url.searchParams.set("cmd", cmd);
  url.searchParams.set("user", envUser());
  url.searchParams.set("api_key", envKey());
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);

  const t0 = Date.now();
  const res = await fetch(url.toString(), {
    signal: AbortSignal.timeout(8000),
  });
  const elapsed = Date.now() - t0;
  if (elapsed > 5000) {
    // soft slow signal — left as a comment for observability sweeps
  }
  return res.json();
}

interface ListServiceRow {
  name: string;
  price: string;
  otp_available?: string;
}

const tellabotProvider: SmsProvider = {
  slug: "tellabot",
  displayName: "TellaBot",

  async health(): Promise<ProviderHealthResult> {
    const t0 = Date.now();
    try {
      const r = (await commandApi("balance")) as { status?: string };
      return { ok: r?.status === "ok", latencyMs: Date.now() - t0 };
    } catch (err) {
      return { ok: false, latencyMs: Date.now() - t0, error: (err as Error).message };
    }
  },

  async getBalance(): Promise<ProviderBalance> {
    const r = (await commandApi("balance")) as { status?: string; message?: string | number };
    if (r?.status !== "ok") {
      throw new Error("TellaBot balance fetch returned non-ok");
    }
    const usd = typeof r.message === "number" ? r.message : parseFloat(String(r.message ?? "0"));
    if (!Number.isFinite(usd)) throw new Error("TellaBot balance not numeric");
    return {
      balanceCents: Math.round(usd * 100),
      rawCurrency: "USD",
      rawValue: usd,
    };
  },

  async quote(service: string): Promise<ProviderQuote> {
    const r = (await commandApi("list_services")) as {
      status?: string;
      message?: ListServiceRow[];
    };
    if (r?.status !== "ok" || !Array.isArray(r.message)) {
      return { costCents: null, available: false };
    }
    const target = service.toLowerCase().replace(/[^a-z0-9]/g, "");
    const row = r.message.find((s) => s.name.toLowerCase().replace(/[^a-z0-9]/g, "") === target);
    if (!row) return { costCents: null, available: false };
    const cost = parseFloat(String(row.price));
    if (!Number.isFinite(cost)) return { costCents: null, available: false };
    const ourPriceCents = Math.round(cost * markup() * 100);
    const stock = parseInt(String(row.otp_available ?? "0"), 10) || 0;
    return { costCents: ourPriceCents, available: stock > 0, note: `stock=${stock}` };
  },

  async buyNumber(service: string): Promise<ProviderOrder> {
    const u = await buyNumberFromTellabot(service);
    const phone = u.phoneNumber.startsWith("+") ? u.phoneNumber : `+${u.phoneNumber}`;
    return { providerOrderId: u.activationId, phoneNumber: phone };
  },

  async checkSms(providerOrderId: string): Promise<ProviderSmsResult> {
    const status = await getTellabotStatus(providerOrderId);
    if (status.startsWith("STATUS_OK:")) {
      const code = status.replace("STATUS_OK:", "").trim();
      return {
        status: "received",
        otpCode: code || undefined,
        messages: code ? [{ text: code }] : [],
      };
    }
    if (status === "STATUS_CANCEL" || status === "NO_ACTIVATION") {
      return { status: "cancelled", messages: [] };
    }
    if (status.startsWith("STATUS_WAIT_RETRY:")) {
      const text = status.replace("STATUS_WAIT_RETRY:", "");
      const otp = extractOtpFromText(text);
      return { status: "waiting", otpCode: otp, messages: [{ text }] };
    }
    return { status: "waiting", messages: [] };
  },

  async cancelOrder(providerOrderId: string): Promise<void> {
    try {
      await cancelTellabotNumber(providerOrderId);
    } catch {
      /* best-effort */
    }
  },
};

export default tellabotProvider;
