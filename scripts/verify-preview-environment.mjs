import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { parseEnvLine } from "./lib/env.mjs";

export function verifyPreviewEnvironment(env, productionRef) {
  if (!productionRef) throw new Error("Production Supabase project reference is required");
  const url = new URL(env.NEXT_PUBLIC_SUPABASE_URL || "");
  const ref = url.hostname.match(/^([a-z0-9]+)\.supabase\.co$/)?.[1];
  if (!ref || url.protocol !== "https:" || url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
    throw new Error("Preview requires a valid hosted Supabase origin");
  }
  if (ref === productionRef) throw new Error("Preview must not use the production database");
  for (const [key, role] of [["NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon"], ["SUPABASE_SERVICE_ROLE_KEY", "service_role"]]) {
    let claims;
    try { claims = JSON.parse(Buffer.from(env[key]?.split(".")[1] || "", "base64url").toString("utf8")); }
    catch { throw new Error(`Preview ${key} must be a legacy project JWT`); }
    if (claims.ref !== ref || claims.role !== role) throw new Error(`Preview ${key} does not match its project and role`);
  }
  if (env.REQUIRE_SUPABASE_AUTH !== "true") throw new Error("Preview must require authentication");
  return ref;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const contents = await readFile(".vercel/.env.preview.local", "utf8");
    const env = Object.fromEntries(contents.split(/\r?\n/).map(parseEnvLine).filter(Boolean));
    const ref = verifyPreviewEnvironment(env, process.env.PRODUCTION_SUPABASE_PROJECT_REF);
    console.log(`Preview environment verified: isolated Supabase project ${ref}, authentication required.`);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
