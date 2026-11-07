import type { User } from "@supabase/supabase-js";
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { useEffect, useState } from "react";
import { expect, fireEvent, userEvent, waitFor, within } from "storybook/test";
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
const active = taskDetailStoryTask({ id: "history-active", title: "Active work stays visible", status: "Blockiert", priority: "P0", order: 10, assigneeId: profile.id, ownerId: profile.id });
const completed = ["Offen", "Review", "Erledigt"].flatMap(status => Array.from({ length: 25 }, (_, index) => taskDetailStoryTask({ id: `${status}-${index}`, title: `${status} work ${index + 1}`, status: status as TaskStatus, updatedAt: "2026-11-01T00:00:00Z", order: index, assigneeId: profile.id, ownerId: profile.id })));
completed.forEach(task => { task.priority = task.order === 1 ? "P0" : "P2"; });
completed.find(task => task.id === "Offen-24")!.workstream = "Unloaded workstream";
function page(input: PlanningBoardQueryInput = {}) {
  const query = normalizePlanningBoardQuery(input);
  const matches = [active, ...completed].filter(task => query.filters.workstream === "Alle" || task.workstream === query.filters.workstream);
  const cards = [...taskStatuses, "Pausiert"].flatMap(status => !input.column || input.column === status ? matches.filter(task => task.status === status).slice(input.continuation ? 20 : 0, input.continuation ? 40 : 20) : []);
  const columns = Object.fromEntries([...taskStatuses, "Pausiert"].map(status => {
    const total = matches.filter(task => task.status === status).length;
    const loaded = cards.filter(task => task.status === status).length;
    const partial = (input.column === status && input.continuation ? 20 : 0) + loaded < total;
    return [status, { total, loaded, completeness: partial ? "partial" : "complete", continuation: partial ? `next-${status}` : null } satisfies PlanningBoardColumn];
  })) as Record<TaskStatus, PlanningBoardColumn>;
  return { revision: "history-r1", query, project: emptyPlanningShellState.project, items: cards, people: [profile], sprints: [], relationships: [], preferences: [], coverage: { items: "partial", people: "complete", strategies: "complete", raci: "complete", links: "complete", sprints: "complete", relationships: "complete", preferences: "complete" } as const,
    board: { query, column: input.column, queryKey: planningBoardQueryKey(query), revision: "history-r1", observedAt: "2026-11-07T00:00:00Z", cardIds: [...cards].sort((left, right) => left.priority.localeCompare(right.priority) || left.order - right.order || left.id.localeCompare(right.id)).map(task => task.id), workstreams: ["Unloaded workstream"], childProgressById: {}, columns, metrics: { total: matches.length, open: matches.filter(task => task.status !== "Erledigt").length, blocked: matches.filter(task => task.status === "Blockiert").length, done: matches.filter(task => task.status === "Erledigt").length }, viewerOpenSubIssueIdsByDeliverableId: {}, workspaceRevision: { activeTaskCount: 76, latestUpdatedAt: "history-r1" } },
  };
}
const initial = page();
function ActiveColumnsFlow({ holdColumnPage = false, failRefresh = false }: { holdColumnPage?: boolean; failRefresh?: boolean }) {
  const [releasePage, setReleasePage] = useState<(() => void) | null>(null);
  const [ready, setReady] = useState(false);
  const [reads, setReads] = useState(0);
  useEffect(() => {
    const seenKey = `founderops.product-updates.seen.${profile.id}`;
    const previous = localStorage.getItem(seenKey);
    localStorage.setItem(seenKey, JSON.stringify(productUpdates.map(update => update.id)));
    let attempts = 0;
    let refreshAttempts = 0;
    const restore = mockAccountLifecycle("google", { linked: true }, (input, init) => {
      const url = new URL(String(input), "http://localhost:3000");
      if (url.pathname === "/api/auth/session") return Response.json({ session });
      if (url.pathname === "/api/planning-board-data") {
        setReads(value => value + 1);
        const query = JSON.parse(url.searchParams.get("scope") || "{}");
        if (failRefresh && query.column && !query.continuation && ++refreshAttempts === 1) return Response.json({ error: "Refresh unavailable" }, { status: 503 });
        if (query.view === "complete") return Response.json({ model: { ...page(query), board: undefined, items: [active, ...completed], coverage: { ...initial.coverage, items: "complete" } }, currentProfile: profile });
        if (query.column === "Offen" && query.continuation && ++attempts === 1) return Response.json({ error: "History unavailable" }, { status: 503 });
        if (holdColumnPage && query.column === "Review" && query.continuation) return new Promise<Response>(resolve => setReleasePage(() => () => { resolve(Response.json({ model: page(query), currentProfile: profile })); setReleasePage(null); }));
        return Response.json({ model: page(query), currentProfile: profile });
      }
      if (url.pathname === `/api/tasks/${active.id}` && init?.method === "PATCH") return Response.json({ task: { ...active, ...JSON.parse(String(init.body)), updatedAt: "saved-status-r2" } });
      if (url.pathname === "/api/planning-revision") return Response.json({ revision: initial.board.workspaceRevision });
      if (url.pathname === "/api/github-app/status") return Response.json({ installation: { available: false }, user: { connected: false } });
      if (url.pathname === "/api/team/platform-releases/v1/releases") return Response.json({ releases: [] });
      return Response.json({ error: "Optional data unavailable" }, { status: 503 });
    });
    queueMicrotask(() => setReady(true));
    return () => { restore(); if (previous === null) localStorage.removeItem(seenKey); else localStorage.setItem(seenKey, previous); };
  }, [holdColumnPage, failRefresh]);
  return <>{releasePage ? <button type="button" onClick={releasePage}>Seitenantwort fortsetzen</button> : null}<output aria-label="Column reads">{reads}</output>{ready ? <PlanningStateProvider><PlanningApp initialWorkspace="planning" initialWorkspaceRead={planningWorkspaceHydration("planning", initial, session)} initialData={{ ...emptyPlanningShellState, tasks: initial.items, profiles: [profile] }} initialHeaderData={emptyPlanningHeaderData} initialAuthUser={user} initialCurrentProfile={profile} initialProtectedDataLoaded authRequired source="supabase" /></PlanningStateProvider> : null}</>;
}
const meta = { title: "Planning/Active columns flow", component: ActiveColumnsFlow, parameters: { layout: "fullscreen", nextjs: { appDirectory: true, navigation: { pathname: "/planning" } } } } satisfies Meta<typeof ActiveColumnsFlow>;
export default meta;
type Story = StoryObj<typeof meta>;
export const InitialActiveColumns: Story = {};
export const UnloadedWorkstreamCanBeSelectedBeforeLoadingMore: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await canvas.findByRole("region", { name: "Board nach Status" });
    await expect(canvas.queryByText("Offen work 25")).not.toBeInTheDocument();
    await userEvent.click(canvas.getByRole("button", { name: "Filter" }));
    await userEvent.click(canvas.getByRole("combobox", { name: "Nach Bereich filtern" }));
    await userEvent.click(within(document.body).getByRole("option", { name: "Unloaded workstream" }));
    await expect(await canvas.findByRole("link", { name: "Offen work 25" })).toBeVisible();
    await expect(canvas.getByLabelText("Column reads")).toHaveTextContent("1");
    await expect(canvas.queryByRole("link", { name: "Offen work 1" })).not.toBeInTheDocument();
  },
};
export const PriorityOrderSurvivesConfirmedStatusMove: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const board = await canvas.findByRole("region", { name: "Board nach Status" });
    const open = within(board).getByRole("region", { name: /Offen, 25/ });
    const titles = () => within(open).getAllByRole("article").map(card => within(card).getAllByRole("link")[0].textContent);
    await expect(titles().slice(0, 2)).toEqual(["Offen work 2", "Offen work 1"]);
    const card = within(board).getByRole("link", { name: active.title }).closest("article")!;
    const transfer = new DataTransfer();
    fireEvent.dragStart(card, { dataTransfer: transfer });
    fireEvent.dragOver(open, { dataTransfer: transfer });
    fireEvent.drop(open, { dataTransfer: transfer });
    fireEvent.dragEnd(card, { dataTransfer: transfer });
    await waitFor(() => expect(titles().slice(0, 3)).toEqual(["Offen work 2", active.title, "Offen work 1"]));
  },
};

async function retryStaleColumn(canvasElement: HTMLElement, column: "Offen" | "Blockiert") {
  const canvas = within(canvasElement);
  const board = await canvas.findByRole("region", { name: "Board nach Status" });
  const card = within(board).getByRole("link", { name: active.title }).closest("article")!;
  const target = within(board).getByRole("region", { name: /In Arbeit, 0/ });
  const transfer = new DataTransfer();
  fireEvent.dragStart(card, { dataTransfer: transfer });
  fireEvent.dragOver(target, { dataTransfer: transfer });
  fireEvent.drop(target, { dataTransfer: transfer });
  fireEvent.dragEnd(card, { dataTransfer: transfer });
  const region = within(board).getByRole("region", { name: new RegExp(`${column},`) });
  await userEvent.click(await within(region).findByRole("button", { name: `${column} aktualisieren` }));
  const retry = await within(region).findByRole("button", { name: `${column} erneut laden` });
  await expect(retry).toHaveAttribute("aria-disabled", "false");
  await expect(canvas.getByLabelText("Column reads")).toHaveTextContent("1");
  await userEvent.click(retry);
  await waitFor(() => expect(canvas.getByLabelText("Column reads")).toHaveTextContent("2"));
  await waitFor(() => expect(within(region).queryByRole("alert")).not.toBeInTheDocument());
}
export const FailedPartialRefreshRetriesFromStart: Story = {
  args: { failRefresh: true },
  play: async ({ canvasElement }) => retryStaleColumn(canvasElement, "Offen"),
};
export const FailedCompleteRefreshRetriesFromStart: Story = {
  args: { failRefresh: true },
  play: async ({ canvasElement }) => retryStaleColumn(canvasElement, "Blockiert"),
};
export const ColumnsLoadAndRetryIndependently: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const board = await canvas.findByRole("region", { name: "Board nach Status" });
    const open = within(board).getByRole("region", { name: /Offen, 25/ });
    const review = within(board).getByRole("region", { name: /Review, 25/ });
    await expect(within(open).getByText("20 von 25 geladen")).toBeVisible();
    await expect(within(review).getByText("20 von 25 geladen")).toBeVisible();
    await expect(canvas.getByLabelText("Column reads")).toHaveTextContent("0");
    const more = within(open).getByRole("button", { name: "Weitere Karten in Offen laden" });
    more.focus();
    await userEvent.keyboard("[Enter]");
    await waitFor(() => expect(within(open).getByRole("button", { name: "Offen erneut laden" })).toBeVisible());
    await expect(within(open).getByRole("button", { name: "Offen erneut laden" })).toHaveFocus();
    await userEvent.click(within(review).getByRole("button", { name: "Weitere Karten in Review laden" }));
    const reviewScroll = board.scrollLeft;
    await waitFor(() => expect(within(review).getByText("25 von 25 geladen")).toBeVisible());
    await expect(board.scrollLeft).toBe(reviewScroll);
    await expect(within(open).getByText("20 von 25 geladen")).toBeVisible();
    await expect(within(board).getByText("Active work stays visible")).toBeVisible();
    await userEvent.click(within(open).getByRole("button", { name: "Offen erneut laden" }));
    await waitFor(() => expect(within(open).getByText("25 von 25 geladen")).toBeVisible());
    await expect(within(open).getByRole("button", { name: "Offen vollständig geladen" })).toHaveFocus();
    await expect(within(open).getByText("Offen work 25")).toBeVisible();
    await expect(canvas.getByLabelText("Column reads")).toHaveTextContent("3");
  },
};

export const StatusDragRemainsAvailableWhileAnotherColumnLoads: Story = {
  args: { holdColumnPage: true },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const board = await canvas.findByRole("region", { name: "Board nach Status" });
    const review = within(board).getByRole("region", { name: /Review, 25/ });
    await userEvent.click(within(review).getByRole("button", { name: "Weitere Karten in Review laden" }));
    await expect(within(review).getByRole("button", { name: "Review wird geladen …" })).toHaveAttribute("aria-disabled", "true");
    const card = within(board).getByRole("link", { name: active.title }).closest("article")!;
    const target = within(board).getByRole("region", { name: /In Arbeit, 0/ });
    const transfer = new DataTransfer();
    fireEvent.dragStart(card, { dataTransfer: transfer });
    fireEvent.dragOver(target, { dataTransfer: transfer });
    fireEvent.drop(target, { dataTransfer: transfer });
    fireEvent.dragEnd(card, { dataTransfer: transfer });
    await waitFor(() => expect(within(target).getByRole("link", { name: active.title })).toBeVisible());
    const scroll = board.scrollLeft;
    await userEvent.click(canvas.getByRole("button", { name: "Seitenantwort fortsetzen" }));
    await waitFor(() => expect(within(review).getByRole("button", { name: "Review aktualisieren" })).toBeVisible());
    await expect(within(review).getByText("20 von 25 geladen")).toBeVisible();
    await expect(within(review).queryByText("Review work 25")).not.toBeInTheDocument();
    await expect(board.scrollLeft).toBe(scroll);
    await expect(within(target).getByRole("link", { name: active.title })).toBeVisible();
    await expect(canvas.getByLabelText("Column reads")).toHaveTextContent("1");
  },
};
