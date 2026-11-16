import { expect, test } from "vitest";
import { createPlanningState, type PlanningWorkspaceRead } from "@/features/planning/model/internal/planning-state-owner";
import { emptyPlanningShellState } from "@/features/planning/model/planning-shell-state";
import type { BacklogSupportQuery, BacklogControls, BacklogSprintBasis } from "@/features/backlog/model/backlog-support";
import { normalizeBacklogSelection } from "@/features/backlog/model/backlog-selection";
import { DEFAULT_BACKLOG_FILTERS } from "@/features/backlog/model/backlog-view-model";
import { taskDetailStoryTask } from "@/features/tasks/molecules/task-detail-story-fixtures";

const actor = { id: "backlog-support-reader", name: "Synthetic support reader", platformRole: "founder" as const, orgRole: "Founder", githubLogin: "", weeklyCapacity: 40 };
const userId = "backlog-support-user";
const controlsQuery: BacklogSupportQuery = { view: "backlog-support", area: "controls", day: "2026-11-17" };
const sprintsQuery: BacklogSupportQuery = { ...controlsQuery, area: "sprints" };
const selectedQuery = normalizeBacklogSelection({ view: "backlog", filters: DEFAULT_BACKLOG_FILTERS, limit: 20 })!;
const selected = taskDetailStoryTask({ id: "support-selected-row", title: "Selected row", updatedAt: "2026-11-01T12:00:00Z" });
type SupportRead = PlanningWorkspaceRead & { backlogControls?: BacklogControls; backlogSprintBasis?: BacklogSprintBasis };
type SupportPort = { loadBacklogSupport?(query: BacklogSupportQuery, options?: { signal?: AbortSignal }): Promise<boolean> };
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }
function frame(deadline: number): PlanningWorkspaceRead {
  return { data: emptyPlanningShellState, readAuthority: { userId, deadline }, readActor: { profileId: actor.id, platformRole: actor.platformRole },
    taskCoverage: "none", coverage: {}, backlogCoverage: { items: "partial", people: "partial", sprints: "partial", commitments: "partial" } };
}
function receipt(deadline: number) {
  return { coverage: "complete" as const, sourceRevision: "support-source", scopeRevision: "support-scope", observedAt: new Date().toISOString(), validUntil: new Date(deadline).toISOString() };
}
function controls(deadline: number): SupportRead {
  return { ...frame(deadline), backlogControls: { ...receipt(deadline), levelTotals: { epic: 1, initiative: 1, deliverable: 1008 },
    statuses: { epic: ["Offen"], initiative: ["Offen"], deliverable: ["Offen", "Erledigt"] }, assignees: [{ value: actor.id, label: actor.name }],
    epics: [{ value: "support-epic", label: "Unloaded Epic" }], initiatives: [{ value: "support-initiative", label: "Unloaded Initiative" }] } };
}
function selectedFrame(deadline: number): PlanningWorkspaceRead {
  return { ...frame(deadline), data: { ...emptyPlanningShellState, tasks: [selected] }, taskCoverage: "partial", coverage: { tasks: "partial" },
    backlogSelection: { ...receipt(deadline), query: selectedQuery, itemIds: [selected.id], contextIds: [], rankById: { [selected.id]: 1008 }, total: 1, continuation: null } };
}

test("Backlog controls and Sprint receipts remain independent of held selected membership and of each other's original deadlines", async () => {
  let now = Date.now(); const member = deferred<PlanningWorkspaceRead>(); const reads: string[] = []; let memberSignal: AbortSignal | undefined;
  const controlsDeadline = now + 1000, selectedDeadline = now + 120_000, sprintDeadline = now + 60_000;
  const sprintBasis: BacklogSprintBasis = { ...receipt(sprintDeadline), day: sprintsQuery.day, buckets: [] };
  const owner = createPlanningState({ userId, initialData: emptyPlanningShellState, initialCurrentProfile: actor,
    initialSession: { userId, user: { id: userId }, revision: "support-session", expiresAt: (now + 3_600_000) / 1000 }, adapter: {
      now: () => now, saveTask: async () => ({ task: selected }), readWorkspace: async () => { throw new Error("No workspace fallback"); },
      readBacklogSelection: async (_query, options) => { reads.push("selection"); memberSignal = options?.signal; return member.promise; },
      readBacklogSupport: async (query: BacklogSupportQuery) => { reads.push(query.area); return query.area === "controls" ? controls(controlsDeadline) : { ...frame(sprintDeadline), backlogSprintBasis: sprintBasis }; },
    } });
  try {
    const port = owner.planning as typeof owner.planning & SupportPort;
    const pendingMember = owner.planning.loadBacklogSelection(selectedQuery);
    expect(await port.loadBacklogSupport?.(controlsQuery)).toBe(true);
    expect(await port.loadBacklogSupport?.(sprintsQuery)).toBe(true);
    expect(reads).toEqual(["selection", "controls", "sprints"]);
    expect(memberSignal?.aborted).toBe(false);
    expect(owner.planning.backlog()).toMatchObject({ readStatus: "loading", model: { controls: { levelTotals: { deliverable: 1008 } }, sprintBasis } });
    expect(owner.planning.backlog().model.selection).toBeUndefined();
    expect(owner.planning.taskDetail("support-epic").task).toBeNull();
    member.resolve(selectedFrame(selectedDeadline)); expect(await pendingMember).toBe(true);
    expect(owner.planning.backlog()).toMatchObject({ readStatus: "current", model: { selection: { itemIds: [selected.id] }, controls: { coverage: "complete" }, sprintBasis } });
    now = controlsDeadline + 1;
    expect(owner.planning.backlog().model.controls).toBeUndefined();
    expect(owner.planning.backlog()).toMatchObject({ readStatus: "current", model: { selection: { itemIds: [selected.id] }, sprintBasis } });
  } finally { owner.internal.dispose(); }
});

test("a failed or wrong-Actor support read cannot replace current selected Backlog membership", async () => {
  const deadline = Date.now() + 60_000; let fail = true;
  const owner = createPlanningState({ userId, initialData: emptyPlanningShellState, initialCurrentProfile: actor,
    initialSession: { userId, user: { id: userId }, revision: "support-session", expiresAt: (Date.now() + 3_600_000) / 1000 }, adapter: {
      saveTask: async () => ({ task: selected }), readWorkspace: async () => { throw new Error("No workspace fallback"); },
      readBacklogSelection: async () => selectedFrame(deadline), readBacklogSupport: async () => {
        if (fail) throw Object.assign(new Error("Synthetic support unavailable"), { status: 503 });
        return { ...controls(deadline), readActor: { profileId: "another-mapped-reader", platformRole: "founder" as const } };
      },
    } });
  try {
    const port = owner.planning as typeof owner.planning & SupportPort;
    expect(await owner.planning.loadBacklogSelection(selectedQuery)).toBe(true);
    expect(await port.loadBacklogSupport?.(controlsQuery)).toBe(false);
    fail = false; expect(await port.loadBacklogSupport?.(controlsQuery)).toBe(false);
    expect(owner.planning.backlog()).toMatchObject({ readStatus: "current", model: { selection: { itemIds: [selected.id] } } });
    expect(owner.planning.backlog().model.controls).toBeUndefined();
  } finally { owner.internal.dispose(); }
});
