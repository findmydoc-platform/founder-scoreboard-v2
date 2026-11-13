import { Children, isValidElement, type ComponentProps, type ReactElement } from "react";
import { afterEach, expect, test, vi } from "vitest";
import type { PlanningWorkspaceModel } from "@/features/planning-items/model/planning-workspace-model";
import type { PlanningBoardColumnOutcome, PlanningBoardDelivery } from "@/features/planning/model/planning-board-delivery";
import { normalizePlanningBoardQuery, planningBoardQueryKey, type PlanningBoardColumn } from "@/features/planning/model/planning-board-query";
import { emptyPlanningShellState } from "@/features/planning/model/planning-shell-state";
import { taskDetailStoryTask } from "@/features/tasks/molecules/task-detail-story-fixtures";
import type { Profile, TaskStatus } from "@/lib/types";

const ports = vi.hoisted(() => ({
  authorize: vi.fn(),
  afterCallbacks: [] as Array<() => void>,
  cleanup: undefined as (() => void) | undefined,
}));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/credentials", () => ({ authorizeCredentialAction: ports.authorize }));
vi.mock("@/lib/supabase-configuration", () => ({ requiresSupabaseAuth: () => true }));
vi.mock("next/server", () => ({ after: (callback: () => void) => ports.afterCallbacks.push(callback) }));
vi.mock("@/features/planning/PlanningApp", () => ({ PlanningApp: () => null }));

import PlanningPage from "@/app/(workspaces)/planning/page";
import { PlanningApp } from "@/features/planning/PlanningApp";
import { WorkspaceDataUnavailablePage } from "@/features/planning/templates/workspace-data-unavailable-page";

type Page = ReactElement<ComponentProps<typeof PlanningApp>>;
const statuses: TaskStatus[] = ["Offen", "In Arbeit", "Review", "Nacharbeit", "Blockiert", "Erledigt", "Pausiert"];
const query = normalizePlanningBoardQuery({ view: "board", level: "deliverable", parentId: "all", filters: { query: "receipt" } });
const session = { userId: "ssr-user", revision: "original-session", expiresAt: 3_500_000_000, user: { id: "ssr-user" } };
const authority = { userId: session.userId, deadline: 3_000_000_000_000 };
const person: Profile = { id: "ssr-profile", name: "Synthetic reader", platformRole: "ceo", orgRole: "", githubLogin: "", weeklyCapacity: 40 };
const readId = "original-ssr-query";
const observedAt = "2026-11-13T12:00:00.000Z";

function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (error: Error) => void;
  let settled = false;
  const promise = new Promise<T>((accept, fail) => {
    resolve = value => { settled = true; accept(value); };
    reject = error => { settled = true; fail(error); };
  });
  return { promise, resolve, reject, settled: () => settled };
}

function unavailable(column: TaskStatus): PlanningBoardColumnOutcome {
  return { kind: "failure", readId, column, status: 503, error: "Synthetic column unavailable" };
}

function ready(column: "Offen" | "Review"): Extract<PlanningBoardColumnOutcome, { kind: "column" }> {
  const id = column === "Review" ? "selected-review-card" : "selected-open-card";
  return {
    kind: "column", readId, column, scopeRevision: "selected-source", queryRevision: "selected-query",
    observedAt, validUntil: null, cardIds: [id],
    items: [taskDetailStoryTask({ id, title: `Synthetic receipt ${column}`, status: column, detailAvailability: "summary" })],
    relationships: [], personalChildren: {}, taskOmittedFields: ["description", "definitionOfDone"],
    columnState: { total: 1, loaded: 1, availability: "ready", completeness: "complete", continuation: null },
  };
}

function fixture(empty = false, protectedBasis = false) {
  const open = deferred<PlanningBoardColumnOutcome>(), review = deferred<PlanningBoardColumnOutcome>();
  const entered = deferred<void>();
  const columns = Object.fromEntries(statuses.map(column => {
    const total = !empty && (column === "Offen" || column === "Review") ? 1 : 0;
    return [column, { total, loaded: 0, availability: total ? "not-loaded" : "ready", completeness: total ? "partial" : "complete", continuation: null } satisfies PlanningBoardColumn];
  })) as Record<TaskStatus, PlanningBoardColumn>;
  const model: PlanningWorkspaceModel = {
    revision: "workspace-revision", scopeRevision: "selected-source", query, queryRevision: "selected-query",
    project: { ...emptyPlanningShellState.project, id: "ssr-project", name: "Synthetic SSR Planning" },
    items: [], relationships: [],
    people: protectedBasis ? [person, { ...person, id: "protected-directory-marker", name: "Synthetic private directory entry" }] : [person],
    sprints: protectedBasis ? [{ id: "protected-sprint-marker", name: "Synthetic private Sprint", status: "planning", startDate: "2026-11-16", endDate: "2026-11-22", reviewDueAt: "2026-11-23", scoreLocked: false }] : [],
    preferences: protectedBasis ? [{ profileId: person.id, defaultWorkspace: "planning", defaultTaskView: "board", planningFilters: { ...query.filters, query: "protected-preference-marker" }, expandedInitiativeIds: ["protected-preference-marker"], createdAt: observedAt, updatedAt: observedAt }] : [],
    taskOmittedFields: ["description", "definitionOfDone"],
    coverage: { items: "partial", people: "complete", sprints: "complete", preferences: "complete", relationships: "partial" },
    board: {
      query, queryKey: planningBoardQueryKey(query), revision: "selected-query", observedAt, validUntil: null,
      delivery: { id: readId, columns: empty ? [] : ["Offen", "Review"] }, columns, cardIds: [],
      metrics: { total: empty ? 0 : 2, open: empty ? 0 : 2, done: 0, blocked: null },
      childProgressById: {}, attentionById: {}, viewerOpenSubIssueIdsByDeliverableId: {},
      ...(protectedBasis ? { workstreams: ["protected-workstream-marker"], initiativeOptions: [{ id: "protected-option-marker", title: "Synthetic private Initiative option" }] } : {}),
      workspaceRevision: { activeTaskCount: empty ? 0 : 2, latestUpdatedAt: "workspace-revision" },
    },
  };
  let signal: AbortSignal | undefined;
  const checkPublication = vi.fn(async (outcome: PlanningBoardColumnOutcome) => outcome);
  const abort = vi.fn();
  const loadBoard = vi.fn(() => { throw new Error("Unexpected legacy initial Board read"); });
  const startBoardQuery = vi.fn(async (_query: unknown, options?: { signal?: AbortSignal }) => {
    signal = options?.signal;
    entered.resolve();
    return { status: "ready" as const, model, delivery: {
      id: readId, abort, checkPublication,
      columns: empty ? {} : { Offen: open.promise, Review: review.promise },
    } satisfies PlanningBoardDelivery };
  });
  ports.authorize.mockImplementation(async ({ action }: { action: string }) => {
    if (action === "session.planning") return { ok: true, user: session.user, profile: person, session, authority: null };
    if (action === "planning.board.read") return { ok: true, profile: person, readAuthority: authority, readSession: session,
      planning: { startBoardQuery, loadBoard } };
    throw new Error("Unexpected credential action");
  });
  ports.cleanup = () => { open.resolve(unavailable("Offen")); review.resolve(unavailable("Review")); };
  return { open, review, entered: entered.promise, model, checkPublication, abort, loadBoard, startBoardQuery, signal: () => signal };
}

async function planningPage(): Promise<Page> {
  const result = await PlanningPage({ searchParams: Promise.resolve({ "board.level": "deliverable", "board.parentId": "all", "tasks.query": "receipt" }) });
  expect(result.type).toBe(PlanningApp);
  return result as Page;
}

function pendingDelivery(page: Page) {
  const child = Children.toArray(page.props.children).find(candidate =>
    isValidElement<{ delivery?: PlanningBoardDelivery }>(candidate) && candidate.props.delivery);
  expect(isValidElement(child), "The public page must retain its deferred server column child").toBe(true);
  return (child as ReactElement<{ delivery: PlanningBoardDelivery }>).props.delivery;
}

afterEach(() => {
  ports.cleanup?.();
  for (const callback of ports.afterCallbacks.splice(0)) callback();
  ports.cleanup = undefined;
  vi.clearAllMocks();
});

// These cases observe the public page's hydration and deferred-delivery props.
// Actual Next transport, React hydration and browser operation have separate gates.
test("Planning SSR seeds the first ready Review card while Offen remains pending on the original read", async () => {
  const controlled = fixture();
  const rendering = planningPage();
  await controlled.entered;
  expect(controlled.open.settled()).toBe(false);
  controlled.review.resolve(ready("Review"));
  const page = await rendering;

  expect(page.props.initialData.tasks.map(task => task.id)).toEqual(["selected-review-card"]);
  expect(page.props.initialData.profiles).toEqual([person]);
  expect(page.props.initialWorkspaceRead).toMatchObject({
    workspace: "planning", session, readAuthority: authority, scopeRevision: "selected-source",
    board: { cardIds: ["selected-review-card"], metrics: { total: 2, open: 2 },
      columns: { Review: { total: 1, loaded: 1, availability: "ready", completeness: "complete" }, Offen: { total: 1, loaded: 0, availability: "not-loaded" } },
      delivery: { id: readId, columns: ["Offen"] } },
  });
  const delivery = pendingDelivery(page);
  expect(Object.keys(delivery.columns)).toEqual(["Offen"]);
  expect(controlled.open.settled()).toBe(false);
  expect(controlled.checkPublication).toHaveBeenCalledWith(expect.objectContaining({ column: "Review", cardIds: ["selected-review-card"] }));
  expect(controlled.startBoardQuery).toHaveBeenCalledWith({ view: "board", level: "deliverable", parentId: "all", filters: { query: "receipt" } }, { signal: controlled.signal() });
  expect(controlled.loadBoard).not.toHaveBeenCalled();
  expect(ports.afterCallbacks).toHaveLength(1);
  expect(controlled.signal()?.aborted).toBe(false);
  controlled.open.resolve(ready("Offen"));
  await expect(delivery.columns.Offen).resolves.toMatchObject({ kind: "column", cardIds: ["selected-open-card"] });
  ports.afterCallbacks[0]();
  expect(controlled.signal()?.aborted).toBe(true);
});

test("an early rejected column returns the Planning basis and retains its independently pending sibling", async () => {
  const controlled = fixture();
  const rendering = planningPage();
  await controlled.entered;
  controlled.open.reject(new Error("Synthetic earlier hydration rejected"));
  const page = await rendering;

  expect(page.props.initialData.tasks).toEqual([]);
  expect(page.props.initialProtectedDataLoaded).toBe(true);
  expect(page.props.initialWorkspaceRead?.board?.metrics.total).toBe(2);
  expect(page.props.initialWorkspaceRead?.board?.columns.Review).toMatchObject({ total: 1, loaded: 0, availability: "not-loaded", completeness: "partial" });
  expect(controlled.review.settled()).toBe(false);
  const delivery = pendingDelivery(page);
  expect(Object.keys(delivery.columns)).toEqual(["Offen", "Review"]);
  await expect(delivery.columns.Offen).resolves.toMatchObject({ kind: "failure", column: "Offen", status: 503 });
  controlled.review.resolve(ready("Review"));
  await expect(delivery.columns.Review).resolves.toMatchObject({ kind: "column", column: "Review", cardIds: ["selected-review-card"] });
  expect(controlled.loadBoard).not.toHaveBeenCalled();
});

test("a proven empty Planning query returns complete zero-count columns without awaiting a column", async () => {
  const controlled = fixture(true);
  const page = await planningPage();

  expect(page.props.initialData.tasks).toEqual([]);
  expect(page.props.initialProtectedDataLoaded).toBe(true);
  expect(page.props.initialWorkspaceRead?.board?.cardIds).toEqual([]);
  expect(page.props.initialWorkspaceRead?.board?.metrics).toEqual({ total: 0, open: 0, done: 0, blocked: null });
  for (const status of statuses) expect(page.props.initialWorkspaceRead?.board?.columns[status]).toEqual({
    total: 0, loaded: 0, availability: "ready", completeness: "complete", continuation: null,
  });
  expect(page.props.initialWorkspaceRead?.board?.delivery).toBeUndefined();
  expect(Children.toArray(page.props.children).filter(child => isValidElement<{ delivery?: PlanningBoardDelivery }>(child) && child.props.delivery)).toEqual([]);
  expect(controlled.checkPublication).not.toHaveBeenCalled();
  expect(controlled.loadBoard).not.toHaveBeenCalled();
});

test("rejection of every selected column returns the Planning basis and handled independent failure outcomes", async () => {
  const controlled = fixture();
  const rendering = planningPage();
  await controlled.entered;
  controlled.open.reject(new Error("Synthetic Offen unavailable"));
  controlled.review.reject(new Error("Synthetic Review unavailable"));
  const page = await rendering;

  expect(page.props.initialProtectedDataLoaded).toBe(true);
  expect(page.props.initialData.tasks).toEqual([]);
  expect(page.props.initialWorkspaceRead?.board?.metrics.total).toBe(2);
  expect(page.props.initialWorkspaceRead?.board?.columns.Offen.total).toBe(1);
  expect(page.props.initialWorkspaceRead?.board?.columns.Review.total).toBe(1);
  const delivery = pendingDelivery(page);
  await expect(Promise.all([delivery.columns.Offen, delivery.columns.Review])).resolves.toEqual([
    expect.objectContaining({ kind: "failure", readId, column: "Offen", status: 503 }),
    expect.objectContaining({ kind: "failure", readId, column: "Review", status: 503 }),
  ]);
  expect(controlled.loadBoard).not.toHaveBeenCalled();
});

test.each([403, 409] as const)("Planning SSR withholds its private basis when the first publication guard returns %s", async status => {
  const controlled = fixture(false, true);
  const checking = deferred<void>(), publication = deferred<PlanningBoardColumnOutcome>();
  controlled.checkPublication.mockImplementationOnce(async () => { checking.resolve(); return publication.promise; });
  const rendering = PlanningPage({ searchParams: Promise.resolve({ "board.level": "deliverable", "board.parentId": "all", "tasks.query": "receipt" }) });
  await controlled.entered;
  const privateMarkers = ["protected-directory-marker", "protected-sprint-marker", "protected-preference-marker", "protected-workstream-marker", "protected-option-marker"];
  for (const marker of privateMarkers) expect(JSON.stringify(controlled.model)).toContain(marker);

  const first = ready("Review");
  const item = { ...first.items[0], id: "protected-item-marker", title: "Synthetic private selected Item" };
  controlled.review.resolve({ ...first, cardIds: [item.id], items: [item] });
  await checking.promise;
  expect(controlled.open.settled()).toBe(false);
  publication.resolve({ kind: "failure", readId, column: "Review", status,
    error: status === 403 ? "Synthetic authority revoked before publication" : "Synthetic source changed before publication",
    ...(status === 409 ? { code: "stale_continuation" } : {}),
  });
  const page = await rendering;

  expect(page.type).toBe(WorkspaceDataUnavailablePage);
  expect(page.props).toMatchObject({ workspace: "planning" });
  expect(page.props).not.toHaveProperty("initialData");
  expect(page.props).not.toHaveProperty("initialWorkspaceRead");
  expect(page.props).not.toHaveProperty("children");
  for (const marker of [...privateMarkers, "protected-item-marker"]) expect(JSON.stringify(page.props)).not.toContain(marker);
  expect(controlled.abort).toHaveBeenCalledOnce();
  expect(controlled.loadBoard).not.toHaveBeenCalled();
});
