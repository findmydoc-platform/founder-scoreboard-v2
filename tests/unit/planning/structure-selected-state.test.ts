import { expect, test } from "vitest";
import { createPlanningState } from "@/features/planning/model/internal/planning-state-owner";
import type { StructureRead } from "@/features/planning/model/internal/planning-structure-reads";
import type { PlanningStructureQuery } from "@/features/planning/model/planning-structure-query";
import { DEFAULT_PLANNING_FILTERS } from "@/features/planning/model/planning-board-query";
import { emptyPlanningShellState } from "@/features/planning/model/planning-shell-state";
import { taskDetailStoryTask } from "@/features/tasks/molecules/task-detail-story-fixtures";
const actor = { id: "structure-reader", name: "Reader", platformRole: "founder" as const, orgRole: "Founder", githubLogin: "", weeklyCapacity: 40 };
const session = { userId: "structure-user", user: { id: "structure-user" }, revision: "structure-session", expiresAt: (Date.now() + 3_600_000) / 1000 };
const roots: PlanningStructureQuery = { view: "structure", area: "roots", limit: 20 };
const children: PlanningStructureQuery = { view: "structure", area: "children", parentId: "structure-parent", filters: { ...DEFAULT_PLANNING_FILTERS, sort: "priority", direction: "asc" }, limit: 20 };
const parent = taskDetailStoryTask({ id: "structure-parent", taskType: "initiative", updatedAt: "2026-11-01T12:00:00Z" });
const child = taskDetailStoryTask({ id: "structure-child", parentTaskId: parent.id, updatedAt: parent.updatedAt });
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }
function response(query: PlanningStructureQuery, source = "structure-source"): StructureRead {
  const deadline = Date.now() + 60_000, rows = query.area === "roots" ? [parent] : [child, parent];
  return { readActor: { profileId: actor.id, platformRole: actor.platformRole }, readAuthority: { userId: session.userId, deadline }, model: {
    revision: source, items: rows, people: [actor], taskOmittedFields: [], structure: { query, itemIds: [rows[0].id], contextIds: query.area === "roots" ? [] : [parent.id], total: 1,
      coverage: "complete", continuation: null, sourceRevision: source, scopeRevision: query.area, observedAt: new Date().toISOString(), validUntil: new Date(deadline).toISOString() } } };
}
function owner(read: (query: PlanningStructureQuery, options: { signal: AbortSignal }) => Promise<StructureRead>, now = () => Date.now()) {
  return createPlanningState({ userId: session.userId, initialCurrentProfile: actor, initialSession: session, initialData: emptyPlanningShellState,
    adapter: { now, saveTask: async () => ({ task: child }), readWorkspace: async () => { throw new Error("No workspace fallback"); }, readStructure: read } });
}
test("Structure shares only identical scopes and aborts the final consumer without accepting its late rows", async () => {
  const held = deferred<StructureRead>(); let signal: AbortSignal | undefined, count = 0;
  const state = owner(async (_query, options) => { signal = options.signal; count++; return held.promise; });
  const a = new AbortController(), b = new AbortController();
  try {
    const first = state.planning.loadStructure(roots, { signal: a.signal }), second = state.planning.loadStructure(roots, { signal: b.signal });
    expect(count).toBe(1); a.abort(); expect(signal?.aborted).toBe(false); b.abort(); expect(signal?.aborted).toBe(true);
    held.resolve(response(roots)); expect(await first).toBe(false); expect(await second).toBe(false);
    expect(state.planning.structure(roots).selection).toBeUndefined(); expect(state.planning.taskDetail(parent.id).task).toBeNull();
  } finally { state.internal.dispose(); }
});
test("Structure rejects a foreign actor and replaced session and expires its unchanged original receipt", async () => {
  let now = Date.now(), count = 0; const held = deferred<StructureRead>(), good = response(roots);
  const state = owner(async () => ++count === 1 ? { ...good, readActor: { profileId: "another-reader", platformRole: "founder" } } : count === 2 ? held.promise : good, () => now);
  try {
    expect(await state.planning.loadStructure(roots)).toBe(false);
    const late = state.planning.loadStructure(roots); state.internal.bindSession({ ...session, revision: "replacement" }); held.resolve(good); expect(await late).toBe(false);
    expect(await state.planning.loadStructure(roots)).toBe(true); now = good.readAuthority.deadline + 1;
    expect(state.planning.structure(roots)).toMatchObject({ readStatus: "stale", selection: undefined });
  } finally { state.internal.dispose(); }
});
test("Structure keeps root and parent receipts independent but rejects older source responses after a newer scope expires", async () => {
  let now = Date.now(); const held = deferred<StructureRead>(), newer = response(children, "new-source");
  const state = owner(async query => query.area === "roots" ? held.promise : newer, () => now);
  try {
    const old = state.planning.loadStructure(roots);
    expect(await state.planning.loadStructure(children)).toBe(true);
    expect(state.planning.structure(children).selection?.itemIds).toEqual([child.id]);
    now = newer.readAuthority.deadline + 1; expect(state.planning.structure(children).readStatus).toBe("stale");
    const oldResponse = response(roots, "old-source"); held.resolve(oldResponse); expect(await old).toBe(false);
    expect(state.planning.structure(roots).selection).toBeUndefined();
  } finally { state.internal.dispose(); }
});
