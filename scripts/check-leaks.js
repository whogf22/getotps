import { readFileSync, readdirSync, statSync, existsSync } from "fs";
import path from "path";
import process from "process";

const ROOT = path.resolve(process.cwd(), "dist");
const BANNED = [
  "tellabot",
  "tellabot.com",
  "handler_api",
  "api_command",
  "circle-fin",
  "circle.com",
  "developer-controlled-wallets",
  "wallet_set_id",
  "entity_secret",
];

function walk(dir, files = []) {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) walk(full, files);
    else files.push(full);
  }
  return files;
}

function run() {
  if (!existsSync(ROOT)) {
    console.log("check:leaks skipped (dist missing)");
    return;
  }
  const files = walk(ROOT).filter((f) => /\.(js|css|html|map|txt|json)$/.test(f));
  const leaks = [];
  for (const file of files) {
    const content = readFileSync(file, "utf-8").toLowerCase();
    for (const token of BANNED) {
      if (content.includes(token)) leaks.push({ file, token });
    }
  }
  if (leaks.length) {
    console.error("Leak check failed. Banned strings detected:");
    for (const leak of leaks) console.error(`- ${leak.token} in ${leak.file}`);
    process.exit(1);
  }
  console.log("check:leaks passed. No banned provider strings found in dist.");
}

run();
