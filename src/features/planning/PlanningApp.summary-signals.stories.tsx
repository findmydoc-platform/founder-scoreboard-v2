import type { User } from "@supabase/supabase-js";
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { useEffect, useState } from "react";
import { expect, userEvent, within } from "storybook/test";
import { PlanningApp } from "./PlanningApp";
import { PlanningStateProvider } from "./organisms/planning-state-provider";
import { PlanningServerBoardReceipt } from "./organisms/planning-server-board-receipt";
import { emptyPlanningShellState } from "./model/planning-shell-state";
import { planningWorkspaceHydration } from "./model/planning-workspace-hydration";
import { normalizePlanningBoardQuery, planningBoardQueryKey, type PlanningBoardColumn } from "./model/planning-board-query";
import type { PlanningBoardSummaryFrame } from "./model/planning-board-summaries";
import type { PlanningWorkspaceModel } from "@/features/planning-items/model/planning-workspace-model";
import { taskDetailStoryTask } from "@/features/tasks/molecules/task-detail-story-fixtures";
import { emptyPlanningHeaderData } from "@/lib/planning-header-data";
import { productUpdates } from "@/features/product-updates/model/product-update-registry";
import type { Profile, TaskStatus } from "@/lib/types";
import { taskStatuses } from "@/lib/status";
import { mockAccountLifecycle } from "../../../tests/helpers/account-lifecycle-browser-fixture";

const profile: Profile = { id: "summary-reader", name: "Synthetic reader", platformRole: "ceo", orgRole: "CEO", githubLogin: "", weeklyCapacity: 40 };
const user = { id: "summary-user", email: "summary@example.test" } as User;
const session = { user, userId: user.id, revision: "summary-session", expiresAt: Math.floor(Date.now() / 1000) + 3600 };
const cards = [
  taskDetailStoryTask({ id: "summary-outgoing", title: "Outgoing waiting parent", status: "Offen", assigneeId: profile.id, ownerId: profile.id }),
  taskDetailStoryTask({ id: "summary-incoming", title: "Incoming waiting parent", status: "Offen", assigneeId: profile.id, ownerId: profile.id }),
];
const query = normalizePlanningBoardQuery({ view: "board", filters: {} });
const columns = Object.fromEntries([...taskStatuses, "Pausiert"].map(status => [status, {
  total: status === "Offen" ? 2 : 0, loaded: status === "Offen" ? 2 : 0, availability: "ready", completeness: "complete", continuation: null,
} satisfies PlanningBoardColumn])) as Record<TaskStatus, PlanningBoardColumn>;
const model: PlanningWorkspaceModel = {
  revision: "summary-source", scopeRevision: "42", query, project: emptyPlanningShellState.project, items: cards,
  people: [profile], sprints: [], relationships: [], blockers: [], preferences: [],
  coverage: { items: "partial", people: "complete", sprints: "complete", relationships: "partial", blockers: "partial", preferences: "complete" },
  board: { query, queryKey: planningBoardQueryKey(query), revision: "summary-query", observedAt: "2026-11-13T12:00:00Z", validUntil: null,
    cardIds: cards.map(card => card.id), columns, metrics: { total: 2, open: 2, done: 0, blocked: 2 },
    childProgressById: Object.fromEntries(cards.map(card => [card.id, null])), attentionById: Object.fromEntries(cards.map(card => [card.id, null])),
    viewerOpenSubIssueIdsByDeliverableId: {}, workspaceRevision: { activeTaskCount: 3, latestUpdatedAt: "summary-source" },
    delivery: { id: "native-summary", columns: [] }, summaryRequests: [{ token: "native-summary-token", cardIds: cards.map(card => card.id), status: "loading" }],
  },
};
const frame: PlanningBoardSummaryFrame = {
  kind: "summaries", readId: "native-summary", token: "native-summary-token", cardIds: cards.map(card => card.id),
  scopeRevision: "42", queryRevision: "summary-query", observedAt: model.board!.observedAt, validUntil: null,
  childProgressById: Object.fromEntries(cards.map(card => [card.id, { completed: 0, total: 0, unfinished: 0, percentage: 0 }])),
  attentionById: Object.fromEntries(cards.map(card => [card.id, [{ id: "waiting", label: "Wartet", kind: "critical" }]])),
};

// The input contains neither endpoint Item nor relationship rows. Real SQL
// direction parity is verified separately; this story checks presentation.
function SummarySignalsFlow() {
  const [ready, setReady] = useState(false), [delivered, setDelivered] = useState(false), [boardReads, setBoardReads] = useState(0);
  useEffect(() => {
    const key = `founderops.product-updates.seen.${profile.id}`, previous = localStorage.getItem(key);
    localStorage.setItem(key, JSON.stringify(productUpdates.map(update => update.id)));
    const restore = mockAccountLifecycle("google", { linked: true }, input => {
      const url = new URL(String(input), "http://localhost:3000");
      if (url.pathname === "/api/auth/session") return Response.json({ session });
      if (url.pathname === "/api/planning-source-version") return Response.json({ version: "42" });
      if (url.pathname === "/api/planning-board-data") { setBoardReads(count => count + 1); return Response.json({ model, readAuthority: { userId: user.id, deadline: session.expiresAt * 1000 }, currentProfile: profile }); }
      if (url.pathname === "/api/github-app/status") return Response.json({ installation: { available: false }, user: { connected: false } });
      if (url.pathname === "/api/team/platform-releases/v1/releases") return Response.json({ releases: [] });
      return Response.json({ error: "Synthetic optional area unavailable" }, { status: 503 });
    });
    queueMicrotask(() => setReady(true));
    return () => { restore(); if (previous === null) localStorage.removeItem(key); else localStorage.setItem(key, previous); };
  }, []);
  return <><button type="button" className="min-h-11 px-3" disabled={delivered} onClick={() => setDelivered(true)}>Signale liefern</button><output aria-label="Summary Board reads">{boardReads}</output>
    {ready ? <PlanningStateProvider><PlanningApp initialWorkspace="planning" initialWorkspaceRead={planningWorkspaceHydration("planning", model, session, { userId: user.id, deadline: session.expiresAt * 1000 })}
      initialData={{ ...emptyPlanningShellState, tasks: cards, profiles: [profile] }} initialHeaderData={emptyPlanningHeaderData}
      initialAuthUser={user} initialCurrentProfile={profile} initialProtectedDataLoaded authRequired source="supabase">
      {delivered ? <PlanningServerBoardReceipt readId="native-summary" outcome={frame} /> : null}
    </PlanningApp></PlanningStateProvider> : null}
  </>;
}

const meta = { title: "Planning/Independent summary signals", component: SummarySignalsFlow, parameters: { layout: "fullscreen", nextjs: { appDirectory: true, navigation: { pathname: "/planning" } } } } satisfies Meta<typeof SummarySignalsFlow>;
export default meta;
type Story = StoryObj<typeof meta>;

export const NativeWaitingSignalsNeedNoEndpointPayload: Story = { play: async ({ canvasElement }) => {
  const canvas = within(canvasElement);
  const articles = await Promise.all(cards.map(async card => (await canvas.findByRole("link", { name: card.title })).closest("article")!));
  for (const article of articles) await expect(within(article).getByText("Signale unbekannt")).toBeVisible();
  await userEvent.click(canvas.getByRole("button", { name: "Signale liefern" }));
  for (const article of articles) {
    await expect(await within(article).findByText("Wartet", { exact: true })).toBeVisible();
    await expect(within(article).queryByText("Signale unbekannt")).not.toBeInTheDocument();
  }
  await expect(canvas.getByRole("region", { name: "Board nach Status" }).querySelectorAll("article")).toHaveLength(2);
  await expect(canvas.getByLabelText("Summary Board reads")).toHaveTextContent("0");
  await expect(canvas.queryByText("Synthetic supporting endpoint")).not.toBeInTheDocument();
} };
