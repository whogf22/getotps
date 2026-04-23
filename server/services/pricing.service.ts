const SERVICE_USDC_PRICE_MAP: Record<string, number> = {
  // Sample baseline map, can be overridden by DB service pricing.
  wa: 0.50,
  tg: 0.35,
  go: 0.45,
  ig: 0.45,
  ds: 0.30,
};

export function getUsdcSellPrice(serviceCode: string, fallbackPrice?: string): string {
  const mapped = SERVICE_USDC_PRICE_MAP[serviceCode];
  if (mapped) {
    return mapped.toFixed(2);
  }

  if (fallbackPrice) {
    const parsed = Number.parseFloat(fallbackPrice);
    if (Number.isFinite(parsed) && parsed > 0) {
      return parsed.toFixed(2);
    }
  }

  return "0.50";
}
