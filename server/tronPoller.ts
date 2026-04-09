import { storage } from "./storage";
import { log } from "./index";

const TRONGRID_BASE = "https://api.trongrid.io";
const USDT_DECIMALS = 6; // USDT TRC20 uses 6 decimal places (1 USDT = 1_000_000 sun)
const AMOUNT_TOLERANCE = 0.005; // ±0.005 USDT tolerance for exchange rounding

interface TRC20Transaction {
  transaction_id: string;
  block_timestamp: number;
  from: string;
  to: string;
  value: string; // in sun (6 decimals for USDT)
  token_info: {
    symbol: string;
    address: string;
    decimals: number;
  };
}

interface TRC20Response {
  data: TRC20Transaction[];
  success: boolean;
  meta?: {
    at: number;
    page_size: number;
  };
}

async function fetchTRC20Transfers(walletAddress: string, minTimestamp: number): Promise<TRC20Transaction[]> {
  const contractAddress = process.env.USDT_CONTRACT_ADDRESS || "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t";
  const url = new URL(`${TRONGRID_BASE}/v1/accounts/${walletAddress}/transactions/trc20`);
  url.searchParams.set("only_to", "true");
  url.searchParams.set("contract_address", contractAddress);
  url.searchParams.set("limit", "50");
  url.searchParams.set("order_by", "block_timestamp,asc");
  if (minTimestamp > 0) {
    url.searchParams.set("min_timestamp", String(minTimestamp + 1)); // exclusive: skip already-processed
  }

  const headers: Record<string, string> = {
    "Accept": "application/json",
  };
  const apiKey = process.env.TRONGRID_API_KEY;
  if (apiKey) {
    headers["TRONGRID-API-KEY"] = apiKey;
  }

  const res = await fetch(url.toString(), { headers });
  if (!res.ok) {
    throw new Error(`TronGrid API error: ${res.status} ${res.statusText}`);
  }
  const body = await res.json() as TRC20Response;
  if (!body.success || !Array.isArray(body.data)) {
    throw new Error(`TronGrid API returned unexpected response`);
  }
  return body.data;
}

function sunToUsdt(valueSun: string): number {
  return parseInt(valueSun, 10) / Math.pow(10, USDT_DECIMALS);
}

async function processTransfer(tx: TRC20Transaction): Promise<void> {
  const txId = tx.transaction_id;
  const amountUsdt = sunToUsdt(tx.value);

  // Replay check: reject if this tx was already used
  if (storage.depositTxIdExists(txId)) {
    return;
  }

  // Find a pending deposit whose unique_amount matches this transfer
  // We search with tolerance to handle exchange rounding
  const pendingDeposits = await storage.getAllPendingCryptoDeposits();
  const allConfirming = (await storage.getAllCryptoDeposits()).filter(d => d.status === "confirming");
  const candidates = [...pendingDeposits, ...allConfirming].filter(d => {
    if (d.currency !== "USDT_TRC20") return false;
    if (!d.uniqueAmount) return false;
    const expected = parseFloat(d.uniqueAmount);
    return Math.abs(amountUsdt - expected) <= AMOUNT_TOLERANCE;
  });

  if (candidates.length === 0) {
    log(`TronGrid: unmatched transfer ${txId} — ${amountUsdt} USDT (no pending deposit found)`, "tron-poller");
    return;
  }

  if (candidates.length > 1) {
    // Ambiguous match — flag for admin, don't auto-credit
    log(`TronGrid: AMBIGUOUS match for ${txId} — ${amountUsdt} USDT matches ${candidates.length} deposits. Skipping auto-credit.`, "tron-poller");
    return;
  }

  const deposit = candidates[0];
  const now = new Date().toISOString();

  // Credit user balance in a single synchronous transaction
  const user = await storage.getUser(deposit.userId);
  if (!user) {
    log(`TronGrid: user ${deposit.userId} not found for deposit ${deposit.id}. Skipping.`, "tron-poller");
    return;
  }

  const newBalance = (parseFloat(user.balance) + parseFloat(deposit.amount)).toFixed(2);

  // Update deposit record
  await storage.updateCryptoDeposit(deposit.id, {
    status: "completed",
    trongridTxId: txId,
    confirmedAmount: amountUsdt.toFixed(6),
    completedAt: now,
  } as any);

  // Credit balance
  await storage.updateUserBalance(deposit.userId, newBalance);

  // Create audit transaction
  await storage.createTransaction({
    userId: deposit.userId,
    type: "deposit",
    amount: deposit.amount,
    description: `USDT TRC20 deposit auto-confirmed`,
    orderId: null,
    paymentRef: `trongrid:${txId}`,
    createdAt: now,
  });

  log(`TronGrid: auto-confirmed deposit #${deposit.id} — $${deposit.amount} for user #${deposit.userId} (tx: ${txId.slice(0, 16)}...)`, "tron-poller");
}

async function pollOnce(): Promise<void> {
  const walletAddress = process.env.TRON_MASTER_WALLET;
  if (!walletAddress) {
    return; // Silently skip if not configured
  }

  const lastTimestamp = storage.getDepositPollTimestamp();

  try {
    const transfers = await fetchTRC20Transfers(walletAddress, lastTimestamp);

    if (transfers.length === 0) {
      return;
    }

    let maxTimestamp = lastTimestamp;
    for (const tx of transfers) {
      try {
        await processTransfer(tx);
      } catch (err) {
        log(`TronGrid: error processing tx ${tx.transaction_id}: ${err}`, "tron-poller");
      }
      if (tx.block_timestamp > maxTimestamp) {
        maxTimestamp = tx.block_timestamp;
      }
    }

    // Update checkpoint
    if (maxTimestamp > lastTimestamp) {
      storage.setDepositPollTimestamp(maxTimestamp);
    }
  } catch (err) {
    log(`TronGrid poll error: ${err}`, "tron-poller");
  }
}

function expireDeposits(): void {
  try {
    const count = storage.expireStalePendingDeposits();
    if (count > 0) {
      log(`Expired ${count} stale pending deposit(s)`, "tron-poller");
    }
  } catch (err) {
    log(`Deposit expiry error: ${err}`, "tron-poller");
  }
}

let pollTimeout: ReturnType<typeof setTimeout> | null = null;
let expiryInterval: ReturnType<typeof setInterval> | null = null;
let consecutiveErrors = 0;
const MAX_BACKOFF_MS = 5 * 60 * 1000; // cap at 5 minutes

export function startTronPoller(): void {
  const walletAddress = process.env.TRON_MASTER_WALLET;
  if (!walletAddress) {
    log("TRON_MASTER_WALLET not set — TronGrid poller disabled", "tron-poller");
    return;
  }

  const baseIntervalMs = parseInt(process.env.DEPOSIT_POLL_INTERVAL_MS || "30000", 10);

  log(`TronGrid poller starting (every ${baseIntervalMs / 1000}s) — watching ${walletAddress}`, "tron-poller");

  async function scheduleNext() {
    try {
      await pollOnce();
      consecutiveErrors = 0; // reset on success
    } catch (err) {
      consecutiveErrors++;
    }

    // Exponential backoff: base * 2^errors, capped at MAX_BACKOFF_MS
    const delay = consecutiveErrors > 0
      ? Math.min(baseIntervalMs * Math.pow(2, consecutiveErrors), MAX_BACKOFF_MS)
      : baseIntervalMs;

    if (consecutiveErrors > 0) {
      log(`TronGrid: ${consecutiveErrors} consecutive error(s), next poll in ${Math.round(delay / 1000)}s`, "tron-poller");
    }

    pollTimeout = setTimeout(scheduleNext, delay);
  }

  // Run immediately on startup
  scheduleNext();

  // Expire stale deposits every 5 minutes
  expiryInterval = setInterval(expireDeposits, 5 * 60 * 1000);
}

export function stopTronPoller(): void {
  if (pollTimeout) { clearTimeout(pollTimeout); pollTimeout = null; }
  if (expiryInterval) { clearInterval(expiryInterval); expiryInterval = null; }
}
