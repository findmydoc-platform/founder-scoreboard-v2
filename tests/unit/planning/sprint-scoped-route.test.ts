import { NextRequest } from "next/server";
import { expect, test, vi } from "vitest";
import { importTestModule } from "../../helpers/vitest-module.mjs";

test("Sprint assignment discovery returns its independent page without reading the legacy workspace or header", async () => {
  const page = { scope: "assignment", sprintId: "sprint-a", items: [], context: [], scopeTotal: 4, matchedTotal: 0,
    continuation: null, sourceRevision: "source-1", evaluatedAt: "2026-11-20T12:00:00Z", validUntil: "2026-11-20T23:00:00Z" };
  const actor = { profileId: "founder-a", platformRole: "founder" };
  const readAuthority = { userId: "user-a", deadline: 1795180000000 };
  const loadSprintScope = vi.fn(async () => ({ status: "ready", page, readAuthority, readActor: actor }));
  const loadSprint = vi.fn(async () => ({ status: "unavailable" }));
  const loadHeader = vi.fn(async () => ({ ok: true }));
  const { GET } = await importTestModule("src/app/api/sprint-data/route.ts", {
    "server-only": {},
    "@/features/planning/server/planning-api-context": { requirePlanningContext: async () => ({ ok: true, permission: {}, planning: { loadSprintScope, loadSprint, loadHeader } }) },
  });
  const response = await GET(new NextRequest("http://localhost/api/sprint-data?scope=assignment&sprintId=sprint-a&query=scope&risk=github"));
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ page, readAuthority, readActor: actor });
  expect(loadSprintScope).toHaveBeenCalledWith(expect.objectContaining({ scope: "assignment", sprintId: "sprint-a", filters: expect.objectContaining({ query: "scope", risk: "github" }) }), expect.any(Object));
  expect(loadSprint).not.toHaveBeenCalled();
  expect(loadHeader).not.toHaveBeenCalled();
});

test("Selected Sprint filter projection returns ordered identities without loading the Sprint workspace", async () => {
  const read = { projection: "matches", sprintId: "sprint-a", matchedIds: ["task-b", "task-a"], matchedTotal: 2, scopeTotal: 4,
    sourceRevision: "source-1", evaluatedAt: "2026-11-20T12:00:00Z", validUntil: "2026-11-20T23:00:00Z",
    readAuthority: { userId: "user-a", deadline: 1795180000000 }, readActor: { profileId: "founder-a", platformRole: "founder" } };
  const loadSprintScope = vi.fn(async () => ({ status: "unavailable" }));
  const loadSprintSelectedProjection = vi.fn(async () => ({ status: "ready", read }));
  const { GET } = await importTestModule("src/app/api/sprint-data/route.ts", {
    "server-only": {},
    "@/features/planning/server/planning-api-context": { requirePlanningContext: async () => ({ ok: true, permission: {}, planning: { loadSprintScope, loadSprintSelectedProjection } }) },
  });
  const response = await GET(new NextRequest("http://localhost/api/sprint-data?scope=selected&sprintId=sprint-a&projection=matches&basis=opaque&query=Scope"));
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual(read);
  expect(loadSprintSelectedProjection).toHaveBeenCalledWith(expect.objectContaining({ scope: "selected", sprintId: "sprint-a", filters: expect.objectContaining({ query: "scope" }) }), "opaque", expect.any(Object));
  expect(loadSprintScope).not.toHaveBeenCalled();
});

test("An Assignment search with a Selected basis returns the independent outcomes from one request", async () => {
  const page = { scope:"assignment", sprintId:"sprint-a", items:[], context:[], scopeTotal:4, matchedTotal:0,
    unassignedTotal:null, sprintTaskCounts:null, assignmentTargetsByItemId:{}, continuation:null, sourceRevision:"source-1",
    evaluatedAt:"2026-11-20T12:00:00Z",validUntil:"2026-11-20T23:00:00Z" };
  const readAuthority = { userId:"user-a", deadline:1795180000000 };
  const readActor = { profileId:"founder-a", platformRole:"founder" };
  const selected = { status:"staleSelectionBasis" };
  const loadSprintScope = vi.fn(async () => ({ status:"ready", page, readAuthority, readActor, selected }));
  const { GET } = await importTestModule("src/app/api/sprint-data/route.ts",{
    "server-only":{},
    "@/features/planning/server/planning-api-context":{ requirePlanningContext:async()=>({ok:true,permission:{},planning:{loadSprintScope}}) },
  });
  const response = await GET(new NextRequest("http://localhost/api/sprint-data?scope=assignment&sprintId=sprint-a&selectedBasis=opaque&query=Scope"));
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ page, readAuthority, readActor, selected });
  expect(loadSprintScope).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ scope:"assignment", sprintId:"sprint-a", filters:expect.objectContaining({query:"scope"}) }),
    expect.objectContaining({ selectedBasis:"opaque" }));
  const continuation = await GET(new NextRequest("http://localhost/api/sprint-data?scope=assignment&sprintId=sprint-a&continuation=page&selectedBasis=opaque"));
  expect(continuation.status).toBe(400);
  expect(loadSprintScope).toHaveBeenCalledTimes(1);
});
