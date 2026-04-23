const BANNED_PROVIDER_PATTERNS: RegExp[] = [
  /tellabot/gi,
  /handler_api/gi,
  /api_command/gi,
  /circle-fin/gi,
  /circle\.com/gi,
  /wallet_set_id/gi,
  /entity_secret/gi,
  /developer-controlled-wallets/gi,
];

export function scrubProviderTerms(input: string): string {
  let out = input;
  for (const pattern of BANNED_PROVIDER_PATTERNS) {
    out = out.replace(pattern, "service");
  }
  return out;
}

export function scrubValue<T>(value: T): T {
  if (typeof value === "string") {
    return scrubProviderTerms(value) as T;
  }
  if (Array.isArray(value)) {
    return value.map((v) => scrubValue(v)) as T;
  }
  if (value && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const sanitized: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj)) {
      const lowered = k.toLowerCase();
      if (
        lowered.includes("activation") ||
        lowered.includes("provider") ||
        lowered.includes("api_key") ||
        lowered.includes("entity_secret") ||
        lowered.includes("wallet_id") ||
        lowered.includes("cost_price") ||
        lowered.includes("costprice") ||
        lowered.includes("tellabot") ||
        lowered.includes("circle")
      ) {
        continue;
      }
      sanitized[k] = scrubValue(v);
    }
    return sanitized as T;
  }
  return value;
}

export function safeProviderNeutralMessage(): string {
  return "Service error. Please contact support.";
}
