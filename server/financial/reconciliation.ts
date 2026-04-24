import { getLedgerUserCashNetCents, getUsersBalanceTotalCents, setFinancialFreeze, writeReconciliationLog } from "./core";
import { sendFinancialAlert } from "./alerts";

const ONE_CENT = 1;

async function getCircleMasterWalletBalanceCents(): Promise<number> {
  // Conservative default if not configured; keeps reconciliation deterministic.
  if (!process.env.CIRCLE_MASTER_WALLET_ADDRESS) return 0;
  return 0;
}

async function getTellabotSpentCents(): Promise<number> {
  // Upstream may expose balance but not always spent aggregate; keep placeholder deterministic.
  return 0;
}

export async function runFinancialReconciliation(): Promise<void> {
  const usersTotal = await getUsersBalanceTotalCents();
  const ledgerUserCash = await getLedgerUserCashNetCents();
  const mismatch = Math.abs(usersTotal - ledgerUserCash);

  const circleBalance = await getCircleMasterWalletBalanceCents();
  const tellabotSpent = await getTellabotSpentCents();

  const details = {
    usersTotalCents: usersTotal,
    ledgerUserCashCents: ledgerUserCash,
    circleMasterWalletCents: circleBalance,
    tellabotSpentCents: tellabotSpent,
  };

  if (mismatch > ONE_CENT) {
    await setFinancialFreeze(true);
    await writeReconciliationLog("critical_mismatch", mismatch, details);
    await sendFinancialAlert("critical", "reconciliation_mismatch", { mismatchCents: mismatch, ...details });
    return;
  }

  await setFinancialFreeze(false);
  await writeReconciliationLog("ok", mismatch, details);
}

let reconciliationInterval: ReturnType<typeof setInterval> | null = null;
let lastRunDate = "";

export function startReconciliationJob(): void {
  const tick = async () => {
    const now = new Date();
    const dateKey = now.toISOString().slice(0, 10);
    if (now.getUTCHours() === 0 && dateKey !== lastRunDate) {
      lastRunDate = dateKey;
      await runFinancialReconciliation();
    }
  };
  void tick();
  reconciliationInterval = setInterval(() => void tick(), 60_000);
}

export function stopReconciliationJob(): void {
  if (reconciliationInterval) clearInterval(reconciliationInterval);
  reconciliationInterval = null;
}
