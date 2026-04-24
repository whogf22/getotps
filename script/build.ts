import { build as esbuild } from "esbuild";
import { build as viteBuild } from "vite";
import { rm, readFile, writeFile } from "fs/promises";
import { execSync } from "child_process";

// server deps to bundle to reduce openat(2) syscalls
// which helps cold start times
const allowlist = [
  "@google/generative-ai",
  "axios",
  "cors",
  "date-fns",
  "drizzle-orm",
  "drizzle-zod",
  "express",
  "express-rate-limit",
  "express-session",
  "jsonwebtoken",
  "memorystore",
  "multer",
  "nanoid",
  "nodemailer",
  "openai",
  "passport",
  "passport-local",
  "better-sqlite3-session-store",
  "uuid",
  "ws",
  "xlsx",
  "zod",
  "zod-validation-error",
];

async function buildAll() {
  const version = execSync("git rev-parse --short HEAD").toString().trim();
  const branch = execSync("git branch --show-current").toString().trim();
  const builtAt = new Date().toISOString();
  await writeFile(
    "VERSION",
    JSON.stringify(
      {
        version,
        built_at: builtAt,
        branch,
      },
      null,
      2,
    ),
    "utf-8",
  );

  await rm("dist", { recursive: true, force: true });

  console.log("building client...");
  await viteBuild();

  console.log("building server...");
  const pkg = JSON.parse(await readFile("package.json", "utf-8"));
  const allDeps = [
    ...Object.keys(pkg.dependencies || {}),
    ...Object.keys(pkg.devDependencies || {}),
  ];
  const externals = allDeps.filter((dep) => !allowlist.includes(dep));

  const esbuildOpts = {
    platform: "node" as const,
    bundle: true,
    format: "cjs" as const,
    define: {
      "process.env.NODE_ENV": '"production"',
    },
    minify: true,
    external: externals,
    logLevel: "info" as const,
  };

  await esbuild({
    entryPoints: ["server/index.ts"],
    outfile: "dist/index.cjs",
    ...esbuildOpts,
  });

  await esbuild({
    entryPoints: ["server/worker.ts"],
    outfile: "dist/worker.cjs",
    ...esbuildOpts,
  });
}

buildAll().catch((err) => {
  console.error(err);
  process.exit(1);
});
