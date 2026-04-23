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
    environment: "node",
    include: ["server/**/*.test.ts"],
    globals: true,
  },
});
