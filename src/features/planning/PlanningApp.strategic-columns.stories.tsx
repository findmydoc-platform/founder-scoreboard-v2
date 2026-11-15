import type { User } from "@supabase/supabase-js";
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { useEffect, useMemo, useState } from "react";
import { expect, fireEvent, userEvent, waitFor, within } from "storybook/test";
import { PlanningApp } from "./PlanningApp";
import { PlanningStateProvider } from "./organisms/planning-state-provider";
import { emptyPlanningShellState } from "./model/planning-shell-state";
import { planningWorkspaceHydration } from "./model/planning-workspace-hydration";
import { normalizePlanningBoardQuery, planningBoardQueryKey, type PlanningBoardColumn } from "./model/planning-board-query";
import type { PlanningBoardStreamFrame } from "./model/planning-board-delivery";
import type { PlanningWorkspaceModel } from "@/features/planning-items/model/planning-workspace-model";
import { emptyPlanningHeaderData } from "@/lib/planning-header-data";
import { taskDetailStoryTask } from "@/features/tasks/molecules/task-detail-story-fixtures";
import type { Profile, Task, TaskStatus } from "@/lib/types";
import { taskStatuses } from "@/lib/status";
import { productUpdates } from "@/features/product-updates/model/product-update-registry";
import { mockAccountLifecycle } from "../../../tests/helpers/account-lifecycle-browser-fixture";

const profile: Profile = { id: "strategic-person", name: "Synthetic strategic reader", platformRole: "ceo", orgRole: "CEO", githubLogin: "", weeklyCapacity: 40 };
const user = { id: "strategic-user", email: "strategic@example.test" } as User;
const session = { user, userId: user.id, revision: "strategic-session", expiresAt: Math.floor(Date.now() / 1000) + 3600 };
const authority = { userId: user.id, deadline: session.expiresAt * 1000 };
const observedAt = new Date().toISOString();
const statuses: TaskStatus[] = [...taskStatuses, "Pausiert"];
function columns(items: readonly Task[], pending = false) {
  return Object.fromEntries(statuses.map(status => {
    const total = items.filter(item => item.status === status).length;
    return [status, { total, loaded: pending ? 0 : total, availability: pending && total ? "not-loaded" : "ready", completeness: pending && total ? "partial" : "complete", continuation: null } satisfies PlanningBoardColumn];
  })) as Record<TaskStatus, PlanningBoardColumn>;
}
function model(level: "epic" | "initiative", queryText: string, items: readonly Task[], pending = false): PlanningWorkspaceModel {
  const query = normalizePlanningBoardQuery({ level, filters: { query: queryText } });
  return { revision: "strategic-revision", scopeRevision: "43", query, queryRevision: "strategic-revision", project: emptyPlanningShellState.project,
    items: pending ? [] : items, people: [profile], sprints: [], relationships: [], blockers: [], preferences: [],
    coverage: { items: "partial", people: "complete", sprints: "complete", preferences: "complete", relationships: "partial", blockers: "partial" },
    board: { query, queryKey: planningBoardQueryKey(query), revision: "strategic-revision", observedAt, validUntil: null,
      cardIds: pending ? [] : items.map(item => item.id), columns: columns(items, pending), metrics: { total: items.length, open: items.length, done: 0, blocked: 0 },
      childProgressById: Object.fromEntries((pending ? [] : items).map(item => [item.id, null])), attentionById: Object.fromEntries((pending ? [] : items).map(item => [item.id, null])),
      viewerOpenSubIssueIdsByDeliverableId: {}, workspaceRevision: { activeTaskCount: 3, latestUpdatedAt: "strategic-revision" } },
  };
}

// Controlled HTTP frames exercise the actual browser adapter and single owner.
// Real SQL/authority and native transport retain their separate integration gates.
function StrategicColumnsFlow({ level = "initiative" }: { level?: "epic" | "initiative" }) {
  const [ready, setReady] = useState(false), [streamReads, setStreamReads] = useState(0), [extraReads, setExtraReads] = useState(0);
  const [release, setRelease] = useState<(() => void) | null>(null);
  const { initial, open, paused } = useMemo(() => {
    const initialCard = taskDetailStoryTask({ id: `${level}-initial`, title: "Synthetic previous strategic result", taskType: level, status: "In Arbeit" });
    const open = taskDetailStoryTask({ id: `${level}-open`, title: "Synthetic needle open result", taskType: level, status: "Offen" });
    const paused = taskDetailStoryTask({ id: `${level}-paused`, title: "Synthetic needle paused result", taskType: level, status: "Pausiert" });
    return { initial: model(level, "", [initialCard]), open, paused };
  }, [level]);
  useEffect(() => {
    const key = `founderops.product-updates.seen.${profile.id}`, previous = localStorage.getItem(key);
    localStorage.setItem(key, JSON.stringify(productUpdates.map(update => update.id)));
    let finish: (() => void) | undefined;
    const restore = mockAccountLifecycle("google", { linked: true }, (input, init) => {
      const url = new URL(input instanceof Request ? input.url : String(input), "http://localhost:3000");
      if (url.pathname === "/api/auth/session") return Response.json({ session });
      if (url.pathname === "/api/planning-source-version") return Response.json({ version: "43" });
      if (url.pathname === "/api/planning-board-data") {
        const scope = JSON.parse(url.searchParams.get("scope") || "{}");
        const headers = new Headers(init?.headers || (input instanceof Request ? input.headers : undefined));
        if (scope.column || !headers.get("accept")?.includes("application/x-ndjson")) {
          setExtraReads(count => count + 1);
          return Response.json({ error: "Synthetic strategic query requires its progressive contract" }, { status: 503 });
        }
        setStreamReads(count => count + 1);
        const basis = model(level, scope.filters.query, [open, paused], true), readId = `strategic-${level}`;
        const frame = (task: Task): PlanningBoardStreamFrame => ({ kind: "column", readId, column: task.status,
          scopeRevision: "43", queryRevision: "strategic-revision", observedAt, validUntil: null,
          cardIds: [task.id], items: [task], relationships: [], personalChildren: {}, taskOmittedFields: [],
          columnState: { total: 1, loaded: 1, availability: "ready", completeness: "complete", continuation: null } });
        const encoder = new TextEncoder();
        let closed = false;
        return new Response(new ReadableStream<Uint8Array>({ start(controller) {
          const emit = (value: PlanningBoardStreamFrame) => controller.enqueue(encoder.encode(`${JSON.stringify(value)}\n`));
          emit({ kind: "basis", readId, model: basis, readAuthority: authority, currentProfile: profile });
          emit(frame(paused));
          finish = () => { if (closed) return; closed = true; emit(frame(open)); emit({ kind: "end", readId }); controller.close(); };
          setRelease(() => finish!);
        }, cancel() { closed = true; } }), { headers: { "content-type": "application/x-ndjson" } });
      }
      if (url.pathname === "/api/github-app/status") return Response.json({ installation: { available: false }, user: { connected: false } });
      if (url.pathname === "/api/team/platform-releases/v1/releases") return Response.json({ releases: [] });
      return Response.json({ error: "Synthetic optional area unavailable" }, { status: 503 });
    });
    queueMicrotask(() => setReady(true));
    return () => { finish?.(); restore(); if (previous === null) localStorage.removeItem(key); else localStorage.setItem(key, previous); };
  }, [level, open, paused]);
  return <><button type="button" onMouseDown={event => event.preventDefault()} disabled={!release} onClick={() => release?.()}>Offene Spalte liefern</button>
    <output aria-label="Strategische Stream-Anfragen">{streamReads}</output><output aria-label="Zusätzliche Spaltenanfragen">{extraReads}</output>
    {ready ? <PlanningStateProvider><PlanningApp initialWorkspace="planning" initialWorkspaceRead={planningWorkspaceHydration("planning", initial, session, authority)}
      initialData={{ ...emptyPlanningShellState, tasks: [...initial.items], profiles: [profile] }} initialHeaderData={emptyPlanningHeaderData}
      initialAuthUser={user} initialCurrentProfile={profile} initialProtectedDataLoaded authRequired source="supabase" /></PlanningStateProvider> : null}</>;
}
const meta = { title: "Planning/Strategic column reveal", component: StrategicColumnsFlow, parameters: { layout: "fullscreen", nextjs: { appDirectory: true, navigation: { pathname: "/planning" } } } } satisfies Meta<typeof StrategicColumnsFlow>;
export default meta;
type Story = StoryObj<typeof meta>;

async function operateIndependentStrategicResult(canvasElement: HTMLElement) {
  const canvas = within(canvasElement);
  await canvas.findByRole("link", { name: "Synthetic previous strategic result" });
  const search = canvas.getByRole("searchbox", { name: "Aufgaben durchsuchen" });
  await userEvent.type(search, "needle{Enter}");
  const paused = await canvas.findByRole("link", { name: "Synthetic needle paused result" });
  await expect(canvas.queryByRole("link", { name: "Synthetic needle open result" })).not.toBeInTheDocument();
  const card = paused.closest("article")!, board = canvas.getByRole("region", { name: "Board nach Status" });
  await expect(within(card).getByText("Kindfortschritt unbekannt")).toBeVisible();
  const control = within(card).getByRole("button", { name: "Status für Synthetic needle paused result ändern" });
  await userEvent.click(control); await userEvent.keyboard("{Escape}");
  await waitFor(() => expect(control).toHaveFocus());
  const top = card.getBoundingClientRect().top, left = card.getBoundingClientRect().left, scroll = board.scrollLeft;
  fireEvent.click(canvas.getByRole("button", { name: "Offene Spalte liefern" }));
  await canvas.findByRole("link", { name: "Synthetic needle open result" });
  await expect(control).toHaveFocus();
  await expect(search).toHaveValue("needle");
  await expect(Math.abs(card.getBoundingClientRect().top - top)).toBeLessThan(1);
  await expect(Math.abs(card.getBoundingClientRect().left - left)).toBeLessThan(1);
  await expect(board.scrollLeft).toBe(scroll);
  await expect(canvas.getByLabelText("Strategische Stream-Anfragen")).toHaveTextContent("1");
  await expect(canvas.getByLabelText("Zusätzliche Spaltenanfragen")).toHaveTextContent("0");
}
export const InitiativeColumnsUseTheExistingOwner: Story = { play: async ({ canvasElement }) => operateIndependentStrategicResult(canvasElement) };
export const EpicColumnsUseTheExistingOwner: Story = { args: { level: "epic" }, play: async ({ canvasElement }) => operateIndependentStrategicResult(canvasElement) };
