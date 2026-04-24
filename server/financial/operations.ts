import { getQueryClient } from "../db";
import { ADVISORY_DEBIT_USER_PURCHASE } from "../db/locks";
import { guardedProviderCall } from "./circuit-breaker";
import {
  appendLedgerEntry,
  assertTransactionBalanced,
  createFinancialTransaction,
  getUserBalanceCents,
  isFinancialFreezeEnabled,
  setUserBalanceCents,
  toCents,
  runTransaction,
} from "./core";
import { sendFinancialAlert } from "./alerts";

export async function ensureFinancialWritesAllowed(): Promise<void> {
  if (await isFinancialFreezeEnabled()) {
    throw new Error("Financial transactions are temporarily frozen");
  }
}

export async function debitUserForPurchase(params: {
  userId: number;
  amountCents: number;
  idempotencyKey: string | null;
  type: string;
  metadata?: Record<string, unknown>;
}): Promise<{ transactionId: number; newBalanceCents: number }> {
  await ensureFinancialWritesAllowed();

  return runTransaction(async () => {
    await getQueryClient().query("SELECT pg_advisory_xact_lock($1, $2)", [
      ADVISORY_DEBIT_USER_PURCHASE,
      params.userId,
    ]);
    const current = await getUserBalanceCents(params.userId);
    if (current < params.amountCents) {
      throw new Error("Insufficient balance");
    }

    const transactionId = await createFinancialTransaction({
      idempotencyKey: params.idempotencyKey,
      userId: params.userId,
      type: params.type,
      status: "success",
      amountCents: params.amountCents,
      currency: "USD",
      metadata: params.metadata ?? null,
    });

    await appendLedgerEntry({
      transactionId,
      account: "user_cash",
      debitCents: params.amountCents,
      creditCents: 0,
      metadata: params.metadata,
    });

    const updated = current - params.amountCents;
    await setUserBalanceCents(params.userId, updated);

    return { transactionId, newBalanceCents: updated };
  });
}

export async function creditUser(params: {
  userId: number;
  amountCents: number;
  idempotencyKey: string | null;
  type: string;
  metadata?: Record<string, unknown>;
}): Promise<{ transactionId: number; newBalanceCents: number }> {
  await ensureFinancialWritesAllowed();

  return runTransaction(async () => {
    const current = await getUserBalanceCents(params.userId);
    const transactionId = await createFinancialTransaction({
      idempotencyKey: params.idempotencyKey,
      userId: params.userId,
      type: params.type,
      status: "success",
      amountCents: params.amountCents,
      currency: "USD",
      metadata: params.metadata ?? null,
    });

    await appendLedgerEntry({
      transactionId,
      account: "user_cash",
      debitCents: 0,
      creditCents: params.amountCents,
      metadata: params.metadata,
    });

    const updated = current + params.amountCents;
    await setUserBalanceCents(params.userId, updated);
    return { transactionId, newBalanceCents: updated };
  });
}

export async function recordRevenueAndCost(params: {
  transactionId: number;
  totalDebitCents: number;
  tellabotCostCents: number;
}): Promise<void> {
  const revenueCents = params.totalDebitCents - params.tellabotCostCents;
  await appendLedgerEntry({
    transactionId: params.transactionId,
    account: "tellabot_cost",
    debitCents: 0,
    creditCents: Math.max(0, params.tellabotCostCents),
  });
  await appendLedgerEntry({
    transactionId: params.transactionId,
    account: "revenue",
    debitCents: 0,
    creditCents: Math.max(0, revenueCents),
  });
  if (!(await assertTransactionBalanced(params.transactionId))) {
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
