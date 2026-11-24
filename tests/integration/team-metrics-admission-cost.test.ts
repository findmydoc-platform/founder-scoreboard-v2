import { createClient } from "@supabase/supabase-js";
import { expect, test, vi } from "vitest";
import { importTestModule } from "../helpers/vitest-module.mjs";
import { withPlanningCredentialDatabase } from "./helpers/planning-credential-database";
import { planningWorkspaceModelToPlanningShellState } from "@/features/planning-items/model/planning-shell-projection";
import { teamMemberStats } from "@/features/team/model/team-profile-view-model";

test("Team metrics retain complete DTO and authority with one fresh profile guard at the aggregate dispatch", () => withPlanningCredentialDatabase(async f => {
  await f.db.query(`insert into public.tasks(id,project_id,title,task_type,parent_task_id,status,priority,approval_status,owner,assignee,estimate_hours)
    values($1||'-cost-open','findmydoc-founder-execution','Open metric cost fixture','deliverable',$2,'Offen','P0','approved',$3,$3,3),
      ($1||'-cost-done','findmydoc-founder-execution','Completed metric cost fixture','deliverable',$2,'Erledigt','P1','approved',$3,$3,5)`,
  [f.prefix, f.initiativeId, f.actors.founder.profileId]);
  const { createCompletePlanningReference } = await importTestModule("tests/helpers/complete-planning-reference.ts", { "server-only": {} });
  const client = createClient(f.local.API_URL, f.local.SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
  const reference = await createCompletePlanningReference(client).load({ authorized: true, actorProfileId: f.actors.founder.profileId, query: { view: "complete" } });
  expect(reference.status).toBe("ready");
  if (reference.status !== "ready") throw new Error("Complete Team metric reference unavailable");
  const data = planningWorkspaceModelToPlanningShellState(reference.model);
  const expected = Object.fromEntries(data.profiles.map(person => [person.id, teamMemberStats(data.tasks, person)]));
  expect(expected[f.actors.founder.profileId]).toEqual({ openTasks: 2, highPriorityTasks: 1, loadHours: 8 });
  expect(expected[f.actors.ceo.profileId]).toEqual({ openTasks: 1, highPriorityTasks: 0, loadHours: 0 });
  expect(expected[f.actors.other.profileId]).toEqual({ openTasks: 0, highPriorityTasks: 0, loadHours: 0 });

  const { GET } = await importTestModule("src/app/api/team-data/route.ts", { "server-only": {} });
  const before = f.observed.length;
  const response = await GET(f.request("founder", "/api/team-data?area=metrics"));
  expect(response.status).toBe(200);
  const body = await response.json();
  expect(body.model).toEqual({ revision: reference.model.scopeRevision, scopeRevision: reference.model.scopeRevision,
    observedAt: expect.any(String), validUntil: null, coverage: "complete", metricsByProfileId: expected });
  expect(Number.isFinite(Date.parse(body.model.observedAt))).toBe(true);
  expect(body.currentProfile).toMatchObject({ id: f.actors.founder.profileId, platformRole: "founder" });
  expect(body.readAuthority.userId).toBe(f.actors.founder.userId);
  const claims = JSON.parse(Buffer.from(f.actors.founder.token.split(".")[1], "base64url").toString());
  expect(body.readAuthority.deadline).toBeGreaterThan(Date.now());
  expect(body.readAuthority.deadline).toBeLessThanOrEqual(claims.exp * 1000);
  const dispatches = f.observed.slice(before);
  const aggregate = dispatches.findIndex(row => row.path === "/rest/v1/rpc/planning_team_metrics");
  expect(aggregate).toBeGreaterThan(-1);
  expect(dispatches.filter(row => row.path === "/rest/v1/rpc/planning_team_metrics")).toHaveLength(1);
  expect(dispatches.filter(row => ["/rest/v1/active_tasks", "/rest/v1/tasks", "/rest/v1/profiles"].includes(row.path))).toEqual([]);
  expect(dispatches.slice(aggregate + 1).filter(row => row.path === "/rest/v1/rpc/planning_board_publication_context" && row.actor === "founder")).toHaveLength(1);
  // Initial session admission remains separate from the fresh guard at the privileged RPC.
  expect(dispatches.slice(0, aggregate).filter(row => row.path === "/rest/v1/rpc/current_authenticated_profile" && row.actor === "founder")).toHaveLength(2);
}), 120_000);

for (const boundary of ["aborted", "exception", "role", "unmapped", "revoked", "deadline", "environment", "rpc-denial"] as const) {
  test(`Team metrics preserve fresh admission and original authority after ${boundary}`, () => withPlanningCredentialDatabase(async f => {
    const { authorizeCredentialAction } = await importTestModule("src/lib/credentials/index.ts", { "server-only": {} });
    const permission = await authorizeCredentialAction({ credential: { kind: "session-request", request: f.request("founder", "/api/team-data?area=metrics") }, action: "team.read" });
    expect(permission.ok).toBe(true);
    if (!permission.ok) throw new Error("Expected original Team admission");
    const claims = JSON.parse(Buffer.from(f.actors.founder.token.split(".")[1], "base64url").toString());
    const originalDeadline = claims.exp * 1000;
    const transport = globalThis.fetch;
    const options: { signal?: AbortSignal } = {};
    let aggregateAttempted = false;
    let restoreClock: (() => void) | undefined;
    try {
      if (boundary === "aborted") options.signal = AbortSignal.abort();
      if (boundary === "exception") Object.defineProperty(options, "signal", { get() { throw new Error("Synthetic local options failure"); } });
      if (boundary === "role") await f.db.query("update public.profiles set platform_role='viewer' where id=$1", [f.actors.founder.profileId]);
      if (boundary === "unmapped") await f.db.query("update public.profiles set auth_user_id=null where id=$1", [f.actors.founder.profileId]);
      if (boundary === "revoked") await f.db.query("delete from auth.sessions where id=$1", [f.actors.founder.sessionId]);
      if (boundary === "deadline") {
        const clock = vi.spyOn(Date, "now").mockReturnValue(originalDeadline + 1);
        restoreClock = () => clock.mockRestore();
      }
      if (boundary === "environment") vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "replaced-synthetic-service-key");
      if (boundary === "rpc-denial") vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
        const request = new Request(input, init);
        if (new URL(request.url).pathname === "/rest/v1/rpc/planning_team_metrics") {
          aggregateAttempted = true;
          return Response.json({ code: "42501", message: "Synthetic aggregate denial" }, { status: 403 });
        }
        return transport(request);
      });
      const before = f.observed.length;
      const result = await permission.resource.loadTeamMetrics(options);
      const forbidden = ["role", "unmapped", "revoked", "deadline", "rpc-denial"].includes(boundary);
      expect(result).toEqual({ status: forbidden ? "forbidden" : "unavailable" });
      expect(result).not.toHaveProperty("model");
      const dispatches = f.observed.slice(before);
      expect(dispatches.filter(row => row.path === "/rest/v1/rpc/planning_team_metrics" || row.path === "/rest/v1/rpc/planning_board_publication_context")).toEqual([]);
      if (boundary === "aborted" || boundary === "exception") expect(dispatches.filter(row => row.path === "/rest/v1/rpc/current_authenticated_profile" && row.actor === "founder")).toHaveLength(1);
      expect(aggregateAttempted).toBe(boundary === "rpc-denial");
    } finally {
      restoreClock?.();
      vi.stubGlobal("fetch", transport);
      if (boundary === "environment") vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", f.local.SERVICE_ROLE_KEY);
    }
    if (boundary === "environment" || boundary === "aborted" || boundary === "exception") {
      const recovered = await permission.resource.loadTeamMetrics();
      expect(recovered.status).toBe("ready");
      if (recovered.status !== "ready") throw new Error("Expected recovery under original Team authority");
      expect(recovered.readAuthority.deadline).toBeLessThanOrEqual(originalDeadline);
    }
  }), 120_000);
}
