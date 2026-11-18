import { expect, test, vi } from "vitest";
import { importTestModule } from "../helpers/vitest-module.mjs";
import { withPlanningCredentialDatabase } from "./helpers/planning-credential-database";
import type { Profile } from "@/lib/types";

test("Team people and the CEO editing basis remain available when Planning Item reads fail", () => withPlanningCredentialDatabase(async f => {
  await f.db.query("update public.profiles set name='Independent Team member',org_role='Operations',weekly_capacity=37 where id=$1", [f.actors.other.profileId]);
  const authenticatedFetch = globalThis.fetch;
  const planningReads: string[] = [];
  const planningCollections = new Set([
    "/rest/v1/active_tasks", "/rest/v1/planning_item_strategy", "/rest/v1/planning_item_raci_assignments", "/rest/v1/task_links",
  ]);
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init), url = new URL(request.url);
    if (url.origin === new URL(f.local.API_URL).origin && planningCollections.has(url.pathname)) {
      planningReads.push(url.pathname);
      return Response.json({ message: "Planning Item collection intentionally unavailable" }, { status: 503 });
    }
    // Keep the real mapped-user, Workspace, profile and independent Header protocols.
    return authenticatedFetch(request);
  });

  const { GET } = await importTestModule("src/app/api/team-data/route.ts", { "server-only": {} });
  const response = await GET(f.request("ceo", "/api/team-data?area=people"));
  expect(response.status).toBe(200);
  const body = await response.json();
  expect(body.currentProfile).toMatchObject({ id: f.actors.ceo.profileId, platformRole: "ceo" });
  expect(body.model.people.map((profile: Profile) => profile.id).sort()).toEqual([
    "ceo", "deputy", "founder", "other", "viewer", "administrator",
  ].map(actor => `${f.prefix}-${actor}`).sort());
  expect(body.model.readCoverage.people).toBe("complete");
  expect(body.model.people.find((profile: Profile) => profile.id === f.actors.other.profileId)).toMatchObject({
    id: f.actors.other.profileId, name: "Independent Team member", platformRole: "founder", orgRole: "Operations", weeklyCapacity: 37,
    persistenceBasis: { platform_role: "founder", org_role: "Operations", weekly_capacity: 37 },
  });
  expect(body.model.items).toEqual([]);
  expect(body.model.readCoverage.items).toBe("partial");
  expect(planningReads).toEqual([]);
}), 120_000);
