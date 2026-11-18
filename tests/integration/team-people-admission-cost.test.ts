import { createClient } from "@supabase/supabase-js";
import { expect, test } from "vitest";
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
