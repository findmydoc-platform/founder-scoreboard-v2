import { afterEach, expect, test, vi } from "vitest";
import { createSprintCollectionReads } from "@/features/planning/model/internal/sprint-collection-reads";
import type { SprintScopedQuery, SprintScopedRead, SprintSelectedProjectionRead, SprintJointRead } from "@/features/sprint/model/sprint-scoped-read";
import { DEFAULT_SPRINT_TASK_FILTERS } from "@/features/sprint/model/sprint-task-table-view-model";
import { taskDetailStoryTask } from "@/features/tasks/molecules/task-detail-story-fixtures";

const query: SprintScopedQuery = { scope: "assignment", sprintId: "sprint-1", filters: DEFAULT_SPRINT_TASK_FILTERS, continuation: null };
const date = Date.parse("2026-01-01T09:00:00Z");
const cleanups: (() => void)[] = [];
afterEach(() => cleanups.splice(0).forEach(clear => clear()));

function receipt(id: string, options?: { matchedTotal?: number; continuation?: string; source?: string }): SprintScopedRead {
  const task = taskDetailStoryTask({ id, sprintId: "sprint-2" });
  return { readAuthority: { userId: "reader", deadline: date + 30_000 }, readActor: { profileId: "founder", platformRole: "founder" }, page: {
    scope: "assignment", sprintId: "sprint-1", items: [task], context: [], sourceRevision: options?.source || "source-1",
    matchedTotal: options?.matchedTotal || 1, scopeTotal: 30, continuation: options?.continuation || null,
    evaluatedAt: new Date(date - 1).toISOString(), validUntil: new Date(date + 60_000).toISOString(),
    unassignedTotal: null, sprintTaskCounts: null, assignmentTargetsByItemId: { [id]: ["sprint-1"] },
  } };
}

function owner(read: (query: SprintScopedQuery, signal: AbortSignal) => Promise<SprintScopedRead>,
  readProjection?: (query: SprintScopedQuery, selectionBasis: string, signal: AbortSignal) => Promise<SprintSelectedProjectionRead>, now = () => date,
  readJoint?: (query: SprintScopedQuery, token: string, signal: AbortSignal) => Promise<SprintJointRead>) {
  let generation = 1;
  const collection = createSprintCollectionReads({ read, readProjection, readJoint, publish() {}, now,
    binding: () => ({ active: true, generation, sourceEpoch: 1, sessionRevision: "session", sessionExpiresAt: Math.floor(date / 1_000) + 60,
      userId: "reader", actor: { id: "founder", platformRole: "founder" } }) });
  cleanups.push(collection.clear);
  return { ...collection, replaceSession: () => { generation += 1; } };
}

test("a late assignment search cannot replace the active search", async () => {
  const old = Promise.withResolvers<SprintScopedRead>();
  const switched = { ...query, filters: { ...query.filters, query: "new search" } };
  let abandoned: AbortSignal | undefined;
  const collection = owner((request, signal) => {
    if (request.filters.query) return Promise.resolve(receipt("current"));
    abandoned = signal;
    return old.promise;
  });
  const previous = collection.load(query);
  await expect(collection.load(switched)).resolves.toBe(true);
  expect(abandoned?.aborted).toBe(true);
  old.resolve(receipt("obsolete"));
  await expect(previous).resolves.toBe(false);
  expect(collection.view(switched).page?.items.map(item => item.id)).toEqual(["current"]);
  expect(collection.view(query).page).toBeUndefined();
});

test("candidate paging retains existing assignment choices and stops on a changed source", async () => {
  const read = vi.fn<(query: SprintScopedQuery, signal: AbortSignal) => Promise<SprintScopedRead>>()
    .mockResolvedValueOnce(receipt("first", { matchedTotal: 3, continuation: "cursor-1" }))
    .mockResolvedValueOnce(receipt("second", { matchedTotal: 3, continuation: "cursor-2" }))
    .mockResolvedValueOnce(receipt("third", { matchedTotal: 3, source: "new-source" }));
  const collection = owner(read);
  await expect(collection.load(query)).resolves.toBe(true);
  await expect(collection.load({ ...query, continuation: "wrong" })).resolves.toBe(false);
  await expect(collection.load({ ...query, continuation: "cursor-1" })).resolves.toBe(true);
  expect(collection.view(query).page?.assignmentTargetsByItemId).toEqual({ first: ["sprint-1"], second: ["sprint-1"] });
  await expect(collection.load({ ...query, continuation: "cursor-2" })).resolves.toBe(false);
  expect(collection.view(query)).toEqual({ status: "stale" });
  expect(read).toHaveBeenCalledTimes(3);
});

test("a reply after session rotation cannot establish an assignment list", async () => {
  const response = Promise.withResolvers<SprintScopedRead>();
  const collection = owner(() => response.promise);
  const pending = collection.load(query);
  collection.replaceSession();
  response.resolve(receipt("stale"));
  await expect(pending).resolves.toBe(false);
  expect(collection.view(query)).toEqual({ status: "stale" });
});

const selected: SprintScopedQuery = { ...query, scope: "selected" };
const selectedSearch: SprintScopedQuery = { ...selected, filters: { ...query.filters, query: "needle" } };
const assignmentSearch: SprintScopedQuery = { ...selectedSearch, scope: "assignment" };
const selectedTask = taskDetailStoryTask({ id: "member", sprintId: "sprint-1" });
function selectedReceipt(): SprintScopedRead {
  const item = receipt("member");
  return { ...item, selectionBasis: "signed-basis", page: { ...item.page, scope: "selected",
    items: [selectedTask], scopeTotal: 1, assignmentTargetsByItemId: {} } };
}
function projection(matchedIds = [selectedTask.id]): SprintSelectedProjectionRead {
  const full = selectedReceipt();
  return { projection: "matches", sprintId: "sprint-1", matchedIds, scopeTotal: 1, matchedTotal: matchedIds.length,
    sourceRevision: full.page.sourceRevision, evaluatedAt: full.page.evaluatedAt, validUntil: full.page.validUntil,
    readAuthority: full.readAuthority, readActor: full.readActor };
}

test("selected search applies ordered IDs from its complete document basis without a full refresh", async () => {
  const full = vi.fn(async () => selectedReceipt());
  const compact = vi.fn(async () => projection());
  const state = owner(full, compact);
  expect(state.seed(selected, { ...selectedReceipt(), page: { ...selectedReceipt().page, items: [], matchedTotal: 0 } }, [selectedTask])).toBe(true);
  await expect(state.load(selectedSearch)).resolves.toBe(true);
  expect(compact).toHaveBeenCalledExactlyOnceWith(selectedSearch, "signed-basis", expect.any(AbortSignal));
  expect(full).not.toHaveBeenCalled();
  expect(state.view(selectedSearch).page?.items).toEqual([selectedTask]);
});

test("stale projection holds one full refresh until an open assignment search settles", async () => {
  const candidate = Promise.withResolvers<SprintScopedRead>();
  const full = vi.fn((demand: SprintScopedQuery) => demand.scope === "assignment" ? candidate.promise : Promise.resolve(selectedReceipt()));
  const compact = vi.fn(async () => { throw { status: 409, code: "stale_selection_basis" }; });
  const state = owner(full, compact);
  state.seed(selected, selectedReceipt(), [selectedTask]);
  const searching = state.load(assignmentSearch);
  const filtering = state.load(selectedSearch);
  await vi.waitFor(() => expect(compact).toHaveBeenCalledTimes(1));
  expect(full.mock.calls.map(([demand]) => demand.scope)).toEqual(["assignment"]);
  candidate.resolve(receipt("candidate"));
  await expect(searching).resolves.toBe(true);
  await expect(filtering).resolves.toBe(true);
  expect(full.mock.calls.map(([demand]) => demand.scope)).toEqual(["assignment", "selected"]);
});

test.each([{ ids: ["unknown"] }, { ids: ["member", "member"] }])("unproven selected IDs never publish as matches ($ids)", async ({ ids }) => {
  const full = vi.fn(async () => selectedReceipt());
  const state = owner(full, async () => projection(ids));
  state.seed(selected, selectedReceipt(), [selectedTask]);
  await expect(state.load(selectedSearch)).resolves.toBe(false);
  expect(state.view(selectedSearch)).toEqual({ status: "unavailable" });
  expect(full).not.toHaveBeenCalled();
});

test("a cancelled selected query does not start a full refresh after the candidates arrive", async () => {
  const candidate = Promise.withResolvers<SprintScopedRead>();
  const full = vi.fn((demand: SprintScopedQuery) => demand.scope === "assignment" ? candidate.promise : Promise.resolve(selectedReceipt()));
  const compact = vi.fn(async () => { throw { status: 409, code: "stale_selection_basis" }; });
  const state = owner(full, compact);
  state.seed(selected, selectedReceipt(), [selectedTask]);
  const searching = state.load(assignmentSearch);
  const filtering = state.load(selectedSearch);
  await vi.waitFor(() => expect(compact).toHaveBeenCalledTimes(1));
  state.cancel(selectedSearch);
  await expect(filtering).resolves.toBe(false);
  candidate.resolve(receipt("candidate"));
  await expect(searching).resolves.toBe(true);
  expect(full.mock.calls.map(([demand]) => demand.scope)).toEqual(["assignment"]);
});

test("a denied projection clears both protected scopes and does not fall back to a full read", async () => {
  const full = vi.fn(async () => receipt("candidate"));
  const state = owner(full, async () => { throw { status: 403 }; });
  state.seed(selected, selectedReceipt(), [selectedTask]);
  await expect(state.load(assignmentSearch)).resolves.toBe(true);
  await expect(state.load(selectedSearch)).resolves.toBe(false);
  expect(state.view(selectedSearch)).toEqual({ status: "forbidden" });
  expect(state.view(assignmentSearch).page).toBeUndefined();
  expect(state.membership()).toBeUndefined();
  expect(full.mock.calls).toHaveLength(1);
});

test("a compact response cannot extend the original membership deadline", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(date);
  try {
    const projected = projection();
    const full = vi.fn(async () => selectedReceipt());
    const state = owner(full, async () => ({ ...projected, readAuthority: { ...projected.readAuthority, deadline: date + 59_000 } }), Date.now);
    state.seed(selected, selectedReceipt(), [selectedTask]);
    await expect(state.load(selectedSearch)).resolves.toBe(true);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(state.view(selectedSearch)).toEqual({ status: "stale" });
    expect(state.membership()).toBeUndefined();
    expect(full).not.toHaveBeenCalled();
  } finally {
    vi.useRealTimers();
  }
});

test("opening candidates during a compact request fences its subsequent full refresh", async () => {
  const compactResponse = Promise.withResolvers<SprintSelectedProjectionRead>();
  const candidate = Promise.withResolvers<SprintScopedRead>();
  const full = vi.fn((demand: SprintScopedQuery) => demand.scope === "assignment" ? candidate.promise : Promise.resolve(selectedReceipt()));
  const compact = vi.fn(() => compactResponse.promise);
  const state = owner(full, compact);
  state.seed(selected, selectedReceipt(), [selectedTask]);
  const filtering = state.load(selectedSearch);
  expect(compact).toHaveBeenCalledTimes(1);
  const searching = state.load(assignmentSearch);
  compactResponse.reject({ status: 409, code: "stale_selection_basis" });
  await new Promise<void>(resolve => setTimeout(resolve, 0));
  expect(full.mock.calls.map(([demand]) => demand.scope)).toEqual(["assignment"]);
  candidate.resolve(receipt("candidate"));
  await expect(searching).resolves.toBe(true);
  await expect(filtering).resolves.toBe(true);
  expect(full.mock.calls.map(([demand]) => demand.scope)).toEqual(["assignment", "selected"]);
});

test("a full selected refresh can proceed while another assignment query is pending", async () => {
  const candidate = Promise.withResolvers<SprintScopedRead>();
  const full = vi.fn((demand: SprintScopedQuery) => demand.scope === "assignment" ? candidate.promise : Promise.resolve(selectedReceipt()));
  const state = owner(full, async () => { throw { status: 409, code: "stale_selection_basis" }; });
  state.seed(selected, selectedReceipt(), [selectedTask]);
  const other = state.load(query);
  await expect(state.load(selectedSearch)).resolves.toBe(true);
  expect(full.mock.calls.map(([demand]) => demand.scope)).toEqual(["assignment", "selected"]);
  candidate.resolve(receipt("old-candidate"));
  await expect(other).resolves.toBe(true);
});

test("a replacement session does not wait for a matching assignment from the old session", async () => {
  const candidate = Promise.withResolvers<SprintScopedRead>();
  const full = vi.fn((demand: SprintScopedQuery) => demand.scope === "assignment" ? candidate.promise : Promise.resolve(selectedReceipt()));
  const state = owner(full);
  const searching = state.load(assignmentSearch);
  state.replaceSession();
  await expect(state.load(selectedSearch)).resolves.toBe(true);
  candidate.reject({ status: 401 });
  await expect(searching).resolves.toBe(false);
  expect(state.view(selectedSearch).page?.items).toEqual([selectedTask]);
  expect(full.mock.calls.map(([demand]) => demand.scope)).toEqual(["assignment", "selected"]);
});

test("the shared search accepts both authorized scopes from a single read with a complete selected basis", async () => {
  const full = vi.fn(async () => selectedReceipt());
  const compact = vi.fn(async () => projection());
  const joint = vi.fn(async (): Promise<SprintJointRead> => ({ ...receipt("candidate"), selected: { status: "ready", read: projection() } }));
  const state = owner(full, compact, undefined, joint);
  state.seed(selected, selectedReceipt(), [selectedTask]);
  await expect(state.loadShared(selectedSearch)).resolves.toBe(true);
  expect(joint).toHaveBeenCalledExactlyOnceWith(assignmentSearch, "signed-basis", expect.any(AbortSignal));
  expect(full).not.toHaveBeenCalled();
  expect(compact).not.toHaveBeenCalled();
  expect(state.view(selectedSearch).page?.items).toEqual([selectedTask]);
  expect(state.view(assignmentSearch).page?.items.map(item => item.id)).toEqual(["candidate"]);
});

test("a valid candidate remains current when its shared Selected projection is unavailable", async () => {
  const full = vi.fn(async () => selectedReceipt());
  const compact = vi.fn(async () => projection());
  const joint = vi.fn(async (): Promise<SprintJointRead> => ({ ...receipt("candidate"), selected: { status: "unavailable" } }));
  const state = owner(full, compact, undefined, joint);
  state.seed(selected, selectedReceipt(), [selectedTask]);
  await expect(state.loadShared(selectedSearch)).resolves.toBe(false);
  expect(state.view(selectedSearch)).toEqual({ status: "unavailable" });
  expect(state.view(assignmentSearch).page?.items.map(item => item.id)).toEqual(["candidate"]);
  expect(full).not.toHaveBeenCalled();
});

test("a shared transport failure restores the selected path separately", async () => {
  const full = vi.fn(async () => selectedReceipt());
  const compact = vi.fn(async () => projection());
  const joint = vi.fn(async (): Promise<SprintJointRead> => { throw { status: 503 }; });
  const state = owner(full, compact, undefined, joint);
  state.seed(selected, selectedReceipt(), [selectedTask]);
  await expect(state.loadShared(selectedSearch)).resolves.toBe(false);
  expect(state.view(assignmentSearch)).toEqual({ status: "unavailable" });
  expect(state.view(selectedSearch).page?.items).toEqual([selectedTask]);
  expect(compact).toHaveBeenCalledTimes(1);
  expect(full).not.toHaveBeenCalled();
});

test("a stale shared Selected basis recovers only Selected and retains the candidate result", async () => {
  const full = vi.fn(async () => selectedReceipt());
  const compact = vi.fn(async () => projection());
  const joint = vi.fn(async (): Promise<SprintJointRead> => ({ ...receipt("candidate"), selected: { status: "staleSelectionBasis" } }));
  const state = owner(full, compact, undefined, joint);
  state.seed(selected, selectedReceipt(), [selectedTask]);
  await expect(state.loadShared(selectedSearch)).resolves.toBe(true);
  expect(full).toHaveBeenCalledExactlyOnceWith(selectedSearch, expect.any(AbortSignal));
  expect(compact).not.toHaveBeenCalled();
  expect(state.view(assignmentSearch).page?.items.map(item => item.id)).toEqual(["candidate"]);
});

test("a mismatched shared timestamp cannot certify a Selected result", async () => {
  const full = vi.fn(async () => selectedReceipt());
  const compact = vi.fn(async () => projection());
  const response = receipt("candidate");
  const joint = vi.fn(async (): Promise<SprintJointRead> => ({ ...response,
    page: { ...response.page, evaluatedAt: new Date(date - 2).toISOString() }, selected: { status: "ready", read: projection() } }));
  const state = owner(full, compact, undefined, joint);
  state.seed(selected, selectedReceipt(), [selectedTask]);
  await expect(state.loadShared(selectedSearch)).resolves.toBe(false);
  expect(state.view(selectedSearch)).toEqual({ status: "unavailable" });
  expect(state.view(assignmentSearch).page?.items.map(item => item.id)).toEqual(["candidate"]);
  expect(compact).not.toHaveBeenCalled();
});

test("a shared denial withdraws both scopes without dispatching a separate read", async () => {
  const full = vi.fn(async () => selectedReceipt());
  const compact = vi.fn(async () => projection());
  const state = owner(full, compact, undefined, async () => { throw { status: 403 }; });
  state.seed(selected, selectedReceipt(), [selectedTask]);
  await expect(state.loadShared(selectedSearch)).resolves.toBe(false);
  expect(state.membership()).toBeUndefined();
  expect(state.view(selectedSearch).page).toBeUndefined();
  expect(state.view(assignmentSearch).page).toBeUndefined();
  expect(compact).not.toHaveBeenCalled();
  expect(full).not.toHaveBeenCalled();
});

test("one cancelled scope leaves the shared request alive only while the other still needs it", async () => {
  const pending = Promise.withResolvers<SprintJointRead>();
  const full = vi.fn(async () => selectedReceipt());
  const compact = vi.fn(async () => projection());
  const joint = vi.fn((_query: SprintScopedQuery, _token: string, _signal: AbortSignal) => pending.promise);
  const state = owner(full, compact, undefined, joint);
  state.seed(selected, selectedReceipt(), [selectedTask]);
  const reading = state.loadShared(selectedSearch);
  await vi.waitFor(() => expect(joint).toHaveBeenCalledTimes(1));
  const signal = joint.mock.calls[0][2];
  state.cancel(selectedSearch);
  expect(signal.aborted).toBe(false);
  state.cancel(assignmentSearch);
  expect(signal.aborted).toBe(true);
  pending.resolve({ ...receipt("candidate"), selected: { status: "ready", read: projection() } });
  await expect(reading).resolves.toBe(false);
  expect(state.view(selectedSearch).page).toBeUndefined();
  expect(state.view(assignmentSearch).page).toBeUndefined();
});

test("a partial selected basis keeps targeted reads and does not acquire a shared transport", async () => {
  const full = vi.fn(async (demand: SprintScopedQuery) => demand.scope === "assignment" ? receipt("candidate") : selectedReceipt());
  const compact = vi.fn(async () => projection());
  const joint = vi.fn(async (): Promise<SprintJointRead> => ({ ...receipt("candidate"), selected: { status: "ready", read: projection() } }));
  const state = owner(full, compact, undefined, joint);
  const basis = selectedReceipt();
  state.seed(selected, { ...basis, page: { ...basis.page, scopeTotal: 2 } }, [selectedTask]);
  await expect(state.loadShared(selectedSearch)).resolves.toBe(true);
  expect(joint).not.toHaveBeenCalled();
  expect(compact).not.toHaveBeenCalled();
  expect(full.mock.calls.map(([demand]) => demand.scope)).toEqual(["assignment", "selected"]);
});
