export type ProviderSlug = "tellabot" | "fivesim" | "smsactivate";

export interface ProviderHealthResult {
  ok: boolean;
  latencyMs?: number;
  error?: string;
}

export interface ProviderBalance {
  balanceCents: number;
  rawCurrency?: string;
  rawValue?: number;
}

export interface ProviderQuote {
  costCents: number | null;
  available: boolean;
  note?: string;
}

export interface ProviderOrder {
  providerOrderId: string;
  phoneNumber: string;
}

export interface ProviderSmsMessage {
  text: string;
  sender?: string;
  timestamp?: string;
}

export type ProviderSmsStatus = "waiting" | "received" | "cancelled" | "failed";

export interface ProviderSmsResult {
  status: ProviderSmsStatus;
  otpCode?: string;
  messages: ProviderSmsMessage[];
}

export interface SmsProvider {
  readonly slug: ProviderSlug;
  readonly displayName: string;
  health(): Promise<ProviderHealthResult>;
  getBalance(): Promise<ProviderBalance>;
  quote(service: string): Promise<ProviderQuote>;
  buyNumber(service: string): Promise<ProviderOrder>;
  checkSms(providerOrderId: string): Promise<ProviderSmsResult>;
  cancelOrder(providerOrderId: string): Promise<void>;
}

export function extractOtpFromText(text: string): string | undefined {
  if (!text) return undefined;
  const labeled = text.match(/(?:code|pin|verification)[:\s-]+(\d{4,8})/i);
  if (labeled?.[1]) return labeled[1];
  const numeric = text.match(/(?<!\d)(\d{4,8})(?!\d)/);
  return numeric?.[1];
}
