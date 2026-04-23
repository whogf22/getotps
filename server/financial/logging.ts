export function logFinancialEvent(event: string, data: {
  transactionId?: number | null;
  idempotencyKey?: string | null;
  userId?: number | null;
  amountCents?: number | null;
  status?: string;
  sourceIp?: string | null;
  userAgent?: string | null;
  [key: string]: unknown;
}): void {
  const payload = {
    event,
    transaction_id: data.transactionId ?? null,
    idempotency_key: data.idempotencyKey ?? null,
    user_id: data.userId ?? null,
    amount_cents: data.amountCents ?? null,
    status: data.status ?? null,
    source_ip: data.sourceIp ?? null,
    user_agent: data.userAgent ?? null,
    timestamp: new Date().toISOString(),
    ...data,
  };
  console.log(JSON.stringify(payload));
}
