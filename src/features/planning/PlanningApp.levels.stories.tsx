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

const profile: Profile = { id: "strategic-person", name: "Strategic Person", platformRole: "ceo", orgRole: "CEO", githubLogin: "strategic-person", weeklyCapacity: 40 };
const user = { id: "strategic-user", email: "strategic@example.com" } as User;
const session = { user, userId: user.id, revision: "strategic-session", expiresAt: Math.floor(Date.now() / 1000) + 3600 };
const tasks = (["epic", "initiative", "deliverable"] as const).flatMap(taskType => ["Offen", "Pausiert", "Erledigt"].flatMap(status => Array.from({ length: 25 }, (_, index) => taskDetailStoryTask({
  id: `${taskType}-${status}-${index}`, title: `${taskType} ${status} ${index + 1}`, taskType, status: status as TaskStatus,
  parentTaskId: taskType === "initiative" ? index === 24 ? "epic-Erledigt-24" : "epic-Offen-0" : taskType === "deliverable" ? "initiative-Offen-0" : "",
  order: index, assigneeId: profile.id, ownerId: profile.id,
}))));
function page(input: PlanningBoardQueryInput = {}) {
  const query = normalizePlanningBoardQuery(input);
  const matches = tasks.filter(task => task.taskType === query.level && (query.parentId === "all" || task.parentTaskId === query.parentId));
  const cards = ["Offen", "Pausiert", "Erledigt"].flatMap(status => !input.column || status === input.column ? matches.filter(task => task.status === status).slice(input.continuation ? 20 : 0, input.continuation ? 40 : 20) : []);
  const columns = Object.fromEntries([...taskStatuses, "Pausiert"].map(status => {
    const total = matches.filter(task => task.status === status).length;
    const loaded = cards.filter(task => task.status === status).length;
    const continuation = loaded + (input.continuation ? 20 : 0) < total ? `next-${status}` : null;
    return [status, { total, loaded, completeness: continuation ? "partial" : "complete", continuation } satisfies PlanningBoardColumn];
  })) as Record<TaskStatus, PlanningBoardColumn>;
  const items = [...new Map([...cards, ...tasks.filter(task => query.level === "initiative" && task.taskType === "epic" || query.level === "deliverable" && task.taskType !== "deliverable")].map(task => [task.id, task])).values()];
  return { revision: "strategic-r1", query, project: emptyPlanningShellState.project, items, people: [profile], sprints: [], relationships: [], preferences: [], coverage: { items: "partial", people: "complete", strategies: "complete", raci: "complete", links: "complete", sprints: "complete", relationships: "complete", preferences: "complete" } as const,
    board: { query, column: input.column, queryKey: planningBoardQueryKey(query), revision: "strategic-r1", observedAt: "2026-11-07T00:00:00Z", cardIds: cards.map(task => task.id), childProgressById: Object.fromEntries(cards.map(card => {
      const children = tasks.filter(task => task.parentTaskId === card.id);
      const completed = children.filter(task => task.status === "Erledigt").length;
      return [card.id, { total: children.length, completed, unfinished: children.length - completed, percentage: children.length ? Math.round(completed / children.length * 100) : 0 }];
    })), columns, metrics: { total: matches.length, open: matches.filter(task => task.status !== "Erledigt").length, blocked: 0, done: matches.filter(task => task.status === "Erledigt").length }, viewerOpenSubIssueIdsByDeliverableId: {}, workspaceRevision: { activeTaskCount: tasks.length, latestUpdatedAt: "strategic-r1" } },
  };
}
const initial = page({ level: "epic" });
function StrategicLevelsFlow() {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const seenKey = `founderops.product-updates.seen.${profile.id}`;
    const previous = localStorage.getItem(seenKey);
    localStorage.setItem(seenKey, JSON.stringify(productUpdates.map(update => update.id)));
    const restore = mockAccountLifecycle("google", { linked: true }, input => {
      const url = new URL(String(input), "http://localhost:3000");
      if (url.pathname === "/api/auth/session") return Response.json({ session });
      if (url.pathname === "/api/planning-board-data") return Response.json({ model: page(JSON.parse(url.searchParams.get("scope") || "{}")), currentProfile: profile });
      if (url.pathname === "/api/planning-revision") return Response.json({ revision: initial.board.workspaceRevision });
      if (url.pathname === "/api/github-app/status") return Response.json({ installation: { available: false }, user: { connected: false } });
      if (url.pathname === "/api/team/platform-releases/v1/releases") return Response.json({ releases: [] });
      return Response.json({ error: "Optional data unavailable" }, { status: 503 });
    });
    queueMicrotask(() => setReady(true));
    return () => { restore(); if (previous === null) localStorage.removeItem(seenKey); else localStorage.setItem(seenKey, previous); };
  }, []);
  return ready ? <PlanningStateProvider><PlanningApp initialWorkspace="planning" initialWorkspaceRead={planningWorkspaceHydration("planning", initial, session)} initialData={{ ...emptyPlanningShellState, tasks: initial.items, profiles: [profile] }} initialHeaderData={emptyPlanningHeaderData} initialAuthUser={user} initialCurrentProfile={profile} initialProtectedDataLoaded authRequired source="supabase" /></PlanningStateProvider> : null;
}
const meta = { title: "Planning/Strategic levels flow", component: StrategicLevelsFlow, parameters: { layout: "fullscreen", nextjs: { appDirectory: true, navigation: { pathname: "/planning" } } } } satisfies Meta<typeof StrategicLevelsFlow>;
export default meta;
type Story = StoryObj<typeof meta>;
export const InitialEpics: Story = {};
export const StrategicPagingAndParentFilter: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement), body = within(document.body);
    const board = await canvas.findByRole("region", { name: "Board nach Status" });
    const done = within(board).getByRole("region", { name: /Erledigt, 25/ });
    await expect(within(done).getByText("20 von 25 geladen")).toBeVisible();
    await expect(within(board).queryByRole("region", { name: /Review,/ })).not.toBeInTheDocument();
    const more = within(done).getByRole("button", { name: "Weitere erledigte laden" });
    more.focus();
    await userEvent.keyboard("[Enter]");
    await waitFor(() => expect(within(done).getByText("25 von 25 geladen")).toBeVisible());
    await expect(within(done).getByRole("button", { name: "Erledigt vollständig geladen" })).toHaveFocus();
    await expect(within(done).getByRole("link", { name: "epic Erledigt 25" })).toBeVisible();
    await userEvent.click(canvas.getByRole("combobox", { name: "Planungsebene im Kanban" }));
    await userEvent.click(body.getByRole("option", { name: /Initiativen/ }));
    const parent = await canvas.findByRole("combobox", { name: "Nach Parent-Epic filtern" });
    await userEvent.click(parent);
    await userEvent.click(body.getByRole("option", { name: "epic Erledigt 25" }));
    await waitFor(() => expect(canvas.getByRole("region", { name: /Offen, 1/ })).toBeVisible());
    const selectedBoard = canvas.getByRole("region", { name: "Board nach Status" });
    await expect(within(selectedBoard).getByRole("link", { name: "initiative Offen 25" })).toBeVisible();
    await expect(within(selectedBoard).queryByRole("link", { name: "initiative Offen 1" })).not.toBeInTheDocument();
    await expect(within(selectedBoard).queryByRole("region", { name: /Review,/ })).not.toBeInTheDocument();
  },
};
