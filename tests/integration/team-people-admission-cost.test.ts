import { createClient } from "@supabase/supabase-js";
import { expect, test, vi } from "vitest";
import { importTestModule } from "../helpers/vitest-module.mjs";
import { withPlanningCredentialDatabase } from "./helpers/planning-credential-database";

test("Team people preserve the complete directory and CEO CAS basis with one fresh profile guard per data page", () => withPlanningCredentialDatabase(async f => {
  await f.db.query("update public.profiles set name='Independent cost fixture',org_role='Operations',weekly_capacity=37 where id=$1", [f.actors.other.profileId]);
  const { createCompletePlanningReference } = await importTestModule("tests/helpers/complete-planning-reference.ts", { "server-only": {} });
  const client = createClient(f.local.API_URL, f.local.SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
  const reference = await createCompletePlanningReference(client).load({ authorized: true, actorProfileId: f.actors.ceo.profileId, query: { view: "complete" } });
  expect(reference.status).toBe("ready");
  if (reference.status !== "ready") throw new Error("Complete People reference unavailable");
  const byId = <T extends { id: string }>(rows: readonly T[]) => [...rows].sort((left, right) => left.id.localeCompare(right.id));
  const { GET } = await importTestModule("src/app/api/team-data/route.ts", { "server-only": {} });
  const before = f.observed.length;
  const response = await GET(f.request("ceo", "/api/team-data?area=people"));
  expect(response.status).toBe(200);
  const body = await response.json();
  expect(byId(body.model.people)).toEqual(byId(reference.model.people));
  expect(body.model.people).toHaveLength(6);
  expect(body.model.people.find((person: { id: string }) => person.id === f.actors.other.profileId)).toMatchObject({
    name: "Independent cost fixture", orgRole: "Operations", weeklyCapacity: 37,
    persistenceBasis: { platform_role: "founder", org_role: "Operations", weekly_capacity: 37 },
  });
  expect(body.model.items).toEqual([]);
  expect(body.model.readCoverage).toEqual({ people: "complete", items: "partial", strategies: "partial", raci: "partial", links: "partial" });
  expect(body.model.revision).toBe(reference.model.scopeRevision);
  expect(body.model.scopeRevision).toBe(reference.model.scopeRevision);
  expect(Number.isFinite(Date.parse(body.model.observedAt))).toBe(true);
  expect(body.currentProfile).toMatchObject({ id: f.actors.ceo.profileId, platformRole: "ceo" });
  expect(body.readAuthority.userId).toBe(f.actors.ceo.userId);
  const claims = JSON.parse(Buffer.from(f.actors.ceo.token.split(".")[1], "base64url").toString());
  expect(body.readAuthority.deadline).toBeGreaterThan(Date.now());
  expect(body.readAuthority.deadline).toBeLessThanOrEqual(claims.exp * 1000);
  const dispatches = f.observed.slice(before);
  const page = dispatches.findIndex(row => row.path === "/rest/v1/profiles");
  expect(page).toBeGreaterThan(-1);
  expect(dispatches.filter(row => row.path === "/rest/v1/profiles")).toHaveLength(1);
  const fences = dispatches.flatMap((row, index) => row.path === "/rest/v1/rpc/planning_board_publication_context" && row.actor === "ceo" ? [index] : []);
  expect(fences).toHaveLength(2);
  expect(fences[0]).toBeLessThan(page);
  expect(fences[1]).toBeGreaterThan(page);
  expect(dispatches.filter(row => ["/rest/v1/active_tasks", "/rest/v1/tasks", "/rest/v1/planning_item_strategy", "/rest/v1/planning_item_raci_assignments", "/rest/v1/task_links"].includes(row.path))).toEqual([]);
  // Initial session admission remains separate from the fresh guard at the privileged data page.
  expect(dispatches.slice(0, page).filter(row => row.path === "/rest/v1/rpc/current_authenticated_profile" && row.actor === "ceo")).toHaveLength(2);
}), 120_000);

for (const boundary of ["aborted", "exception", "role", "unmapped", "revoked", "deadline", "environment", "page-denial"] as const) {
  test(`Team people preserve fresh admission and original authority after ${boundary}`, () => withPlanningCredentialDatabase(async f => {
    const { authorizeCredentialAction } = await importTestModule("src/lib/credentials/index.ts", { "server-only": {} });
    const permission = await authorizeCredentialAction({ credential: { kind: "session-request", request: f.request("founder", "/api/team-data?area=people") }, action: "team.read" });
    expect(permission.ok).toBe(true);
    if (!permission.ok) throw new Error("Expected original Team admission");
    const claims = JSON.parse(Buffer.from(f.actors.founder.token.split(".")[1], "base64url").toString());
    const originalDeadline = claims.exp * 1000;
    const transport = globalThis.fetch;
    const options: { signal?: AbortSignal } = {};
    let pageAttempted = false;
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
      if (boundary === "page-denial") vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
        const request = new Request(input, init);
        if (new URL(request.url).pathname === "/rest/v1/profiles") {
          pageAttempted = true;
          return Response.json({ code: "42501", message: "Synthetic directory denial" }, { status: 403 });
        }
        return transport(request);
      });
      const before = f.observed.length;
      const result = await permission.resource.loadTeamPeople(options);
      const forbidden = ["role", "unmapped", "revoked", "deadline", "page-denial"].includes(boundary);
      expect(result).toEqual({ status: forbidden ? "forbidden" : "unavailable" });
      expect(result).not.toHaveProperty("model");
      const dispatches = f.observed.slice(before);
      expect(dispatches.filter(row => row.path === "/rest/v1/profiles")).toEqual([]);
      if (boundary === "aborted" || boundary === "exception") expect(dispatches.filter(row => row.path === "/rest/v1/rpc/current_authenticated_profile" && row.actor === "founder")).toHaveLength(1);
      expect(pageAttempted).toBe(boundary === "page-denial");
    } finally {
      restoreClock?.();
      vi.stubGlobal("fetch", transport);
      if (boundary === "environment") vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", f.local.SERVICE_ROLE_KEY);
    }
    if (boundary === "environment" || boundary === "aborted" || boundary === "exception") {
      const recovered = await permission.resource.loadTeamPeople();
      expect(recovered.status).toBe("ready");
      if (recovered.status !== "ready") throw new Error("Expected recovery under original Team authority");
      expect(recovered.readAuthority.deadline).toBeLessThanOrEqual(originalDeadline);
    }
  }), 120_000);
}

for (const boundary of ["source", "actor"] as const) {
  test(`Team people reject ${boundary} changes between directory pages`, () => withPlanningCredentialDatabase(async f => {
    const prefix = `${f.prefix}-directory-page-`;
    const transport = globalThis.fetch;
    let changed = false;
    try {
      await f.db.query("insert into public.profiles(id,name,platform_role) select $1||n::text,'Paged directory member '||n,'founder' from generate_series(1,1001) n", [prefix]);
      vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
        const request = new Request(input, init);
        const response = await transport(request);
        if (!changed && new URL(request.url).pathname === "/rest/v1/profiles" && response.ok) {
          changed = true;
          if (boundary === "source") await f.db.query("update public.profiles set org_role='Changed between pages' where id=$1", [f.actors.other.profileId]);
          else await f.db.query("update public.profiles set platform_role='viewer' where id=$1", [f.actors.ceo.profileId]);
        }
        return response;
      });
      const { GET } = await importTestModule("src/app/api/team-data/route.ts", { "server-only": {} });
      const before = f.observed.length;
      const response = await GET(f.request("ceo", "/api/team-data?area=people"));
      expect(changed).toBe(true);
      expect(response.status).toBe(boundary === "actor" ? 403 : 503);
      expect(await response.json()).not.toHaveProperty("model");
      const dispatches = f.observed.slice(before);
      expect(dispatches.filter(row => row.path === "/rest/v1/profiles")).toHaveLength(boundary === "actor" ? 1 : 2);
      expect(dispatches.filter(row => row.path === "/rest/v1/rpc/current_authenticated_profile" && row.actor === "ceo")).toHaveLength(3);
      expect(dispatches.filter(row => row.path === "/rest/v1/rpc/planning_board_publication_context" && row.actor === "ceo")).toHaveLength(boundary === "actor" ? 1 : 2);
    } finally {
      vi.stubGlobal("fetch", transport);
      await f.db.query("delete from public.profiles where id like $1", [prefix + "%"]);
    }
  }), 120_000);
}
