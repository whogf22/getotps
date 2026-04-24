import { defineConfig } from "vitest/config";
import path from "path";
import { fileURLToPath } from "url";

const rootDir = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(rootDir, "client/src"),
      "@shared": path.resolve(rootDir, "shared"),
    },
  },
  test: {
    /** Shared Postgres + session store; parallel files caused intermittent 500s on register. */
    fileParallelism: false,
    environment: "node",
    include: ["server/**/*.test.ts"],
    globals: true,
    setupFiles: [path.resolve(rootDir, "server/__tests__/vitestEnv.ts")],
    globalSetup: path.resolve(rootDir, "server/__tests__/globalSetup.ts"),
    env: {
      DATABASE_URL:
        process.env.DATABASE_URL_TEST ||
        process.env.DATABASE_URL ||
        "postgresql://127.0.0.1:5432/getotps_test",
    },
  },
});
