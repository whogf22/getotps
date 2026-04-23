import { guardedProviderCall } from "./circuit-breaker";
import {
  appendLedgerEntry,
  assertTransactionBalanced,
  createFinancialTransaction,
  getUserBalanceCents,
  isFinancialFreezeEnabled,
  setUserBalanceCents,
  toCents,
  withImmediateTransaction,
} from "./core";
import { sendFinancialAlert } from "./alerts";

export function ensureFinancialWritesAllowed(): void {
  if (isFinancialFreezeEnabled()) {
    throw new Error("Financial transactions are temporarily frozen");
  }
}

export function debitUserForPurchase(params: {
  userId: number;
  amountCents: number;
  idempotencyKey: string | null;
  type: string;
  metadata?: Record<string, unknown>;
}): { transactionId: number; newBalanceCents: number } {
  ensureFinancialWritesAllowed();

  return withImmediateTransaction(() => {
    const current = getUserBalanceCents(params.userId);
    if (current < params.amountCents) {
      throw new Error("Insufficient balance");
    }

    const transactionId = createFinancialTransaction({
      idempotencyKey: params.idempotencyKey,
      userId: params.userId,
      type: params.type,
      status: "success",
      amountCents: params.amountCents,
      currency: "USD",
      metadata: params.metadata ?? null,
    });

    appendLedgerEntry({
      transactionId,
      account: "user_cash",
      debitCents: params.amountCents,
      creditCents: 0,
      metadata: params.metadata,
    });

    const updated = current - params.amountCents;
    setUserBalanceCents(params.userId, updated);

    return { transactionId, newBalanceCents: updated };
  });
}

export function creditUser(params: {
  userId: number;
  amountCents: number;
  idempotencyKey: string | null;
  type: string;
  metadata?: Record<string, unknown>;
}): { transactionId: number; newBalanceCents: number } {
  ensureFinancialWritesAllowed();

  return withImmediateTransaction(() => {
    const current = getUserBalanceCents(params.userId);
    const transactionId = createFinancialTransaction({
      idempotencyKey: params.idempotencyKey,
      userId: params.userId,
      type: params.type,
      status: "success",
      amountCents: params.amountCents,
      currency: "USD",
      metadata: params.metadata ?? null,
    });

    appendLedgerEntry({
      transactionId,
      account: "user_cash",
      debitCents: 0,
      creditCents: params.amountCents,
      metadata: params.metadata,
    });

    const updated = current + params.amountCents;
    setUserBalanceCents(params.userId, updated);
    return { transactionId, newBalanceCents: updated };
  });
}

export function recordRevenueAndCost(params: {
  transactionId: number;
  totalDebitCents: number;
  tellabotCostCents: number;
}): void {
  const revenueCents = params.totalDebitCents - params.tellabotCostCents;
  appendLedgerEntry({
    transactionId: params.transactionId,
    account: "tellabot_cost",
    debitCents: 0,
    creditCents: Math.max(0, params.tellabotCostCents),
  });
  appendLedgerEntry({
    transactionId: params.transactionId,
    account: "revenue",
    debitCents: 0,
    creditCents: Math.max(0, revenueCents),
  });
  if (!assertTransactionBalanced(params.transactionId)) {
    void sendFinancialAlert("critical", "ledger_imbalance_detected", { transactionId: params.transactionId });
    throw new Error("Ledger imbalance detected");
  }
}

export async function withProviderCircuit<T>(
  provider: "circle" | "tellabot",
  operationType: string,
  operation: () => Promise<T>,
  queuePayload?: Record<string, unknown>,
): Promise<T> {
  return guardedProviderCall(provider, operationType, operation, queuePayload);
}

export function parseAmountToCents(value: string | number): number {
  const cents = toCents(value);
  if (cents <= 0) throw new Error("Amount must be positive");
  return cents;
}
