import { readFileSync } from "fs";
import path from "path";

export type AppVersion = {
  version: string;
  built_at: string;
  branch: string;
};

const FALLBACK_VERSION: AppVersion = {
  version: "dev",
  built_at: new Date(0).toISOString(),
  branch: "unknown",
};

export function readAppVersion(): AppVersion {
  try {
    const rootPath = path.resolve(process.cwd(), "VERSION");
    const raw = readFileSync(rootPath, "utf-8");
    const parsed = JSON.parse(raw) as AppVersion;
    if (!parsed?.version || !parsed?.built_at || !parsed?.branch) return FALLBACK_VERSION;
    return parsed;
  } catch {
    return FALLBACK_VERSION;
  }
}
