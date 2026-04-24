import { AsyncLocalStorage } from "node:async_hooks";
import pg, { type Pool, type PoolClient } from "pg";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "@shared/schema";

export type AppDb = NodePgDatabase<typeof schema>;

const connectionString = process.env.DATABASE_URL;
if (!connectionString && process.env.NODE_ENV === "production") {
  throw new Error("DATABASE_URL is required in production");
}

export const pool: Pool = new pg.Pool({
  connectionString: connectionString || "postgresql://localhost:5432/getotps",
  max: Number(process.env.PG_POOL_MAX || 20),
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000,
});

const txStore = new AsyncLocalStorage<{ client: PoolClient; db: AppDb }>();

export const db: AppDb = drizzle(pool, { schema });

export function getDrizzle(): AppDb {
  return txStore.getStore()?.db ?? db;
}

export function getQueryClient(): Pool | PoolClient {
  return txStore.getStore()?.client ?? pool;
}

export async function withTransactionClient<T>(fn: () => Promise<T>): Promise<T> {
  const client = await pool.connect();
  const txDb = drizzle(client, { schema });
  try {
    await client.query("BEGIN");
    const result = await txStore.run({ client, db: txDb }, fn);
    await client.query("COMMIT");
    return result;
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}

export const runTransaction = withTransactionClient;

export async function healthCheckDb(): Promise<boolean> {
  try {
    await pool.query("SELECT 1");
    return true;
  } catch {
    return false;
  }
}

export async function closePool(): Promise<void> {
  await pool.end();
}
