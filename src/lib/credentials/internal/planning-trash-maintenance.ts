import "server-only";
import { projectionAccounting } from "./projection-accounting";
import { runWithDeliveryAdmission } from "./delivery-admission-scope";
import { timingSafeEqual } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { drainPlanningGitHubLifecycleJobs } from "../../planning-github-lifecycle";
import { dispatchPlanningGitHubProjections } from "@/features/planning-items/model/planning-items-github-projection";
import type { GitHubJobContext } from "../github-job-types";
import type { PlanningTrashMaintenanceInput } from "../maintenance-types";

function configuration() {
  return {
    secret: process.env.FOUNDEROPS_MAINTENANCE_SECRET?.trim() || "",
    url: process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || "",
    key: process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY || "",
  };
}
function matches(candidate: string, secret: string) {
  const left = Buffer.from(candidate), right = Buffer.from(secret);
  return Boolean(left.length && left.length === right.length && timingSafeEqual(left, right));
}
export async function authorizePlanningTrashMaintenance(input: PlanningTrashMaintenanceInput) {
  const action = input.action;
  const config = configuration();
  const candidate = input.credential.kind === "maintenance-request" ? input.credential.request.headers.get("x-founderops-maintenance-secret")?.trim() || "" : "";
  if (!matches(candidate, config.secret)) return { ok: false as const, status: 401, error: "Ungültiger Maintenance-Secret." };
  if (action !== "maintenance.planning-trash.lifecycle" && action !== "maintenance.planning-trash.purge") return { ok: false as const, status: 403, error: "Keine Berechtigung für diese Aktion." };
  if (!config.url || !config.key) return { ok: false as const, status: 501, error: "Supabase env is not configured." };
  const assertDatabaseBinding = () => {
    const current = configuration();
    if (current.url !== config.url || current.key !== config.key) throw new Error("Maintenance database binding changed.");
  };
  const assertCurrent = () => {
    const current = configuration();
    if (current.secret !== config.secret || current.url !== config.url || current.key !== config.key) throw new Error("Maintenance admission is no longer valid.");
  };
  const assertLifecycle = () => {
    if (action !== "maintenance.planning-trash.lifecycle") throw new Error("Maintenance action is not permitted.");
    assertCurrent();
  };
  const claims = new Map<string, { id: string; lockToken: string; deadline: number }>();
  const claimKey = (path: string, body: Record<string, unknown>) => JSON.stringify([path, body.p_job_id || body.p_request_id, body.p_lock_token]);
  const verifyProviderAdmission = async (claim?: GitHubJobContext | null) => {
    assertCurrent();
    if (claim === undefined) return assertCurrent;
    const finalizer = claim?.family === "planning-lifecycle" ? "finalize_planning_github_lifecycle_job"
      : claim?.family === "planning-projection" ? "finalize_planning_github_projection_request" : null;
    const key = finalizer && claim ? JSON.stringify([finalizer, claim.id, claim.lockToken]) : "";
    const binding = claims.get(key);
    if (!binding) throw new Error("Maintenance provider dispatch requires its admitted job.");
    const assertClaim = () => {
      assertCurrent();
      if (claims.get(key) !== binding || Date.now() >= binding.deadline) throw new Error("Maintenance claim is no longer valid.");
    };
    assertClaim();
    return assertClaim;
  };
  const accounting = projectionAccounting();
  const data = createClient(config.url, config.key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: async (input, init) => {
      const request = new Request(input, init);
      const path = new URL(request.url).pathname.split("/").at(-1) || "";
      const body = request.method === "POST" ? await request.clone().json() as Record<string, unknown> : {};
      const finalization = path === "finalize_planning_github_lifecycle_job" || path === "finalize_planning_github_projection_request";
      const confirmed = (finalization && claims.has(claimKey(path, body))) || accounting.accepts(path, body);
      try {
        assertDatabaseBinding();
        if (finalization && !confirmed) throw new Error("Maintenance claim is not owned.");
        if (!confirmed) assertCurrent();
      } catch { return Response.json({ message: "Maintenance admission is no longer valid." }, { status: 401 }); }
      const startedAt = Date.now();
      const response = await fetch(request);
      const claimFinalizer = path === "claim_planning_github_lifecycle_jobs" ? "finalize_planning_github_lifecycle_job"
        : path === "claim_planning_github_projection_requests" ? "finalize_planning_github_projection_request" : null;
      if (response.ok && claimFinalizer && typeof body.p_lock_token === "string") {
        const rows = await response.clone().json();
        for (const row of Array.isArray(rows) ? rows : []) {
          const lockedAt = Date.parse(row.locked_at);
          if (typeof row.id !== "string" || row.lock_token !== body.p_lock_token || row.status !== "processing" || !Number.isFinite(lockedAt)) continue;
          claims.set(JSON.stringify([claimFinalizer, row.id, body.p_lock_token]), { id: row.id, lockToken: body.p_lock_token, deadline: Math.min(startedAt + 120000, lockedAt + 120000) });
        }
      }
      if (response.ok && ["try_acquire_github_issue_sync_lock", "release_github_issue_sync_lock", "begin_github_issue_sync_transaction_v2", "finalize_github_issue_sync_with_pull_requests_v1"].includes(path)) accounting.observe(path, body, await response.clone().json());
      if (response.ok && finalization && confirmed) {
        const result = await response.clone().json();
        if (result?.id === (body.p_job_id || body.p_request_id) && ["completed", "retry_scheduled", "failed"].includes(result.status)) claims.delete(claimKey(path, body));
      }
      return response;
    } },
  });
  return { ok: true as const, planningTrash: Object.freeze({
    async drainLifecycle() { assertLifecycle(); return runWithDeliveryAdmission(verifyProviderAdmission, () => drainPlanningGitHubLifecycleJobs({ supabase: data, limit: 25 })); },
    async dispatchProjection() { assertLifecycle(); return runWithDeliveryAdmission(verifyProviderAdmission, () => dispatchPlanningGitHubProjections({ supabase: data, limit: 25 })); },
    async purge() {
      if (action !== "maintenance.planning-trash.purge") return { data: null, error: { code: "42501", message: "Maintenance action is not permitted." } };
      return data.rpc("purge_expired_planning_trash_batch", { p_limit: 25, p_dry_run: false });
    },
    async queueStatus() {
      assertLifecycle();
      const [terminal, lifecycle, projection] = await Promise.all([
        data.from("planning_github_lifecycle_outbox").select("id", { count: "exact", head: true }).eq("status", "failed"),
        data.from("planning_github_lifecycle_outbox").select("id", { count: "exact", head: true }).neq("status", "completed"),
        data.from("planning_github_projection_outbox").select("id", { count: "exact", head: true }).neq("status", "completed"),
      ]);
      if ([terminal, lifecycle, projection].some(result => result.error || typeof result.count !== "number" || !Number.isSafeInteger(result.count) || result.count < 0)) throw new Error("Planning trash lifecycle state is unavailable.");
      return { terminalFailed: terminal.count!, outstandingLifecycleJobs: lifecycle.count!, outstandingProjectionRequests: projection.count! };
    },
  }) };
}
