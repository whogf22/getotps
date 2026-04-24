import crypto from "crypto";

type CircleWallet = {
  id: string;
  address: string;
  blockchain: string;
};

function getCircleBaseUrl(): string {
  return process.env.CIRCLE_API_BASE_URL || "https://api.circle.com/v1/w3s";
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not configured`);
  return value;
}

async function circleRequest<T>(
  path: string,
  method: "GET" | "POST",
  body?: Record<string, unknown>,
): Promise<T> {
  const apiKey = requireEnv("CIRCLE_API_KEY");
  const url = `${getCircleBaseUrl()}${path}`;

  const response = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(`Circle API request failed (${response.status})`);
  }
  return payload as T;
}

export async function createUserWallet(): Promise<CircleWallet> {
  const walletSetId = requireEnv("CIRCLE_WALLET_SET_ID");
  const blockchain = process.env.CIRCLE_WALLET_BLOCKCHAIN || "ETH-SEPOLIA";

  const payload = await circleRequest<{
    data?: { wallets?: Array<{ id: string; address: string; blockchain: string }> };
  }>("/developer/wallets", "POST", {
    idempotencyKey: crypto.randomUUID(),
    walletSetId,
    accountType: "SCA",
    blockchain,
    count: 1,
  });

  const wallet = payload.data?.wallets?.[0];
  if (!wallet) {
    throw new Error("Failed to create Circle wallet");
  }

  return {
    id: wallet.id,
    address: wallet.address,
    blockchain: wallet.blockchain,
  };
}

export async function getUserUsdcBalance(circleWalletId: string): Promise<number> {
  const tokenAddress = requireEnv("CIRCLE_USDC_TOKEN_ADDRESS");

  const payload = await circleRequest<{
    data?: { tokenBalances?: Array<{ token?: { id?: string; address?: string }; amount?: string }> };
  }>(`/wallets/${circleWalletId}/balances`, "GET");

  const tokenBalances = payload.data?.tokenBalances ?? [];
  const match = tokenBalances.find((entry) => {
    const address = entry.token?.address?.toLowerCase();
    return address === tokenAddress.toLowerCase();
  });

  if (!match?.amount) return 0;
  const parsed = Number.parseFloat(match.amount);
  return Number.isFinite(parsed) ? parsed : 0;
}

export async function transferFromUserToMaster(
  fromWalletId: string,
  amountUsdc: string,
): Promise<void> {
  const tokenAddress = requireEnv("CIRCLE_USDC_TOKEN_ADDRESS");
  const destinationAddress = requireEnv("CIRCLE_MASTER_WALLET_ADDRESS");
  const entitySecret = requireEnv("CIRCLE_ENTITY_SECRET");

  const createTx = await circleRequest<{
    data?: { id?: string; state?: string };
  }>("/developer/transactions/transfer", "POST", {
    idempotencyKey: crypto.randomUUID(),
    walletId: fromWalletId,
    destinationAddress,
    amounts: [amountUsdc],
    tokenAddress,
    entitySecretCiphertext: entitySecret,
    feeLevel: "MEDIUM",
  });

  const txId = createTx.data?.id;
  if (!txId) {
    throw new Error("Circle transfer creation failed");
  }

  const terminalFailure = new Set(["FAILED", "DENIED", "CANCELLED"]);
  const deadline = Date.now() + 2 * 60 * 1000;

  while (Date.now() < deadline) {
    const status = await circleRequest<{ data?: { state?: string } }>(`/transactions/${txId}`, "GET");
    const state = status.data?.state ?? "";

    if (state === "COMPLETE") return;
    if (terminalFailure.has(state)) {
      throw new Error(`Circle transfer failed with state ${state}`);
    }

    await new Promise((resolve) => setTimeout(resolve, 3000));
  }

  throw new Error("Circle transfer confirmation timeout");
}
