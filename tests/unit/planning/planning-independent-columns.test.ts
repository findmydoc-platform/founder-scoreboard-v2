import { expect, test } from "vitest";
import { createPlanningState, type PlanningWorkspaceRead } from "@/features/planning/model/internal/planning-state-owner";
import { normalizePlanningBoardQuery, planningBoardQueryKey, type PlanningBoardColumn } from "@/features/planning/model/planning-board-query";
import { emptyPlanningShellState } from "@/features/planning/model/planning-shell-state";
import type { TaskStatus } from "@/lib/types";
import { taskDetailStoryTask } from "@/features/tasks/molecules/task-detail-story-fixtures";

const query = normalizePlanningBoardQuery();
const open = taskDetailStoryTask({ id: "open", status: "Offen" });
const review = taskDetailStoryTask({ id: "review", status: "Review" });
const data = { ...emptyPlanningShellState, tasks: [open] };
function response(column: TaskStatus): PlanningWorkspaceRead {
  const cards = column === "Offen" ? [open] : column === "Review" ? [review] : [];
  const columns = Object.fromEntries(["Offen", "In Arbeit", "Review", "Nacharbeit", "Blockiert", "Erledigt", "Pausiert"].map(status => [status, { total: status === column ? cards.length : null, loaded: status === column ? cards.length : 0, availability: status === column ? "ready" : "not-loaded", completeness: status === column ? "complete" : "partial", continuation: null } satisfies PlanningBoardColumn])) as Record<TaskStatus, PlanningBoardColumn>;
  return { data: { ...data, tasks: cards }, query, taskCoverage: "partial", coverage: { tasks: "partial" }, board: { query, column, queryKey: planningBoardQueryKey(query), revision: "source-1", observedAt: "2026-11-13T12:00:00Z", cardIds: cards.map(card => card.id), columns, childProgressById: Object.fromEntries(cards.map(card => [card.id, null])), attentionById: Object.fromEntries(cards.map(card => [card.id, null])), metrics: { total: 2, open: 2, done: 0, blocked: 0 }, viewerOpenSubIssueIdsByDeliverableId: {}, workspaceRevision: { activeTaskCount: 2, latestUpdatedAt: "source-1" } } };
}

test("an unloaded column has its own first-page demand and failure leaves the ready column usable", async () => {
  const reads: unknown[] = [];
  let failed = true;
  const state = createPlanningState({ userId: "reader", initialData: data, adapter: {
    saveTask: async task => ({ task }),
    readWorkspace: async (_workspace, input) => {
      reads.push(input);
      if (input?.column === "Review" && failed) throw new Error("Review unavailable");
      return response(input?.column || "Offen");
    },
  } }).planning;
  await state.ensureBoardQuery(query);
  expect(state.board().columnReadStatus?.Review).toBe("not-loaded");
  expect(await state.loadBoardColumn("Review")).toBe(false);
  expect(state.board().tasks.map(task => task.id)).toEqual(["open"]);
  expect(state.board().columnReadStatus?.Review).toBe("unavailable");
  failed = false;
  expect(await state.refreshBoardColumn("Review")).toBe(true);
  expect(state.board().tasks.map(task => task.id)).toEqual(["open", "review"]);
  expect(reads).toHaveLength(3);
  expect(state.board().result?.childProgressById.review).toBeNull();
});

test("a newly proven empty earlier column waits until the active card interaction ends", async () => {
  let finish!: (result: PlanningWorkspaceRead) => void;
  const pending = new Promise<PlanningWorkspaceRead>(resolve => { finish = resolve; });
  const state = createPlanningState({ userId: "reader", initialData: data, adapter: {
    saveTask: async task => ({ task }),
    readWorkspace: async (_workspace, input) => input?.column === "In Arbeit" ? pending : response(input?.column || "Offen"),
  } }).planning;
  await state.ensureBoardQuery(query);
  await state.loadBoardColumn("Review");
  const release = state.beginBoardInteraction();
  const earlier = state.loadBoardColumn("In Arbeit");
  finish(response("In Arbeit"));
  await new Promise(resolve => setTimeout(resolve, 0));
  expect(state.board().result?.columns["In Arbeit"].availability).toBe("not-loaded");
  expect(state.board().tasks.map(task => task.id)).toEqual(["open", "review"]);
  release();
  expect(await earlier).toBe(true);
  expect(state.board().result?.columns["In Arbeit"]).toMatchObject({ availability: "ready", total: 0 });
});

test.each(["before", "after"] as const)("a later column receipt delivered %s the first deadline and unchanged source evidence cannot renew earlier protected cards", async delivery => {
  const epoch = Date.parse("2026-11-13T12:00:00Z");
  let now = epoch, contentReads = 0, versionReads = 0;
  let finish!: (result: PlanningWorkspaceRead) => void;
  const later = new Promise<PlanningWorkspaceRead>(resolve => { finish = resolve; });
  const providerExpiresAt = Math.floor((epoch + 3_600_000) / 1000);
  const state = createPlanningState({ userId: "reader", initialData: data,
    initialSession: { userId: "reader", user: { id: "reader" }, revision: "same-provider-session", expiresAt: providerExpiresAt },
    initialCurrentProfile: { id: "reader", name: "Synthetic Reader", platformRole: "founder", githubLogin: "" },
    adapter: { now: () => now, saveTask: async task => ({ task }),
      readPlanningSourceVersion: async () => { versionReads++; return "42"; },
      readWorkspace: async (_workspace, input) => {
        contentReads++;
        return input?.column === "Review" ? later : { ...response("Offen"), scopeRevision: "42", readAuthority: { userId: "reader", deadline: epoch + 1000 } };
      },
    },
  }).planning;
  expect(await state.ensureBoardQuery(query)).toBe(true);
  now = epoch + 100;
  const second = state.loadBoardColumn("Review");
  if (delivery === "before") {
    now = epoch + 200;
    finish({ ...response("Review"), scopeRevision: "42", readAuthority: { userId: "reader", deadline: epoch + 5000 } });
    expect(await second).toBe(true);
    expect(state.board().tasks.map(task => task.id)).toEqual(["open", "review"]);
  }
  now = epoch + 999;
  expect(await state.checkPlanningSource()).toBe("unchanged");
  expect(state.board().tasks.some(task => task.id === "open")).toBe(true);
  now = epoch + 1000;
  if (delivery === "after") {
    finish({ ...response("Review"), scopeRevision: "42", readAuthority: { userId: "reader", deadline: epoch + 5000 } });
    expect(await second).toBe(false);
  }
  expect(state.board().tasks).toEqual([]);
  expect(state.workspace("planning").tasks).toEqual([]);
  expect(state.currentProfile()?.id).toBe("reader");
  expect(providerExpiresAt * 1000).toBeGreaterThan(now + 3_000_000);
  expect({ contentReads, versionReads }).toEqual({ contentReads: 2, versionReads: 1 });
});
