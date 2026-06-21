import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

export function parseEnvLine(line) {
  const trimmed = line.replace(/^\uFEFF/, "").trim();
  if (!trimmed || trimmed.startsWith("#")) return null;
  const separator = trimmed.indexOf("=");
  if (separator < 0) return null;

  const key = trimmed.slice(0, separator).trim();
  const value = trimmed.slice(separator + 1).trim().replace(/^["']|["']$/g, "");
  return [key, value];
}

export async function loadLocalEnv(envFile = ".env.local") {
  const envPath = resolve(process.cwd(), envFile);
  if (!existsSync(envPath)) return;

  const envContents = await readFile(envPath, "utf8");
  for (const pair of envContents.split(/\r?\n/).map(parseEnvLine)) {
    if (!pair) continue;
    const [key, value] = pair;
    process.env[key] ||= value;
  }
}
