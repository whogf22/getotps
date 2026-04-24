/**
 * Runs before test files load so `server/db` pool picks up a real DATABASE_URL.
 * Override with DATABASE_URL_TEST or DATABASE_URL for your Postgres instance.
 */
if (!process.env.DATABASE_URL) {
  process.env.DATABASE_URL =
    process.env.DATABASE_URL_TEST || "postgresql://127.0.0.1:5432/getotps_test";
}

if (!process.env.JWT_SECRET) {
  process.env.JWT_SECRET = "vitest-jwt-secret-not-for-production";
}
