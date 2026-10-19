import { randomUUID } from "node:crypto";
import { appendFile, readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { parseEnvLine } from "./lib/env.mjs";

export function verifyPreviewEnvironment(env, productionRef, { allowUnconfigured = false, sharedBackendSmoke } = {}) {
  if (!productionRef) throw new Error("Production Supabase project reference is required");
  if (env.REQUIRE_SUPABASE_AUTH !== "true") throw new Error("Preview must require authentication");
  if (sharedBackendSmoke?.enabled) {
    if (sharedBackendSmoke.eventName !== "workflow_dispatch"
      || !/^[a-f0-9]{40}$/.test(sharedBackendSmoke.expectedSha || "")
      || sharedBackendSmoke.expectedSha !== sharedBackendSmoke.actualSha) {
      throw new Error("Shared-backend smoke requires a manual run bound to the exact commit");
    }
  }
  const configurationKeys = [
    "NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_URL",
    "NEXT_PUBLIC_SUPABASE_ANON_KEY", "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
    "SUPABASE_ANON_KEY", "SUPABASE_PUBLISHABLE_KEY",
    "SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_SECRET_KEY",
  ];
  if (allowUnconfigured && configurationKeys.every(key => !env[key]?.trim())) return null;
  const url = new URL(env.NEXT_PUBLIC_SUPABASE_URL || "");
  const ref = url.hostname.match(/^([a-z0-9]+)\.supabase\.co$/)?.[1];
  if (!ref || url.protocol !== "https:" || url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
    throw new Error("Preview requires a valid hosted Supabase origin");
  }
  if (ref === productionRef && sharedBackendSmoke?.enabled !== true) throw new Error("Preview must not use the production database");
  for (const [key, role] of [["NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon"], ["SUPABASE_SERVICE_ROLE_KEY", "service_role"]]) {
    let claims;
    try { claims = JSON.parse(Buffer.from(env[key]?.split(".")[1] || "", "base64url").toString("utf8")); }
    catch { throw new Error(`Preview ${key} must be a legacy project JWT`); }
    if (claims.ref !== ref || claims.role !== role) throw new Error(`Preview ${key} does not match its project and role`);
  }
  return ref;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const contents = await readFile(".vercel/.env.preview.local", "utf8");
    const env = Object.fromEntries(contents.split(/\r?\n/).map(parseEnvLine).filter(Boolean));
    // The workflow supplies this value to both the build and deployment command.
    env.REQUIRE_SUPABASE_AUTH = process.env.REQUIRE_SUPABASE_AUTH ?? env.REQUIRE_SUPABASE_AUTH;
    const ref = verifyPreviewEnvironment(env, process.env.PRODUCTION_SUPABASE_PROJECT_REF, {
      allowUnconfigured: process.argv.includes("--allow-unconfigured"),
      sharedBackendSmoke: {
        enabled: process.env.SHARED_BACKEND_AUTH_SMOKE === "true",
        eventName: process.env.GITHUB_EVENT_NAME,
        expectedSha: process.env.EXPECTED_SMOKE_SHA,
        actualSha: process.env.GITHUB_SHA,
      },
    });
    if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT, `ready=${ref !== null}\n`);
    if (ref !== null && process.argv.includes("--export-runtime")) {
      if (!process.env.GITHUB_ENV) throw new Error("GITHUB_ENV is required for runtime export");
      const keys = [
        "NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY",
        "REQUIRE_SUPABASE_AUTH", "APP_URL", "GOOGLE_WORKLOAD_IDENTITY_AUDIENCE",
        "GOOGLE_WORKSPACE_SERVICE_ACCOUNT", "GOOGLE_AUTHORIZED_GROUP",
        "NOTION_DECISION_LOG_ENABLED", "GOOGLE_CHAT_DELIVERY_ENABLED",
      ];
      const delimiter = randomUUID();
      const lines = keys.filter(key => env[key] !== undefined).map(key => `${key}<<${delimiter}\n${env[key]}\n${delimiter}\n`);
      await appendFile(process.env.GITHUB_ENV, lines.join(""));
    }
    console.log(ref === null
      ? "Preview deployment skipped: isolated Supabase backend is not configured."
      : ref === process.env.PRODUCTION_SUPABASE_PROJECT_REF
        ? "Preview environment verified: explicitly approved shared-backend auth smoke, authentication required."
        : `Preview environment verified: isolated Supabase project ${ref}, authentication required.`);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
