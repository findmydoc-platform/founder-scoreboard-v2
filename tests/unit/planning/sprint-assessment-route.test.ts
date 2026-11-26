import { NextRequest } from "next/server";
import { expect, test, vi } from "vitest";
import { importTestModule } from "../../helpers/vitest-module.mjs";

const sprintId = "sprint-a";
const source = {
  sprintId, sourceRevision: "42",
  readAuthority: { userId: "authorized-user", deadline: 1795540000000 },
  readActor: { profileId: "authorized-profile", platformRole: "founder" },
};
const read = {
  ...source, evaluatedAt: "2026-11-20T12:00:00Z", validUntil: "2026-11-20T15:00:00Z",
  scoreLocked: false, scoreRows: [],
  inputCounts: { people: 0, items: 0, commitments: 0, scores: 0, strikeStates: 0, objections: 0, meetings: 0, attendance: 0 },
};
const route = "src/app/api/sprint-data/route.ts";
const legacy = {
  loadSprint: async () => ({ status: "unavailable" }),
  loadHeader: async () => ({ ok: true }),
};

test("Sprint assessment returns only the chosen Sprint's complete result without loading assignment, workspace or header", async () => {
  const loadSprintAssessment = vi.fn(async () => ({ status: "ready", read }));
  const loadSprint = vi.fn(async () => ({ status: "unavailable" }));
  const loadSprintScope = vi.fn(async () => ({ status: "unavailable" }));
  const loadHeader = vi.fn(async () => ({ ok: true }));
  const { GET } = await importTestModule(route, {
    "server-only": {},
    "@/features/planning/server/planning-api-context": { requirePlanningContext: async () => ({ ok: true, permission: { profile: null }, planning: { loadSprintAssessment, loadSprintScope, loadSprint, loadHeader } }) },
  });
  const request = new NextRequest(`http://localhost/api/sprint-data?area=assessment&sprintId=${sprintId}`);
  const response = await GET(request);
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  expect(await response.json()).toEqual(read);
  expect(loadSprintAssessment).toHaveBeenCalledWith(sprintId, request.signal);
  expect(loadSprint).not.toHaveBeenCalled();
  expect(loadSprintScope).not.toHaveBeenCalled();
  expect(loadHeader).not.toHaveBeenCalled();
});

test("Sprint assessment source observation returns metadata without computing or reading contents", async () => {
  const observeSprintAssessment = vi.fn(async () => ({ status: "ready", read:source }));
  const loadSprintAssessment = vi.fn(async () => ({ status: "unavailable" }));
  const { GET } = await importTestModule(route, {
    "server-only": {},
    "@/features/planning/server/planning-api-context": { requirePlanningContext: async () => ({ ok: true, permission: { profile: null }, planning: { ...legacy, observeSprintAssessment, loadSprintAssessment } }) },
  });
  const request = new NextRequest(`http://localhost/api/sprint-data?area=assessment-source&sprintId=${sprintId}`);
  const response = await GET(request);
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual(source);
  expect(observeSprintAssessment).toHaveBeenCalledWith(sprintId, request.signal);
  expect(loadSprintAssessment).not.toHaveBeenCalled();
});

test.each([
  ["forbidden", 403, "sprint_assessment_denied"],
  ["notFound", 404, "sprint_assessment_not_found"],
  ["stale", 409, "stale_sprint_assessment"],
  ["unavailable", 503, "sprint_assessment_unavailable"],
])("Sprint assessment %s never publishes an empty score", async (status, expectedStatus, code) => {
  const { GET } = await importTestModule(route, {
    "server-only": {},
    "@/features/planning/server/planning-api-context": { requirePlanningContext: async () => ({ ok: true, permission: { profile: null }, planning: {
      ...legacy, loadSprintAssessment: async () => ({ status }),
    } }) },
  });
  const response = await GET(new NextRequest(`http://localhost/api/sprint-data?area=assessment&sprintId=${sprintId}`));
  expect(response.status).toBe(expectedStatus);
  expect(await response.json()).toEqual({ code, error:expect.any(String) });
});
