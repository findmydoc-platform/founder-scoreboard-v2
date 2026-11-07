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
  return { revision: "history-r1", queryRevision: "history-r1", query, project: emptyPlanningShellState.project, items: [initiative, ...cards], people: [profile], sprints: [sprint], relationships: [], blockers: [], preferences: [], coverage: { items: "partial", people: "complete", strategies: "complete", raci: "complete", links: "complete", sprints: "complete", relationships: "complete", blockers: "complete", preferences: "complete" } as const,
    board: { query, queryKey: planningBoardQueryKey(query), revision: "history-r1", observedAt: "2026-11-07T00:00:00Z", cardIds: cards.map(task => task.id), childProgressById: {}, columns, metrics: { total: 26, open: 1, blocked: 0, done: 25 }, viewerOpenSubIssueIdsByDeliverableId: {}, workspaceRevision: { activeTaskCount: 26, latestUpdatedAt: "history-r1" } },
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
        if (query.view === "complete") {
          const response = () => Response.json({ model: { ...page(query), board: undefined, items: [initiative, active, ...completed], coverage: { ...initial.coverage, items: "complete" } }, currentProfile: profile });
          if (failCompleteRead && ++completeAttempts === 1) return Response.json({ error: "Complete view unavailable" }, { status: 503 });
          if (delayCompleteRead) return new Promise<Response>(resolve => { setReleaseCompleteRead(() => () => { resolve(response()); setReleaseCompleteRead(null); }); });
          return response();
        }
        if (query.continuation && ++attempts === 1) return Response.json({ error: "History unavailable" }, { status: 503 });
        return Response.json({ model: page(query), currentProfile: profile });
      }
      if (url.pathname === "/api/planning-revision") return Response.json({ revision: initial.board.workspaceRevision });
      if (url.pathname === "/api/github-app/status") return Response.json({ installation: { available: false }, user: { connected: false } });
      if (url.pathname === "/api/team/platform-releases/v1/releases") return Response.json({ releases: [] });
      return Response.json({ error: "Optional data unavailable" }, { status: 503 });
    });
    queueMicrotask(() => setReady(true));
    return () => { restore(); if (previous === null) localStorage.removeItem(seenKey); else localStorage.setItem(seenKey, previous); };
  }, [failCompleteRead, delayCompleteRead]);
  return <><output aria-label="History reads">{reads}</output>{releaseCompleteRead ? <button onClick={releaseCompleteRead}>Ansichtsantwort freigeben</button> : null}{ready ? <PlanningStateProvider><PlanningApp initialWorkspace="planning" initialWorkspaceRead={planningWorkspaceHydration("planning", initial, session)} initialData={{ ...emptyPlanningShellState, tasks: initial.items, profiles: [profile], sprints: [sprint] }} initialHeaderData={emptyPlanningHeaderData} initialAuthUser={user} initialCurrentProfile={profile} initialProtectedDataLoaded authRequired source="supabase" /></PlanningStateProvider> : null}</>;
}
const meta = { title: "Planning/Completed history flow", component: CompletedHistoryFlow, parameters: { layout: "fullscreen", nextjs: { appDirectory: true, navigation: { pathname: "/planning" } } } } satisfies Meta<typeof CompletedHistoryFlow>;
export default meta;
type Story = StoryObj<typeof meta>;
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
    await waitFor(() => expect(canvas.getByRole("link", { name: "Completed work 25" })).toBeVisible());
    await expect(canvas.getByLabelText("History reads")).toHaveTextContent("1");
    await userEvent.click(canvas.getByRole("button", { name: "Board" }));
    await waitFor(() => expect(canvas.getByText("20 von 25 geladen")).toBeVisible());
    await expect(canvas.getByLabelText("History reads")).toHaveTextContent("1");
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
      await expect(canvas.getByLabelText("History reads")).toHaveTextContent("3");
    }
  },
};

export const FailedAlternativeViewKeepsBoardUsable: Story = {
  args: { failCompleteRead: true },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await canvas.findByRole("region", { name: "Board nach Status" });
    await userEvent.click(canvas.getByRole("button", { name: "Tabelle" }));
    await expect(await canvas.findByText("Diese Ansicht konnte nicht geladen werden.")).toBeVisible();
    await expect(canvas.queryByRole("link", { name: "Active work stays visible" })).not.toBeInTheDocument();
    await userEvent.click(canvas.getByRole("button", { name: "Board" }));
    await expect(await canvas.findByText("20 von 25 geladen")).toBeVisible();
    await expect(canvas.getByLabelText("History reads")).toHaveTextContent("1");
    await userEvent.click(canvas.getByRole("button", { name: "Tabelle" }));
    await expect(await canvas.findByRole("link", { name: "Completed work 25" })).toBeVisible();
  },
};

export const DelayedAlternativeViewCannotReplaceReturnedBoard: Story = {
  args: { delayCompleteRead: true },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await canvas.findByRole("region", { name: "Board nach Status" });
    await userEvent.click(canvas.getByRole("button", { name: "Gantt" }));
    await expect(await canvas.findByText("Planung wird geladen …")).toBeVisible();
    await expect(canvas.queryByRole("link", { name: "Active work stays visible" })).not.toBeInTheDocument();
    await userEvent.click(canvas.getByRole("button", { name: "Board" }));
    await expect(await canvas.findByText("20 von 25 geladen")).toBeVisible();
    await userEvent.click(canvas.getByRole("button", { name: "Ansichtsantwort freigeben" }));
    await waitFor(() => expect(canvas.queryByRole("button", { name: "Ansichtsantwort freigeben" })).not.toBeInTheDocument());
    await expect(canvas.getByText("20 von 25 geladen")).toBeVisible();
    await expect(canvas.queryByRole("link", { name: "Completed work 25" })).not.toBeInTheDocument();
    await expect(canvas.getByLabelText("History reads")).toHaveTextContent("1");
  },
};

export const CompleteViewSearchKeepsDeliverableBehavior: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await canvas.findByRole("region", { name: "Board nach Status" });
    await userEvent.click(canvas.getByRole("button", { name: "Tabelle" }));
    await canvas.findByRole("link", { name: "Completed work 25" });
    const search = canvas.getByRole("searchbox", { name: "Aufgaben durchsuchen" });
    await userEvent.type(search, "Completed work 25");
    await expect(await canvas.findByRole("link", { name: "Completed work 25" })).toBeVisible();
    await waitFor(() => expect(canvas.queryByRole("link", { name: "Completed work 1" })).not.toBeInTheDocument());
    await userEvent.clear(search);
    await userEvent.type(search, "No matching Deliverable");
    await waitFor(() => expect(canvas.getAllByText("Keine Aufgaben für diese Filter.").some(element => element.getClientRects().length > 0)).toBe(true));
    await expect(canvas.queryByRole("link", { name: "Historical parent context" })).not.toBeInTheDocument();
    await userEvent.clear(search);
    await expect(await canvas.findByRole("link", { name: "Completed work 25" })).toBeVisible();
    await expect(canvas.getByLabelText("History reads")).toHaveTextContent("1");
  },
};
