import type { User } from "@supabase/supabase-js";
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { useEffect, useState } from "react";
import { expect, userEvent, waitFor, within } from "storybook/test";
import { PlanningApp } from "./PlanningApp";
import { PlanningStateProvider } from "./organisms/planning-state-provider";
import { emptyPlanningShellState } from "./model/planning-shell-state";
import { emptyPlanningHeaderData } from "@/lib/planning-header-data";
import { taskDetailStoryTask } from "@/features/tasks/molecules/task-detail-story-fixtures";
import type { Profile, TaskStatus } from "@/lib/types";
import { productUpdates } from "@/features/product-updates/model/product-update-registry";
import { mockAccountLifecycle } from "../../../tests/helpers/account-lifecycle-browser-fixture";
import { planningWorkspaceHydration } from "./model/planning-workspace-hydration";
import { normalizePlanningBoardQuery, planningBoardQueryKey, type PlanningBoardColumn, type PlanningBoardQueryInput } from "./model/planning-board-query";
import { taskStatuses } from "@/lib/status";
import { normalizeStatus } from "@/lib/status";
import { buildPlanningTaskTableViewModel } from "./model/planning-task-table-view-model";
import { sortTaskTableRows, type TaskTableSort } from "@/features/tasks/model/task-table-view-model";
import { taskPlanningAttentionSignals } from "@/features/tasks/model/task-attention-signals";
import { hasOpenWaitingRelation, taskRelationsFor } from "@/lib/platform";
import { isTaskPlanningActive } from "./model/approval-domain";
import type { PlanningWorkspaceModel } from "@/features/planning-items/model/planning-workspace-model";

const profile: Profile = { id: "history-person", name: "History Person", platformRole: "ceo", orgRole: "CEO", githubLogin: "history-person", weeklyCapacity: 40 };
const user = { id: "history-user", email: "history@example.com" } as User;
const session = { user, userId: user.id, revision: "history-session", expiresAt: Math.floor(Date.now() / 1000) + 3600 };
const initiative = taskDetailStoryTask({ id: "history-parent", title: "Historical parent context", taskType: "initiative" });
const sprint = { id: "history-sprint", name: "Historical Sprint", startDate: "2026-11-01", endDate: "2026-11-14", reviewDueAt: "", scoreLocked: false, status: "planning" as const };
const active = taskDetailStoryTask({ id: "history-active", title: "Active work stays visible", status: "Offen", assigneeId: profile.id, ownerId: profile.id, parentTaskId: initiative.id, sprintId: sprint.id });
const completed = Array.from({ length: 25 }, (_, index) => taskDetailStoryTask({ id: `history-${index}`, title: `Completed work ${index + 1}`, status: "Erledigt", updatedAt: "2026-11-01T00:00:00Z", order: index, assigneeId: profile.id, ownerId: profile.id, parentTaskId: initiative.id, sprintId: sprint.id }));
function page(input: PlanningBoardQueryInput = {}) {
  const query = normalizePlanningBoardQuery(input);
  const cards = input.continuation ? completed.slice(20) : [active, ...completed.slice(0, 20)];
  const columns = Object.fromEntries([...taskStatuses, "Pausiert"].map(status => [status, { total: status === "Erledigt" ? 25 : status === "Offen" ? 1 : 0, loaded: cards.filter(task => task.status === status).length, completeness: status === "Erledigt" && !input.continuation ? "partial" : "complete", continuation: status === "Erledigt" && !input.continuation ? "next-history-page" : null } satisfies PlanningBoardColumn])) as Record<TaskStatus, PlanningBoardColumn>;
  return { revision: "history-r1", scopeRevision: "history-source", queryRevision: "history-r1", query, project: emptyPlanningShellState.project, items: [initiative, ...cards], people: [profile], sprints: [sprint], relationships: [], blockers: [], preferences: [], coverage: { items: "partial", people: "complete", strategies: "complete", raci: "complete", links: "complete", sprints: "complete", relationships: "complete", blockers: "complete", preferences: "complete" } as const,
    board: { query, column: input.column || (input.continuation ? "Erledigt" : undefined), queryKey: planningBoardQueryKey(query), revision: "history-r1", observedAt: "2026-11-07T00:00:00Z", cardIds: cards.map(task => task.id), childProgressById: {}, columns, metrics: { total: 26, open: 1, blocked: 0, done: 25 }, viewerOpenSubIssueIdsByDeliverableId: {}, workspaceRevision: { activeTaskCount: 26, latestUpdatedAt: "history-r1" } },
  };
}
const completeFixture = { ...emptyPlanningShellState, tasks: [initiative, active, ...completed], profiles: [profile], sprints: [sprint] };
function tablePage(input: PlanningBoardQueryInput): PlanningWorkspaceModel {
  const query = normalizePlanningBoardQuery(input);
  const filtered = buildPlanningTaskTableViewModel({ currentProfile: profile, data: completeFixture, filters: query.filters });
  const rows = sortTaskTableRows({ tasks: filtered.visibleTasks.filter(task => task.taskType === "deliverable" && isTaskPlanningActive(task)), profiles: [profile], sprints: [sprint], sort: query.filters.sort as TaskTableSort, direction: query.filters.direction });
  const offset = input.continuation ? 20 : 0, selected = rows.slice(offset, offset + 20), next = offset + selected.length;
  return { revision: "history-r1", scopeRevision: "history-source", queryRevision: "history-r1", query, project: completeFixture.project,
    items: [initiative, ...selected], people: [profile], sprints: [sprint], relationships: [], blockers: [], preferences: [],
    coverage: { items: "partial", people: "complete", sprints: "complete", preferences: "complete", strategies: "partial", raci: "partial", links: "partial", relationships: "partial", blockers: "partial" },
    table: { query, queryKey: planningBoardQueryKey(query), revision: "history-r1", observedAt: "2026-11-07T00:00:00Z", validUntil: null, rowIds: selected.map(task => task.id),
      page: { total: rows.length, loaded: selected.length, completeness: next >= rows.length ? "complete" : "partial", continuation: next < rows.length ? "next-table-history-page" : null },
      metrics: { total: rows.length, open: rows.filter(task => normalizeStatus(task.status) !== "Erledigt").length, done: rows.filter(task => normalizeStatus(task.status) === "Erledigt").length, blocked: rows.filter(task => normalizeStatus(task.status) === "Blockiert" || Boolean(task.dependsOn) || hasOpenWaitingRelation(task.id, completeFixture.tasks, completeFixture.taskRelations)).length },
      statusOptions: Array.from(new Set(completeFixture.tasks.map(task => normalizeStatus(task.status)))), initiativeOptions: [{ id: initiative.id, title: initiative.title }],
      workstreams: Array.from(new Set(completeFixture.tasks.map(task => task.workstream).filter(Boolean))).sort((left, right) => left.localeCompare(right, "de")), summaryRequests: [],
      // These values have a complete fixture foundation. Independent delayed
      // risk transport has its own actual-browser/API stories and SQL tests.
      risksById: Object.fromEntries(selected.map(task => { const groups = taskRelationsFor(task.id, completeFixture.taskRelations); return [task.id, { attention: taskPlanningAttentionSignals(task, completeFixture), waitsOn: groups.waitsOn.length, blocks: groups.blocks.length, hasOpenWait: hasOpenWaitingRelation(task.id, completeFixture.tasks, completeFixture.taskRelations) }]; })),
      workspaceRevision: { activeTaskCount: 27, latestUpdatedAt: "history-r1" } },
  };
}
const initial = page();
function CompletedHistoryFlow({ failCompleteRead = false, delayCompleteRead = false }: { failCompleteRead?: boolean; delayCompleteRead?: boolean }) {
  const [ready, setReady] = useState(false);
  const [reads, setReads] = useState(0);
  const [releaseCompleteRead, setReleaseCompleteRead] = useState<(() => void) | null>(null);
  useEffect(() => {
    const seenKey = `founderops.product-updates.seen.${profile.id}`;
    const previous = localStorage.getItem(seenKey);
    localStorage.setItem(seenKey, JSON.stringify(productUpdates.map(update => update.id)));
    let attempts = 0;
    let completeAttempts = 0;
    const restore = mockAccountLifecycle("google", { linked: true }, input => {
      const url = new URL(String(input), "http://localhost:3000");
      if (url.pathname === "/api/auth/session") return Response.json({ session });
      if (url.pathname === "/api/planning-board-data") {
        setReads(value => value + 1);
        const query = JSON.parse(url.searchParams.get("scope") || "{}");
        if (query.view === "complete" || query.view === "table") {
          const response = () => Response.json({ readAuthority: { userId: session.userId, deadline: session.expiresAt * 1000 }, model: query.view === "table" ? tablePage(query) : { ...page(query), board: undefined, items: completeFixture.tasks, coverage: { ...initial.coverage, items: "complete" } }, currentProfile: profile });
          if (!query.continuation && failCompleteRead && ++completeAttempts === 1) return Response.json({ error: "Alternative view unavailable" }, { status: 503 });
          if (!query.continuation && delayCompleteRead) return new Promise<Response>(resolve => { setReleaseCompleteRead(() => () => { resolve(response()); setReleaseCompleteRead(null); }); });
          return response();
        }
        if (query.continuation && ++attempts === 1) return Response.json({ error: "History unavailable" }, { status: 503 });
        return Response.json({ readAuthority: { userId: session.userId, deadline: session.expiresAt * 1000 }, model: page(query), currentProfile: profile });
      }
      if (url.pathname === "/api/planning-revision") return Response.json({ revision: initial.board.workspaceRevision });
      if (url.pathname === "/api/planning-source-version") return Response.json({ version: "history-source" });
      if (url.pathname === "/api/github-app/status") return Response.json({ installation: { available: false }, user: { connected: false } });
      if (url.pathname === "/api/team/platform-releases/v1/releases") return Response.json({ releases: [] });
      return Response.json({ error: "Optional data unavailable" }, { status: 503 });
    });
    queueMicrotask(() => setReady(true));
    return () => { restore(); if (previous === null) localStorage.removeItem(seenKey); else localStorage.setItem(seenKey, previous); };
  }, [failCompleteRead, delayCompleteRead]);
  return <><output aria-label="History reads">{reads}</output>{releaseCompleteRead ? <button onClick={releaseCompleteRead}>Ansichtsantwort freigeben</button> : null}{ready ? <PlanningStateProvider><PlanningApp initialWorkspace="planning" initialWorkspaceRead={planningWorkspaceHydration("planning", initial, session, { userId: session.userId, deadline: session.expiresAt * 1000 })} initialData={{ ...emptyPlanningShellState, tasks: initial.items, profiles: [profile], sprints: [sprint] }} initialHeaderData={emptyPlanningHeaderData} initialAuthUser={user} initialCurrentProfile={profile} initialProtectedDataLoaded authRequired source="supabase" /></PlanningStateProvider> : null}</>;
}
const meta = {
  title: "Planning/Completed history flow",
  component: CompletedHistoryFlow,
  // View modules are prerequisites for the data retention and query interactions below.
  loaders: [async () => {
    await Promise.all([
      import("@/features/tasks/organisms/task-table-view"),
      import("@/features/tasks/organisms/task-structure-view"),
      import("@/features/tasks/organisms/gantt-view"),
    ]);
    return {};
  }],
  parameters: { layout: "fullscreen", nextjs: { appDirectory: true, navigation: { pathname: "/planning" } } },
} satisfies Meta<typeof CompletedHistoryFlow>;
export default meta;
type Story = StoryObj<typeof meta>;
async function revealLastTablePage(canvas: ReturnType<typeof within>) {
  const more = await canvas.findByRole("button", { name: "Weitere Aufgaben laden" });
  await expect(canvas.queryByRole("link", { name: "Completed work 25" })).not.toBeInTheDocument();
  await userEvent.click(more);
  await canvas.findByRole("link", { name: "Completed work 25" });
}
export const InitialCompletedHistory: Story = {};
export const HistoryLoadsAndRetriesWithinItsColumn: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const board = await canvas.findByRole("region", { name: "Board nach Status" });
    const completedColumn = within(board).getByRole("region", { name: /Erledigt, 25/ });
    await expect(within(completedColumn).getByText("20 von 25 geladen")).toBeVisible();
    await expect(canvas.getByLabelText("History reads")).toHaveTextContent("0");
    const loadMore = within(completedColumn).getByRole("button", { name: "Weitere erledigte laden" });
    loadMore.focus();
    await userEvent.keyboard("[Enter]");
    await waitFor(() => expect(within(completedColumn).getByRole("button", { name: "Erledigte erneut laden" })).toBeVisible());
    await expect(within(board).getByText("Active work stays visible")).toBeVisible();
    await expect(within(completedColumn).getByRole("button", { name: "Erledigte erneut laden" })).toHaveFocus();
    await userEvent.click(within(completedColumn).getByRole("button", { name: "Erledigte erneut laden" }));
    await waitFor(() => expect(within(completedColumn).getByText("25 von 25 geladen")).toBeVisible());
    await expect(within(completedColumn).getByText("Completed work 25")).toBeVisible();
    await expect(canvas.getByLabelText("History reads")).toHaveTextContent("2");
  },
};

export const AlternativeViewsRetainBoardPages: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await canvas.findByRole("region", { name: "Board nach Status" });
    await userEvent.click(canvas.getByRole("button", { name: "Tabelle" }));
    await revealLastTablePage(canvas);
    await expect(canvas.getByLabelText("History reads")).toHaveTextContent("2");
    await userEvent.click(canvas.getByRole("button", { name: "Board" }));
    await waitFor(() => expect(canvas.getByText("20 von 25 geladen")).toBeVisible());
    await expect(canvas.getByLabelText("History reads")).toHaveTextContent("2");
    await expect(canvas.queryByRole("link", { name: "Completed work 25" })).not.toBeInTheDocument();
    await userEvent.click(canvas.getByRole("button", { name: "Weitere erledigte laden" }));
    await userEvent.click(await canvas.findByRole("button", { name: "Erledigte erneut laden" }));
    await waitFor(() => expect(canvas.getByText("25 von 25 geladen")).toBeVisible());
    for (const label of ["Struktur", "Gantt", "Tabelle"]) {
      await userEvent.click(canvas.getByRole("button", { name: label }));
      if (label === "Struktur") await userEvent.click(await canvas.findByRole("button", { name: "Alle ausklappen" }));
      await expect(await canvas.findByRole("link", { name: "Completed work 25" })).toBeVisible();
      if (label === "Gantt") {
        await expect(canvas.getByRole("link", { name: "Completed work 25 · 14 Tage" })).toHaveAttribute("title", "Completed work 25 · Historical parent context");
      }
      await userEvent.click(canvas.getByRole("button", { name: "Board" }));
      await expect(await canvas.findByText("25 von 25 geladen")).toBeVisible();
      await expect(canvas.getByRole("link", { name: "Completed work 25" })).toBeVisible();
      await expect(canvas.getByLabelText("History reads")).toHaveTextContent("5");
    }
  },
};

export const FailedAlternativeViewKeepsBoardUsable: Story = {
  args: { failCompleteRead: true },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const board = await canvas.findByRole("region", { name: "Board nach Status" });
    await userEvent.click(canvas.getByRole("button", { name: "Tabelle" }));
    const attribution = await canvas.findByRole("status", { name: "Vorherige Suchergebnisse" });
    await waitFor(() => expect(attribution).toHaveTextContent("Vorherige Suche: ohne Suchtext. Neue Ergebnisse konnten nicht geladen werden."));
    await expect(canvas.getByRole("button", { name: "Ansicht erneut laden" })).toBeEnabled();
    await expect(board).toBeVisible();
    await expect(within(board).getByRole("link", { name: "Active work stays visible" })).toBeVisible();
    await expect(within(board).getByText("20 von 25 geladen")).toBeVisible();
    await expect(canvas.queryByRole("table")).not.toBeInTheDocument();
    await expect(canvas.queryByRole("link", { name: "Completed work 25" })).not.toBeInTheDocument();
    await expect(canvas.getByLabelText("History reads")).toHaveTextContent("1");
    await userEvent.click(canvas.getByRole("button", { name: "Board" }));
    await expect(await canvas.findByText("20 von 25 geladen")).toBeVisible();
    await expect(canvas.queryByRole("status", { name: "Vorherige Suchergebnisse" })).not.toBeInTheDocument();
    await expect(canvas.getByLabelText("History reads")).toHaveTextContent("1");
    await userEvent.click(canvas.getByRole("button", { name: "Tabelle" }));
    await revealLastTablePage(canvas);
    await expect(canvas.queryByRole("region", { name: "Board nach Status" })).not.toBeInTheDocument();
    await expect(canvas.queryByRole("status", { name: "Vorherige Suchergebnisse" })).not.toBeInTheDocument();
    await expect(canvas.getByLabelText("History reads")).toHaveTextContent("3");
  },
};

export const DelayedAlternativeViewCannotReplaceReturnedBoard: Story = {
  args: { delayCompleteRead: true },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const board = await canvas.findByRole("region", { name: "Board nach Status" });
    await userEvent.click(canvas.getByRole("button", { name: "Gantt" }));
    await expect(await canvas.findByRole("status", { name: "Vorherige Suchergebnisse" })).toHaveTextContent("Vorherige Suche: ohne Suchtext. Neue Ergebnisse werden geladen …");
    await canvas.findByRole("button", { name: "Ansichtsantwort freigeben" });
    await expect(board).toBeVisible();
    await expect(within(board).getByRole("link", { name: "Active work stays visible" })).toBeVisible();
    await expect(within(board).getByText("20 von 25 geladen")).toBeVisible();
    await expect(canvas.queryByRole("link", { name: "Active work stays visible · 14 Tage" })).not.toBeInTheDocument();
    await expect(canvas.queryByRole("link", { name: "Completed work 25" })).not.toBeInTheDocument();
    await userEvent.click(canvas.getByRole("button", { name: "Board" }));
    await expect(await canvas.findByText("20 von 25 geladen")).toBeVisible();
    await waitFor(() => expect(canvas.queryByRole("status", { name: "Vorherige Suchergebnisse" })).not.toBeInTheDocument());
    await userEvent.click(canvas.getByRole("button", { name: "Ansichtsantwort freigeben" }));
    await waitFor(() => expect(canvas.queryByRole("button", { name: "Ansichtsantwort freigeben" })).not.toBeInTheDocument());
    await expect(canvas.getByText("20 von 25 geladen")).toBeVisible();
    await expect(canvas.queryByRole("link", { name: "Completed work 25" })).not.toBeInTheDocument();
    await expect(canvas.getByLabelText("History reads")).toHaveTextContent("1");
    // Obsolete success must not establish reusable complete coverage for a new Table demand.
    await userEvent.click(canvas.getByRole("button", { name: "Tabelle" }));
    await canvas.findByRole("button", { name: "Ansichtsantwort freigeben" });
    await expect(canvas.getByRole("status", { name: "Vorherige Suchergebnisse" })).toBeVisible();
    await expect(canvas.queryByRole("link", { name: "Completed work 25" })).not.toBeInTheDocument();
    await expect(canvas.getByLabelText("History reads")).toHaveTextContent("2");
    await userEvent.click(canvas.getByRole("button", { name: "Ansichtsantwort freigeben" }));
    await revealLastTablePage(canvas);
    await expect(canvas.queryByRole("region", { name: "Board nach Status" })).not.toBeInTheDocument();
    await expect(canvas.queryByRole("status", { name: "Vorherige Suchergebnisse" })).not.toBeInTheDocument();
    await userEvent.click(canvas.getByRole("button", { name: "Board" }));
    await expect(await canvas.findByText("20 von 25 geladen")).toBeVisible();
    await expect(canvas.getByLabelText("History reads")).toHaveTextContent("3");
  },
};

export const CompleteViewSearchKeepsDeliverableBehavior: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await canvas.findByRole("region", { name: "Board nach Status" });
    await userEvent.click(canvas.getByRole("button", { name: "Tabelle" }));
    await revealLastTablePage(canvas);
    const search = canvas.getByRole("searchbox", { name: "Aufgaben durchsuchen" });
    await userEvent.type(search, "Completed work 25");
    await expect(await canvas.findByRole("link", { name: "Completed work 25" })).toBeVisible();
    await waitFor(() => expect(canvas.queryByRole("link", { name: "Completed work 1" })).not.toBeInTheDocument());
    await userEvent.clear(search);
    await userEvent.type(search, "No matching Deliverable");
    await waitFor(() => expect(canvas.getAllByText("Keine Aufgaben für diese Filter.").some(element => element.getClientRects().length > 0)).toBe(true));
    await expect(canvas.queryByRole("link", { name: "Historical parent context" })).not.toBeInTheDocument();
    await expect(canvas.getByLabelText("History reads")).toHaveTextContent("4");
    await userEvent.clear(search);
    await expect(await canvas.findByRole("link", { name: "Completed work 25" })).toBeVisible();
    await expect(canvas.getByLabelText("History reads")).toHaveTextContent("4");
  },
};
