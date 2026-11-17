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
    expect(await state.planning.loadStructure(roots)).toBe(false);
    const current = owner(async () => good, () => now);
    try {
      expect(await current.planning.loadStructure(roots)).toBe(true); now = good.readAuthority.deadline + 1;
      expect(current.planning.structure(roots)).toMatchObject({ readStatus: "stale", selection: undefined });
    } finally { current.internal.dispose(); }
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
    const oldResponse = response(roots, "old-source"); oldResponse.readAuthority.deadline = now + 60_000;
    oldResponse.model = { ...oldResponse.model, structure: { ...oldResponse.model.structure, validUntil: new Date(now + 60_000).toISOString() } };
    held.resolve(oldResponse); expect(await old).toBe(false);
    expect(state.planning.structure(roots).selection).toBeUndefined();
  } finally { state.internal.dispose(); }
});

test("a typed Structure continuation restarts its mounted class once without the old cursor", async () => {
  const queries: PlanningStructureQuery[] = [];
  const state = owner(async query => {
    queries.push(query);
    if (query.continuation) throw Object.assign(new Error("Changed Structure source"), { status: 409, code: "stale_continuation" });
    const value = response(query, queries.length === 1 ? "old-source" : "new-source");
    value.model = { ...value.model, structure: { ...value.model.structure, total: 2, coverage: "partial", continuation: queries.length === 1 ? "old-page" : "new-page" } };
    return value;
  });
  const release = state.planning.activateStructure(roots);
  try {
    expect(await state.planning.loadStructure(roots)).toBe(true);
    expect(await state.planning.loadStructure({ ...roots, continuation: "old-page" }, { append: true })).toBe(true);
    expect(queries).toEqual([roots, { ...roots, continuation: "old-page" }, roots]);
    expect(state.planning.structure(roots)).toMatchObject({ readStatus: "current", selection: { continuation: "new-page", sourceRevision: "new-source" } });
  } finally { release(); state.internal.dispose(); }
});

for (const firstArea of ["roots", "children"] as const) test(`Structure accepts same-source ${firstArea} membership after its newer peer context without losing current root headers`, async () => {
  const firstQuery = firstArea === "roots" ? roots : children, secondQuery = firstArea === "roots" ? children : roots;
  const held = deferred<StructureRead>(), ordinals: string[] = [];
  const fullRoot = { ...parent, description: "Current authoritative root description", strategy: { goal: "Current authoritative root goal", successCriteria: "Current criteria", scopeConstraints: "Current constraints" }, detailAvailability: "summary" as const };
  const value = (query: PlanningStructureQuery): StructureRead => {
    const frame = response(query);
    const compactContext = { ...parent, detailAvailability: "summary" as const };
    Reflect.deleteProperty(compactContext,"description"); Reflect.deleteProperty(compactContext,"strategy");
    frame.model = { ...frame.model, items: query.area === "roots" ? [fullRoot] : [child, compactContext], taskOmittedFields: query.area === "roots" ? ["note", "evidenceLinks"] : ["description", "strategy", "note", "evidenceLinks"] };
    frame.model = { ...frame.model, items: frame.model.items.map(task => { const copy={...task}; for(const field of frame.model.taskOmittedFields) Reflect.deleteProperty(copy,field); return copy; }) };
    return frame;
  };
  const firstResponse=value(firstQuery),secondResponse=value(secondQuery),deadline=Math.min(firstResponse.readAuthority.deadline,secondResponse.readAuthority.deadline);
  for(const frame of [firstResponse,secondResponse]){frame.readAuthority.deadline=deadline;frame.model={...frame.model,structure:{...frame.model.structure,observedAt:"2026-11-01T12:00:00Z",validUntil:new Date(deadline).toISOString()}};}
  const state = owner(async query => { ordinals.push(query.area === firstArea ? "1:start-first" : "2:start-second"); if(query.area === firstArea)return held.promise;ordinals.push("3:answer-second");return secondResponse; });
  try {
    const first=state.planning.loadStructure(firstQuery);
    expect(await state.planning.loadStructure(secondQuery)).toBe(true);
    if(firstArea==="roots")expect(state.planning.taskDetail(parent.id).task?.description).toBeUndefined();
    ordinals.push("4:answer-first");held.resolve(firstResponse);expect(await first).toBe(true);
    expect(ordinals).toEqual(["1:start-first","2:start-second","3:answer-second","4:answer-first"]);
    expect(state.planning.structure(roots)).toMatchObject({readStatus:"current",selection:{itemIds:[parent.id],coverage:"complete"}});
    expect(state.planning.structure(children)).toMatchObject({readStatus:"current",selection:{itemIds:[child.id],coverage:"complete"}});
    expect(state.planning.taskDetail(parent.id).task).toMatchObject({description:fullRoot.description,strategy:fullRoot.strategy});
  } finally { state.internal.dispose(); }
});
