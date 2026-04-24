import { execSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const repoRoot = path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))));

/**
 * Connect to maintenance DB `postgres` and create the target database if missing.
 * Requires a role with CREATEDB (typical local superuser).
 */
async function ensureDatabaseExists(connectionString: string): Promise<void> {
  let url: URL;
  try {
    url = new URL(connectionString.replace(/^postgresql:/i, "postgres:"));
  } catch {
    return;
  }
  const rawName = decodeURIComponent(url.pathname.replace(/^\//, "").split("?")[0] || "");
  if (!rawName || rawName === "postgres") return;
  if (!/^[a-zA-Z0-9_]+$/.test(rawName)) {
    console.warn(`[vitest globalSetup] skip auto-create: invalid database name "${rawName}"`);
    return;
  }
  url.pathname = "/postgres";
  const adminUrl = url.toString().replace(/^postgres:/i, "postgresql:");
  const client = new pg.Client({ connectionString: adminUrl });
  try {
    await client.connect();
    const exists = await client.query("SELECT 1 FROM pg_database WHERE datname = $1", [rawName]);
    if (exists.rowCount === 0) {
      await client.query(`CREATE DATABASE ${rawName}`);
      console.log(`[vitest globalSetup] created database ${rawName}`);
    }
  } catch (e) {
    console.warn(
      "[vitest globalSetup] could not ensure database exists — create it manually (e.g. createdb getotps_test):",
      e instanceof Error ? e.message : e,
    );
  } finally {
    await client.end().catch(() => {});
  }
}

/**
 * Applies schema to the test database (same as `npm run db:push`).
 */
export default async function globalSetup(): Promise<void> {
  const url =
    process.env.DATABASE_URL_TEST ||
    process.env.DATABASE_URL ||
    "postgresql://127.0.0.1:5432/getotps_test";
  process.env.DATABASE_URL = url;

  await ensureDatabaseExists(url);

  const client = new pg.Client({ connectionString: url });
  try {
    await client.connect();
    await client.query(`
DO $patch$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'users' AND column_name = 'email_verify_token'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'users' AND column_name = 'email_verify_token_hash'
  ) THEN
    ALTER TABLE users RENAME COLUMN email_verify_token TO email_verify_token_hash;
  END IF;
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'users' AND column_name = 'password_reset_token'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'users' AND column_name = 'password_reset_token_hash'
  ) THEN
    ALTER TABLE users RENAME COLUMN password_reset_token TO password_reset_token_hash;
  END IF;
END
$patch$;
ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified boolean NOT NULL DEFAULT false;
ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verify_token_hash text;
ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verify_expires_at timestamptz;
ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verify_sent_at timestamptz;
ALTER TABLE users ADD COLUMN IF NOT EXISTS password_reset_token_hash text;
ALTER TABLE users ADD COLUMN IF NOT EXISTS password_reset_expires_at timestamptz;
ALTER TABLE users ADD COLUMN IF NOT EXISTS admin_totp_secret text;
ALTER TABLE users ADD COLUMN IF NOT EXISTS admin_totp_enabled boolean NOT NULL DEFAULT false;
`);
  } catch (e) {
    console.warn("[vitest globalSetup] users column patch failed:", e instanceof Error ? e.message : e);
  } finally {
    await client.end().catch(() => {});
  }

  try {
    execSync("npx drizzle-kit push --force", {
      cwd: repoRoot,
      env: { ...process.env, DATABASE_URL: url },
      stdio: ["pipe", "inherit", "inherit"],
      input: "y\n",
    });
  } catch {
    console.warn(
      "[vitest globalSetup] drizzle-kit push failed — ensure Postgres is running and DATABASE_URL is valid.",
    );
  }
}
