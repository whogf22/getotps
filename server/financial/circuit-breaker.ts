import { sqliteClient } from "../storage";
import { sendFinancialAlert } from "./alerts";
import { logFinancialEvent } from "./logging";

type CircuitState = "CLOSED" | "OPEN" | "HALF_OPEN";

const FAILURE_WINDOW_MS = 60_000;
const OPEN_TIMEOUT_MS = 30_000;

type StateRow = {
  state: CircuitState;
  failure_count: number;
  first_failure_ts: number | null;
  opened_at_ts: number | null;
};

function getState(provider: string): StateRow {
  const row = sqliteClient
    .prepare("SELECT state, failure_count, first_failure_ts, opened_at_ts FROM provider_circuit_state WHERE provider = ?")
    .get(provider) as StateRow | undefined;
  if (row) return row;
  sqliteClient
    .prepare(
      "INSERT INTO provider_circuit_state (provider, state, failure_count, first_failure_ts, opened_at_ts, last_transition_at) VALUES (?, 'CLOSED', 0, NULL, NULL, ?)",
    )
    .run(provider, new Date().toISOString());
  return { state: "CLOSED", failure_count: 0, first_failure_ts: null, opened_at_ts: null };
}

function setState(provider: string, state: CircuitState, failureCount: number, firstFailureTs: number | null, openedAtTs: number | null): void {
  sqliteClient
    .prepare(
      `UPDATE provider_circuit_state
       SET state = ?, failure_count = ?, first_failure_ts = ?, opened_at_ts = ?, last_transition_at = ?
       WHERE provider = ?`,
    )
    .run(state, failureCount, firstFailureTs, openedAtTs, new Date().toISOString(), provider);
}

export async function guardedProviderCall<T>(provider: string, operationType: string, operation: () => Promise<T>, payloadForQueue?: Record<string, unknown>): Promise<T> {
  const now = Date.now();
  const state = getState(provider);

  if (state.state === "OPEN") {
    if (state.opened_at_ts && now - state.opened_at_ts >= OPEN_TIMEOUT_MS) {
      setState(provider, "HALF_OPEN", state.failure_count, state.first_failure_ts, state.opened_at_ts);
      logFinancialEvent("circuit_transition", { provider, from: "OPEN", to: "HALF_OPEN", status: "state_change" });
    } else {
      if (payloadForQueue) {
        queueOperation(provider, operationType, payloadForQueue);
      }
      throw new Error("Provider temporarily unavailable");
    }
  }

  try {
    const result = await operation();
    setState(provider, "CLOSED", 0, null, null);
    return result;
  } catch (error) {
    const current = getState(provider);
    const firstFailureTs =
      current.first_failure_ts && now - current.first_failure_ts <= FAILURE_WINDOW_MS ? current.first_failure_ts : now;
    const failureCount =
      current.first_failure_ts && now - current.first_failure_ts <= FAILURE_WINDOW_MS ? current.failure_count + 1 : 1;

    let nextState: CircuitState = current.state;
    let openedAt: number | null = current.opened_at_ts;
    if (current.state === "HALF_OPEN" || failureCount >= 5) {
      nextState = "OPEN";
      openedAt = now;
      await sendFinancialAlert("critical", "circuit_breaker_open", { provider, failureCount, operationType });
      logFinancialEvent("circuit_transition", { provider, from: current.state, to: "OPEN", status: "state_change" });
    }

    setState(provider, nextState, failureCount, firstFailureTs, openedAt);
    if (payloadForQueue) {
      queueOperation(provider, operationType, payloadForQueue);
    }
    throw error;
  }
}

export function queueOperation(provider: string, operationType: string, payload: Record<string, unknown>, retryCount = 0): void {
  const delayMs = Math.min(3_600_000, Math.pow(2, retryCount) * 5_000);
  const nextRetryAt = new Date(Date.now() + delayMs).toISOString();
  const now = new Date().toISOString();

  sqliteClient
    .prepare(
      `INSERT INTO pending_operations
       (provider, operation_type, payload, retry_count, next_retry_at, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'queued', ?, ?)`,
    )
    .run(provider, operationType, JSON.stringify(payload), retryCount, nextRetryAt, now, now);
}
