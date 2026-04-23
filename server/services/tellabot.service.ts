const TELLABOT_BASE_URL = "https://www.tellabot.com/stubs/handler_api.php";

function getTellabotApiKey(): string {
  const key = process.env.TELLABOT_API_KEY;
  if (!key) {
    throw new Error("TELLABOT_API_KEY is not configured");
  }
  return key;
}

async function callTellabot(params: Record<string, string>): Promise<string> {
  const url = new URL(TELLABOT_BASE_URL);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }

  const response = await fetch(url.toString(), {
    method: "GET",
    headers: { Accept: "text/plain" },
  });

  const body = (await response.text()).trim();
  if (!response.ok) {
    throw new Error(`Tellabot request failed with status ${response.status}`);
  }
  return body;
}

export async function buyNumberFromTellabot(service: string): Promise<{
  activationId: string;
  phoneNumber: string;
  raw: string;
}> {
  const raw = await callTellabot({
    action: "getNumber",
    service,
    country: "us",
    api_key: getTellabotApiKey(),
  });

  // ACCESS_NUMBER:{activationId}:{phoneNumber}
  if (!raw.startsWith("ACCESS_NUMBER:")) {
    throw new Error("No number available from upstream provider");
  }

  const [, activationId, phoneNumber] = raw.split(":");
  if (!activationId || !phoneNumber) {
    throw new Error("Malformed number response from upstream provider");
  }

  return { activationId, phoneNumber, raw };
}

export async function getTellabotStatus(activationId: string): Promise<string> {
  return callTellabot({
    action: "getStatus",
    id: activationId,
    api_key: getTellabotApiKey(),
  });
}

export async function cancelTellabotNumber(activationId: string): Promise<string> {
  return callTellabot({
    action: "setStatus",
    id: activationId,
    status: "8",
    api_key: getTellabotApiKey(),
  });
}

export async function waitForSmsCode(
  activationId: string,
  timeoutMs = 15 * 60 * 1000,
): Promise<string | null> {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    const status = await getTellabotStatus(activationId);

    if (status.startsWith("STATUS_OK:")) {
      const code = status.replace("STATUS_OK:", "").trim();
      return code || null;
    }

    if (status === "STATUS_CANCEL" || status === "NO_ACTIVATION") {
      await cancelTellabotNumber(activationId);
      return null;
    }

    // STATUS_WAIT_CODE and other transient states
    await new Promise((resolve) => setTimeout(resolve, 5000));
  }

  await cancelTellabotNumber(activationId);
  return null;
}
