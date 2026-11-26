import { afterEach, expect, test, vi } from "vitest";
import { createPlanningState, type PlanningStateAdapter } from "@/features/planning/model/internal/planning-state-owner";
import { emptyPlanningShellState } from "@/features/planning/model/planning-shell-state";
import { taskDetailStoryTask } from "@/features/tasks/molecules/task-detail-story-fixtures";
import { DEFAULT_SPRINT_TASK_FILTERS } from "@/features/sprint/model/sprint-task-table-view-model";
import type { SprintScopedQuery, SprintScopedRead } from "@/features/sprint/model/sprint-scoped-read";

const now = Date.parse("2026-11-20T12:00:00Z");
const profile = { id: "sprint-reader", name: "Sprint reader", platformRole: "founder" as const, githubLogin: "" };
const session = { userId: "account", user: { id: "account" }, revision: "session-1", expiresAt: now / 1_000 + 60 };
const sprint = {
  id: "sprint-1", name: "Previous Sprint", status: "planning" as const, startDate: "2026-11-16",
  endDate: "2026-11-29", reviewDueAt: "2026-11-30T12:00:00Z", scoreLocked: false, updatedAt: "original",
};
const task = taskDetailStoryTask({ id: "scoped-sprint-task", sprintId: sprint.id });
const selected: SprintScopedQuery = { scope: "selected", sprintId: sprint.id, filters: DEFAULT_SPRINT_TASK_FILTERS, continuation: null };
const assignment = { ...selected, scope: "assignment" as const };
const forbidden = Object.assign(new Error("Access denied"), { status: 403 });
const revoked = Object.assign(new Error("Session revoked"), { status: 401 });
const disposals: (() => void)[] = [];
afterEach(() => disposals.splice(0).forEach(dispose => dispose()));

function selectedReceipt(name: string): SprintScopedRead {
  return { readActor: { profileId: profile.id, platformRole: profile.platformRole }, readAuthority: { userId: session.userId, deadline: now + 30_000 },
    page: { scope: "selected", sprintId: sprint.id, items: [task], context: [], scopeTotal: 1, matchedTotal: 1, continuation: null,
      unassignedTotal: 0, sprintTaskCounts: { [sprint.id]: 1 }, assignmentTargetsByItemId: {}, sourceRevision: "source-1",
      evaluatedAt: new Date(now - 1).toISOString(), validUntil: new Date(now + 60_000).toISOString() },
    model: { project: emptyPlanningShellState.project, revision: "source-1", people: [], items: [task], sprints: [{ ...sprint, name }], commitments: [],
      scores: [], meetings: [], attendance: [], objections: [], strikeStates: [], strikeEvents: [],
      coverage: { items: "partial", sprints: "complete" } } };
}

function owner(readSprintCollection: (query: SprintScopedQuery, signal: AbortSignal) => Promise<SprintScopedRead>,
  independent?: Partial<Pick<PlanningStateAdapter, "readWorkspace" | "saveTask">>) {
  const receipt = selectedReceipt(sprint.name);
  const initialData = { ...emptyPlanningShellState, sprints: [sprint], tasks: [task], meetings: [{ id: 1, sprintId: sprint.id, title: "Protected meeting", meetingAt: "2026-11-20T09:00:00Z", status: "planned" as const, agenda: "" }] };
  const result = createPlanningState({ userId: session.userId, initialCurrentProfile: profile, initialSession: session,
    initialWorkspace: "sprint", initialData, initialWorkspaceRead: {
      workspace: "sprint", queryKey: "workspace", revision: "source-1", scopeRevision: "source-1", session,
      readAuthority: receipt.readAuthority, coverage: { sprints: "complete", tasks: "partial", meetings: "complete" }, taskOmittedFields: [],
      sprintScope: { query: selected, page: receipt.page, readActor: receipt.readActor },
    }, adapter: { now: () => now, readWorkspace: async () => null, saveTask: async () => ({ task: {} }), readSprintCollection, ...independent } });
  disposals.push(result.internal.dispose);
  return result;
}

test.each([[selected, forbidden], [assignment, revoked]] as const)("a current scoped access denial withdraws Sprint tasks and support", async (query, error) => {
  const { planning } = owner(async () => { throw error; });
  expect(planning.sprintWorkspace().model.sprints).toEqual([sprint]);
  expect(planning.sprintWorkspace().model.meetings).toHaveLength(1);
  expect(planning.sprintCollection(selected).status).toBe("current");
  expect(planning.taskDetail(task.id).task?.id).toBe(task.id);
  if (query.scope === "selected") await expect(planning.refreshWorkspace("sprint")).resolves.toBe(false);
  else await expect(planning.loadSprintCollection(query)).resolves.toBe(false);
  expect(planning.sprintCollection(query)).toEqual({ status: "forbidden" });
  expect(planning.selectedSprintScope()?.page).toBeUndefined();
  expect(planning.taskDetail(task.id).task).toBeNull();
  expect(planning.protectedCache("sprint")).toBeNull();
  expect(planning.sprintWorkspace()).toMatchObject({ readStatus: "forbidden", model: { sprints: [], meetings: [], items: [] } });
});

test("a denial from the superseded session leaves the new Sprint publication intact", async () => {
  const old = Promise.withResolvers<SprintScopedRead>();
  const read = vi.fn<(query: SprintScopedQuery, signal: AbortSignal) => Promise<SprintScopedRead>>()
    .mockReturnValueOnce(old.promise).mockResolvedValueOnce(selectedReceipt("Current Sprint"));
  const { planning, internal } = owner(read);
  const superseded = planning.loadSprintCollection(assignment);
  internal.bindSession({ ...session, revision: "session-2" });
  await expect(planning.refreshWorkspace("sprint")).resolves.toBe(true);
  old.reject(forbidden);
  await expect(superseded).resolves.toBe(false);
  expect(planning.sprintWorkspace()).toMatchObject({ readStatus: "current", model: { sprints: [{ name: "Current Sprint" }] } });
  expect(planning.sprintCollection(selected).status).toBe("current");
});

test("a scoped read with a changed server-confirmed role cannot retain the previous Sprint publication", async () => {
  const receipt = selectedReceipt("Forbidden changed-role Sprint");
  const { planning } = owner(async () => ({ ...receipt, readActor: { ...receipt.readActor, platformRole: "viewer" } }));
  expect(planning.sprintWorkspace().model.meetings).toHaveLength(1);
  await expect(planning.refreshWorkspace("sprint")).resolves.toBe(false);
  expect(planning.sprintWorkspace()).toMatchObject({ readStatus: "forbidden", model: { sprints: [], meetings: [], items: [] } });
});

test("scoped Sprint denial does not withdraw a task independently confirmed in another workspace", async () => {
  const { planning } = owner(async () => { throw forbidden; }, {
    readWorkspace: async () => ({ data: { ...emptyPlanningShellState, tasks: [task] }, coverage: { tasks: "partial" } }),
    saveTask: async (_task, patch) => ({ task: { ...patch, updatedAt: "independent-confirmation" } }),
  });
  await expect(planning.refreshWorkspace("projects")).resolves.toBe(true);
  const current = planning.taskDetail(task.id).task!;
  await expect(planning.saveTask(current, { title: "Independent task confirmation" })).resolves.toMatchObject({ ok: true });
  await expect(planning.refreshWorkspace("sprint")).resolves.toBe(false);
  expect(planning.sprintWorkspace()).toMatchObject({ readStatus: "forbidden", model: { sprints: [], meetings: [], items: [] } });
  expect(planning.protectedCache("sprint")).toBeNull();
  expect(planning.taskDetail(task.id).task).toMatchObject({ title: "Independent task confirmation", updatedAt: "independent-confirmation" });
});
