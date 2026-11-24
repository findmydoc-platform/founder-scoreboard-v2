import { NextRequest } from "next/server";
import { expect, test, vi } from "vitest";
import type { SprintCompletionRead, SprintCompletionSource } from "@/features/sprint/model/sprint-completion-read";
import { importTestModule } from "../../helpers/vitest-module.mjs";

const route = "src/app/api/sprints/[id]/lock/route.ts";
const id = "sprint-verification";
const context = { params: Promise.resolve({ id }) };
const scope: SprintCompletionSource = {
  sprintId: id, sourceRevision: "52",
  readActor: { profileId: "ceo", platformRole: "ceo" },
  readAuthority: { userId: "team-user", deadline: 1795540000000 },
};

test("completion preflight publishes a separate authorized result without loading a capped legacy task list", async () => {
  const read: SprintCompletionRead = { ...scope, basis: { sprint: {
    id, name: "Selected", status: "review", startDate: "2026-11-04", endDate: "2026-11-18",
    reviewDueAt: "2026-11-20T11:00:00Z", updatedAt: "2026-11-18T07:30:00Z", scoreLocked: false,
  }, tasks: [] },
    tasksComplete: true, receipt: null, reviewDueAt: "2026-11-20T11:00:00Z", openObjections: 0, nextSprintId: null,
    evaluatedAt: "2026-11-20T12:00:00Z", validUntil: "2026-11-20T18:00:00Z", decision: { status: "ready", token: "opaque" } };
  const readSprintLock = vi.fn(async () => ({ data: null, error: { code: "unavailable" } }));
  const readSprintTaskRows = vi.fn();
  const loadSprintCompletion = vi.fn(async () => ({ status: "ready", read }));
  const requirePlanningContext = vi.fn(async () => ({ ok: true, planning: { readSprintLock, readSprintTaskRows, loadSprintCompletion } }));
  const { GET } = await importTestModule(route, {
    "server-only": {},
    "@/features/planning/server/planning-api-context": { requirePlanningContext },
  });
  const request = new NextRequest(`http://localhost/api/sprints/${id}/lock?area=completion`);
  const response = await GET(request, context);
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  expect(await response.json()).toEqual(read);
  expect(requirePlanningContext).toHaveBeenCalledWith(request, "planning.sprint.lock", id);
  expect(loadSprintCompletion).toHaveBeenCalledWith(request.signal);
  expect(readSprintLock).not.toHaveBeenCalled();
  expect(readSprintTaskRows).not.toHaveBeenCalled();
});

test("completion observation exposes only current revision and actor authority", async () => {
  const observeSprintCompletion = vi.fn(async () => ({ status: "ready", read: scope }));
  const loadSprintCompletion = vi.fn();
  const { GET } = await importTestModule(route, {
    "server-only": {},
    "@/features/planning/server/planning-api-context": { requirePlanningContext: async () => ({
      ok: true, planning: { readSprintLock: async () => ({ data: null }), observeSprintCompletion, loadSprintCompletion },
    }) },
  });
  const request = new NextRequest(`http://localhost/api/sprints/${id}/lock?area=completion-source`);
  const response = await GET(request, context);
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual(scope);
  expect(observeSprintCompletion).toHaveBeenCalledWith(request.signal);
  expect(loadSprintCompletion).not.toHaveBeenCalled();
});

test.each([
  ["forbidden", 403, "sprint_lock_denied"],
  ["notFound", 404, "sprint_lock_not_found"],
  ["stale", 409, "sprint_lock_basis_stale"],
  ["unavailable", 503, "sprint_lock_incomplete"],
])("completion preflight does not publish a basis for %s", async (status, httpStatus, code) => {
  const { GET } = await importTestModule(route, {
    "server-only": {},
    "@/features/planning/server/planning-api-context": { requirePlanningContext: async () => ({
      ok: true, planning: { readSprintLock: async () => ({ data: null }), loadSprintCompletion: async () => ({ status }) },
    }) },
  });
  const response = await GET(new NextRequest(`http://localhost/api/sprints/${id}/lock?area=completion`), context);
  expect(response.status).toBe(httpStatus);
  expect(await response.json()).toEqual({ code, error: expect.any(String) });
});
