import { defineConfig } from "drizzle-kit";

const url = process.env.DATABASE_URL;
if (!url && process.env.CI) {
  throw new Error("DATABASE_URL is required for drizzle-kit in CI");
}

export default defineConfig({
  schema: "./shared/schema.ts",
  out: "./server/db/migrations",
  dialect: "postgresql",
  dbCredentials: {
    url: url || "postgresql://127.0.0.1:5432/getotps_test",
  },
});
