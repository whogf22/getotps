import process from "process";

const APP_URL = process.env.APP_URL || "http://localhost:5000";
const BANNED = [
  "tellabot",
  "handler_api",
  "api_command",
  "circle-fin",
  "circle.com",
  "developer-controlled-wallets",
  "wallet_set_id",
  "entity_secret",
];

function includesBanned(text) {
  const lower = text.toLowerCase();
  return BANNED.find((needle) => lower.includes(needle));
}

async function fetchAndAssert(path) {
  const url = `${APP_URL}${path}`;
  const res = await fetch(url);
  if (res.status !== 200) {
    throw new Error(`${path} expected 200, got ${res.status}`);
  }
  const body = await res.text();
  const bannedBody = includesBanned(body);
  if (bannedBody) throw new Error(`${path} body leaked banned term: ${bannedBody}`);
  for (const [k, v] of res.headers.entries()) {
    const bannedHeader = includesBanned(`${k}:${v}`);
    if (bannedHeader) throw new Error(`${path} header leaked banned term: ${bannedHeader}`);
  }
  return body;
}

async function run() {
  const versionBody = await fetchAndAssert("/api/version");
  await fetchAndAssert("/healthz");
  await fetchAndAssert("/api/v1/services");

  let parsed;
  try {
    parsed = JSON.parse(versionBody);
  } catch {
    throw new Error("/api/version did not return valid JSON");
  }
  if (!parsed.version || !parsed.built_at) {
    throw new Error("/api/version missing version metadata");
  }
  console.log(`✅ Site is live and updated: version ${parsed.version} built at ${parsed.built_at}`);
}

run().catch((err) => {
  console.error(`❌ FAILED: ${err.message}`);
  process.exit(1);
});
