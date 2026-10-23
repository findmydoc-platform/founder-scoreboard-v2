import { observedSupabaseFetch } from "./observed-fetch";
import "server-only";
import { createClient } from "@supabase/supabase-js";
import type { GitHubInstallationAction } from "../types";
import type { GitHubJobContext } from "../github-job-types";

const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
function denied(): never { throw new Error("GitHub job claim is no longer valid."); }
function storage() {
  return { url: process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || "", key: process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY || "" };
}
function contract(family: GitHubJobContext["family"], action: GitHubInstallationAction) {
  if (family === "comment-webhook" && action === "github.issue.read") return { table: "github_webhook_deliveries", id: "delivery_id" };
  if (family === "planning-webhook" && action === "github.issue.read") return { table: "github_planning_webhook_deliveries", id: "delivery_id" };
  if (family === "planning-projection" && action === "github.projection.apply") return { table: "planning_github_projection_outbox", id: "id" };
  if (family === "planning-lifecycle" && action === "github.lifecycle.apply") return { table: "planning_github_lifecycle_outbox", id: "id" };
  return denied();
}

export async function bindGitHubJob(value: GitHubJobContext, action: GitHubInstallationAction) {
  if (!value || typeof value !== "object") denied();
  const claim = Object.freeze({ family: value.family, id: value.id, lockToken: value.lockToken });
  const resource = contract(claim.family, action);
  if (typeof claim.id !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(claim.id) || typeof claim.lockToken !== "string" || !uuid.test(claim.lockToken) || (resource.id === "id" && !uuid.test(claim.id))) denied();
  const config = storage();
  const assertStorage = () => {
    const current = storage();
    if (!config.url || !config.key || current.url !== config.url || current.key !== config.key) denied();
  };
  assertStorage();
  const data = createClient(config.url, config.key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: (input, init) => {
      try { assertStorage(); } catch { return Promise.resolve(Response.json({ message: "GitHub job storage binding is no longer valid." }, { status: 401 })); }
      return observedSupabaseFetch(input, init);
    } },
  });
  async function read() {
    assertStorage();
    const result = await data.from(resource.table).select(`${resource.id},status,lock_token,locked_at`).eq(resource.id, claim.id).maybeSingle().retry(false);
    assertStorage();
    const row = result.data as Record<string, unknown> | null;
    if (result.error || !row || row[resource.id] !== claim.id || row.status !== "processing" || row.lock_token !== claim.lockToken || typeof row.locked_at !== "string") denied();
    const lockedAt = Date.parse(row.locked_at);
    if (!Number.isFinite(lockedAt) || lockedAt > Date.now()) denied();
    return lockedAt;
  }
  const originalLockedAt = await read();
  const deadline = originalLockedAt + 120_000;
  const assertOriginal = () => { assertStorage(); if (Date.now() >= deadline) denied(); };
  assertOriginal();
  return Object.freeze({
    claim,
    async reassert() {
      const lockedAt = await read();
      if (lockedAt !== originalLockedAt) denied();
      assertOriginal();
      return assertOriginal;
    },
  });
}
