import type { User } from "@supabase/supabase-js";
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { useEffect, useMemo, useState } from "react";
import { expect, fireEvent, userEvent, waitFor, within } from "storybook/test";
import { PlanningApp } from "./PlanningApp";
import { PlanningStateProvider } from "./organisms/planning-state-provider";
import { emptyPlanningShellState } from "./model/planning-shell-state";
import { planningWorkspaceHydration } from "./model/planning-workspace-hydration";
import { normalizePlanningBoardQuery, planningBoardQueryKey } from "./model/planning-board-query";
import type { PlanningWorkspaceModel } from "@/features/planning-items/model/planning-workspace-model";
import { emptyPlanningHeaderData } from "@/lib/planning-header-data";
import { taskDetailStoryTask } from "@/features/tasks/molecules/task-detail-story-fixtures";
import type { Profile } from "@/lib/types";
import { planningAttentionSignalsFromIds } from "@/features/tasks/model/task-attention-signals";
import { productUpdates } from "@/features/product-updates/model/product-update-registry";
import { mockAccountLifecycle } from "../../../tests/helpers/account-lifecycle-browser-fixture";

const profile: Profile = { id: "risk-person", name: "Synthetic risk reader", platformRole: "ceo", orgRole: "CEO", githubLogin: "", weeklyCapacity: 40 };
const user = { id: "risk-user", email: "risk@example.test" } as User;
const session = { user, userId: user.id, revision: "risk-session", expiresAt: Math.floor(Date.now() / 1000) + 3600 };
const authority = { userId: user.id, deadline: session.expiresAt * 1000 };
const observedAt = new Date().toISOString();

// Unknown risks deliberately accompany ready, operable Table rows. HTTP control
// exercises the actual browser adapter, existing owner and aggregate-only retry.
function TableRisksFlow() {
  const [ready, setReady] = useState(false), [riskReads, setRiskReads] = useState(0), [contentReads, setContentReads] = useState(0);
  const [release, setRelease] = useState<(() => void) | null>(null);
  const { model, rows } = useMemo(() => {
    const rows = [taskDetailStoryTask({ id: "risk-first", title: "Synthetic operable table row", status: "Offen", priority: "P0", assigneeId: profile.id, acceptanceCriteria: "Synthetic AC", definitionOfDone: "Synthetic DoD", order: 0 }),
      taskDetailStoryTask({ id: "risk-second", title: "Synthetic second table row", status: "Offen", priority: "P0", assignee: "", assigneeId: "", owner: "", ownerId: "", acceptanceCriteria: "", definitionOfDone: "", githubIssueSyncStatus: "failed", order: 1 })];
    const query = normalizePlanningBoardQuery({ view: "table", filters: { query: "Synthetic" } });
    const model: PlanningWorkspaceModel = { revision: "risk-r1", scopeRevision: "61", queryRevision: "risk-r1", query, project: emptyPlanningShellState.project,
      items: rows, people: [profile], sprints: [], relationships: [], blockers: [], preferences: [],
      coverage: { items: "partial", people: "complete", sprints: "complete", preferences: "complete", relationships: "partial", blockers: "partial" },
      table: { query, queryKey: planningBoardQueryKey(query), revision: "risk-r1", observedAt, validUntil: null, rowIds: rows.map(row => row.id),
        page: { total: 2, loaded: 2, completeness: "complete", continuation: null }, metrics: { total: 2, open: 2, done: 0, blocked: 0 },
        summaryRequests: [{ token: "synthetic-table-risks", cardIds: rows.map(row => row.id), status: "loading" }],
        ...{ risksById: Object.fromEntries(rows.map(row => [row.id, null])) },
        workspaceRevision: { activeTaskCount: 7, latestUpdatedAt: "risk-r1" } } };
    return { model, rows };
  }, []);
  useEffect(() => {
    const key = `founderops.product-updates.seen.${profile.id}`, previous = localStorage.getItem(key);
    localStorage.setItem(key, JSON.stringify(productUpdates.map(update => update.id)));
    let attempts = 0, finish: (() => void) | undefined;
    const restore = mockAccountLifecycle("google", { linked: true }, input => {
      const url = new URL(input instanceof Request ? input.url : String(input), "http://localhost:3000");
      if (url.pathname === "/api/auth/session") return Response.json({ session });
      if (url.pathname === "/api/planning-source-version") return Response.json({ version: "61" });
      if (url.pathname === "/api/planning-board-data") {
        if (url.searchParams.get("summaries") !== "synthetic-table-risks") { setContentReads(value => value + 1); return Response.json({ error: "Synthetic content reread forbidden" }, { status: 503 }); }
        setRiskReads(value => value + 1);
        if (++attempts === 1) return new Promise<Response>(resolve => { finish = () => resolve(Response.json({ error: "Synthetic risk read unavailable" }, { status: 503 })); setRelease(() => finish!); });
        return Response.json({ readAuthority: authority, summaries: { kind: "table-risks", readId: "synthetic-risk-read", token: "synthetic-table-risks", cardIds: rows.map(row => row.id),
          scopeRevision: "61", queryRevision: "risk-r1", observedAt, validUntil: null, authorityDeadline: authority.deadline,
          risksById: { [rows[0].id]: { attention: planningAttentionSignalsFromIds(["waiting"]), waitsOn: 2, blocks: 1, hasOpenWait: true },
            [rows[1].id]: { attention: planningAttentionSignalsFromIds(["owner-missing", "sync-failed", "acceptance-criteria-missing", "definition-of-done-missing"]), waitsOn: 0, blocks: 0, hasOpenWait: false } } } });
      }
      if (url.pathname === "/api/github-app/status") return Response.json({ installation: { available: false }, user: { connected: false } });
      if (url.pathname === "/api/team/platform-releases/v1/releases") return Response.json({ releases: [] });
      return Response.json({ error: "Synthetic optional area unavailable" }, { status: 503 });
    });
    queueMicrotask(() => setReady(true));
    return () => { finish?.(); restore(); if (previous === null) localStorage.removeItem(key); else localStorage.setItem(key, previous); };
  }, [rows]);
  return <><button type="button" onMouseDown={event => event.preventDefault()} disabled={!release} onClick={() => release?.()}>Risikoantwort freigeben</button>
    <output aria-label="Risikoanfragen">{riskReads}</output><output aria-label="Inhaltsanfragen">{contentReads}</output>
    {ready ? <PlanningStateProvider><PlanningApp initialWorkspace="planning" initialWorkspaceRead={planningWorkspaceHydration("planning", model, session, authority)}
      initialData={{ ...emptyPlanningShellState, tasks: [...model.items], profiles: [profile] }} initialHeaderData={emptyPlanningHeaderData}
      initialAuthUser={user} initialCurrentProfile={profile} initialProtectedDataLoaded authRequired source="supabase" /></PlanningStateProvider> : null}</>;
}
const meta = { title: "Planning/Table risk reveal", component: TableRisksFlow,
  loaders: [async () => { await import("@/features/tasks/organisms/task-table-view"); return {}; }],
  parameters: { layout: "fullscreen", nextjs: { appDirectory: true, navigation: { pathname: "/planning" } } } } satisfies Meta<typeof TableRisksFlow>;
export default meta;
type Story = StoryObj<typeof meta>;

export const UnknownRisksRetryWithoutRereadingOrReplacingRows: Story = { play: async ({ canvasElement }) => {
  const canvas = within(canvasElement);
  const first = await canvas.findByRole("link", { name: "Synthetic operable table row" });
  const firstRow = within(first.closest("tr, article")! as HTMLElement);
  await expect(firstRow.getByText("Risiken unbekannt")).toBeVisible();
  await expect(firstRow.queryByText("Wartet auf 2")).not.toBeInTheDocument();
  const second = canvas.getByRole("link", { name: "Synthetic second table row" }), secondRow = second.closest("tr, article")!;
  const control = canvas.getByRole("combobox", { name: "Zuständigkeit für Synthetic operable table row ändern" });
  await userEvent.click(control); await userEvent.keyboard("{Escape}");
  await waitFor(() => expect(control).toHaveFocus());
  const before = secondRow.getBoundingClientRect();
  await waitFor(() => expect(canvas.getByRole("button", { name: "Risikoantwort freigeben" })).toBeEnabled());
  fireEvent.click(canvas.getByRole("button", { name: "Risikoantwort freigeben" }));
  const retry = await canvas.findByRole("button", { name: "Risiken erneut laden" });
  await expect(firstRow.getByText("Risiken unbekannt")).toBeVisible();
  await expect(control).toHaveFocus();
  fireEvent.click(retry);
  await firstRow.findByText("Wartet auf 2");
  await expect(firstRow.getByText("Wartet")).toBeVisible();
  await expect(firstRow.getByText("Blockiert 1")).toBeVisible();
  const secondRisk = within(secondRow as HTMLElement);
  await expect(secondRisk.getByText("Owner fehlt")).toBeVisible();
  await expect(secondRisk.getByText("Sync fehlgeschlagen")).toBeVisible();
  await expect(secondRisk.getByText("AC fehlt")).toBeVisible();
  await expect(secondRisk.getByText("+1")).toBeVisible();
  await expect(control).toHaveFocus();
  await expect(Math.abs(secondRow.getBoundingClientRect().top - before.top)).toBeLessThan(1);
  await expect(Math.abs(secondRow.getBoundingClientRect().left - before.left)).toBeLessThan(1);
  await expect(canvas.getByRole("searchbox", { name: "Aufgaben durchsuchen" })).toHaveValue("synthetic");
  await expect(canvas.getByLabelText("Risikoanfragen")).toHaveTextContent("2");
  await expect(canvas.getByLabelText("Inhaltsanfragen")).toHaveTextContent("0");
} };
