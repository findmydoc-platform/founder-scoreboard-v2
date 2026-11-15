import type { User } from "@supabase/supabase-js";
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { useEffect, useMemo, useState } from "react";
import { expect, fireEvent, userEvent, waitFor, within } from "storybook/test";
import { PlanningApp } from "./PlanningApp";
import { PlanningStateProvider } from "./organisms/planning-state-provider";
import { emptyPlanningShellState } from "./model/planning-shell-state";
import { planningWorkspaceHydration } from "./model/planning-workspace-hydration";
import { normalizePlanningBoardQuery, planningBoardQueryKey, type PlanningBoardColumn } from "./model/planning-board-query";
import type { PlanningWorkspaceModel } from "@/features/planning-items/model/planning-workspace-model";
import { emptyPlanningHeaderData } from "@/lib/planning-header-data";
import { taskDetailStoryTask } from "@/features/tasks/molecules/task-detail-story-fixtures";
import type { Profile, TaskStatus } from "@/lib/types";
import { taskStatuses } from "@/lib/status";
import { productUpdates } from "@/features/product-updates/model/product-update-registry";
import { mockAccountLifecycle } from "../../../tests/helpers/account-lifecycle-browser-fixture";

const profile: Profile = { id: "table-person", name: "Synthetic table reader", platformRole: "ceo", orgRole: "CEO", githubLogin: "", weeklyCapacity: 40 };
const user = { id: "table-user", email: "table@example.test" } as User;
const session = { user, userId: user.id, revision: "table-session", expiresAt: Math.floor(Date.now() / 1000) + 3600 };
const authority = { userId: user.id, deadline: session.expiresAt * 1000 };
const observedAt = new Date().toISOString();

// The controlled HTTP response uses the real browser adapter and existing owner.
// API/SQL membership, ordering and authority have separate integration evidence.
function TablePagesFlow({ startWithTable = false }: { startWithTable?: boolean }) {
  const [ready, setReady] = useState(false), [reads, setReads] = useState(0), [foreignReads, setForeignReads] = useState(0);
  const [boardReads, setBoardReads] = useState(0), [releaseBoard, setReleaseBoard] = useState<(() => void) | null>(null);
  const [release, setRelease] = useState<(() => void) | null>(null);
  const { initial, page, rows } = useMemo(() => {
    const epic = taskDetailStoryTask({ id: "table-epic", title: "Synthetic needle remembered Epic", taskType: "epic", status: "In Arbeit" });
    const parent = taskDetailStoryTask({ id: "table-parent", title: "Synthetic required ancestor", taskType: "initiative", parentTaskId: epic.id });
    const rows = Array.from({ length: 4 }, (_, index) => taskDetailStoryTask({ id: `table-row-${index}`, title: `Synthetic needle table row ${index + 1}`, taskType: "deliverable", status: "Offen", order: index, priority: "P1", parentTaskId: parent.id, assigneeId: profile.id }));
    const base = { revision: "table-r1", scopeRevision: "51", queryRevision: "table-r1", project: emptyPlanningShellState.project,
      people: [profile], sprints: [], relationships: [], blockers: [], preferences: [],
      coverage: { items: "partial", people: "complete", sprints: "complete", preferences: "complete", relationships: "partial", blockers: "partial" } as const };
    const query = normalizePlanningBoardQuery({ level: "epic", filters: { query: "needle" } });
    const columns = Object.fromEntries([...taskStatuses, "Pausiert"].map(status => [status, { total: status === "In Arbeit" ? 1 : 0, loaded: status === "In Arbeit" ? 1 : 0, completeness: "complete", continuation: null } satisfies PlanningBoardColumn])) as Record<TaskStatus, PlanningBoardColumn>;
    const initial: PlanningWorkspaceModel = { ...base, query, items: [epic], board: { query, queryKey: planningBoardQueryKey(query), revision: base.revision, observedAt, cardIds: [epic.id], columns,
      metrics: { total: 1, open: 1, done: 0, blocked: 0 }, childProgressById: { [epic.id]: null }, attentionById: { [epic.id]: [] }, viewerOpenSubIssueIdsByDeliverableId: {}, workspaceRevision: { activeTaskCount: 8, latestUpdatedAt: base.revision } } };
    const page = (continuation: boolean): PlanningWorkspaceModel => {
      const query = normalizePlanningBoardQuery({ view: "table", filters: { query: "needle" } });
      const selected = continuation ? rows.slice(2) : rows.slice(0, 2);
      return { ...base, query, items: [epic, parent, ...selected, ...(!continuation ? [rows[2]] : [])],
        table: { query, queryKey: planningBoardQueryKey(query), revision: base.revision, observedAt, validUntil: null, rowIds: selected.map(row => row.id),
          page: { total: 4, loaded: 2, completeness: continuation ? "complete" : "partial", continuation: continuation ? null : "table-next" },
          ...{ statusOptions: ["In Arbeit", "Offen", "Review", "Pausiert"] as TaskStatus[] },
          metrics: { total: 4, open: 4, done: 0, blocked: 0 }, attentionById: Object.fromEntries(selected.map(row => [row.id, null])), workspaceRevision: initial.board!.workspaceRevision } };
    };
    return { initial: startWithTable ? page(false) : initial, page, rows };
  }, [startWithTable]);
  useEffect(() => {
    const key = `founderops.product-updates.seen.${profile.id}`, previous = localStorage.getItem(key);
    localStorage.setItem(key, JSON.stringify(productUpdates.map(update => update.id)));
    let finish: (() => void) | undefined, finishBoard: (() => void) | undefined;
    const restore = mockAccountLifecycle("google", { linked: true }, input => {
      const url = new URL(input instanceof Request ? input.url : String(input), "http://localhost:3000");
      if (url.pathname === "/api/auth/session") return Response.json({ session });
      if (url.pathname === "/api/planning-source-version") return Response.json({ version: "51" });
      if (url.pathname === "/api/planning-board-data") {
        const scope = JSON.parse(url.searchParams.get("scope") || "{}");
        if (startWithTable && scope.view === "board" && !scope.column && !scope.continuation) {
          setBoardReads(value => value + 1);
          const query = normalizePlanningBoardQuery(scope), basis = page(false);
          const columns = Object.fromEntries([...taskStatuses, "Pausiert"].map(status => [status, { total: status === "Offen" ? 4 : 0, loaded: 0,
            availability: status === "Offen" ? "not-loaded" : "ready", completeness: status === "Offen" ? "partial" : "complete", continuation: null } satisfies PlanningBoardColumn])) as Record<TaskStatus, PlanningBoardColumn>;
          const model: PlanningWorkspaceModel = { ...basis, table: undefined, query, items: [], board: { query, queryKey: planningBoardQueryKey(query), revision: "table-r1", observedAt,
            cardIds: [], columns, metrics: { total: 4, open: 4, done: 0, blocked: 0 }, childProgressById: {}, attentionById: {}, viewerOpenSubIssueIdsByDeliverableId: {}, workspaceRevision: basis.table!.workspaceRevision } };
          const frames = [{ kind: "basis", readId: "cold-table-board", model, currentProfile: profile, readAuthority: authority },
            { kind: "column", readId: "cold-table-board", column: "Offen", scopeRevision: "51", queryRevision: "table-r1", observedAt, validUntil: null,
              cardIds: rows.map(row => row.id), items: rows, relationships: [], personalChildren: {}, taskOmittedFields: [], columnState: { total: 4, loaded: 4, availability: "ready", completeness: "complete", continuation: null } },
            { kind: "end", readId: "cold-table-board" }];
          return new Promise<Response>(resolve => { finishBoard = () => resolve(new Response(frames.map(frame => JSON.stringify(frame)).join("\n") + "\n", { headers: { "content-type": "application/x-ndjson" } })); setReleaseBoard(() => finishBoard!); });
        }
        if (scope.view !== "table" || scope.column || scope.filters?.query !== "needle") {
          setForeignReads(value => value + 1);
          return Response.json({ error: "Synthetic table requires its own scoped query" }, { status: 503 });
        }
        setReads(value => value + 1);
        const response = () => Response.json({ model: page(Boolean(scope.continuation)), currentProfile: profile, readAuthority: authority });
        if (!scope.continuation) return response();
        if (scope.continuation !== "table-next") return Response.json({ error: "Unexpected cursor" }, { status: 409 });
        return new Promise<Response>(resolve => { finish = () => resolve(response()); setRelease(() => finish!); });
      }
      if (url.pathname === "/api/github-app/status") return Response.json({ installation: { available: false }, user: { connected: false } });
      if (url.pathname === "/api/team/platform-releases/v1/releases") return Response.json({ releases: [] });
      return Response.json({ error: "Synthetic optional area unavailable" }, { status: 503 });
    });
    queueMicrotask(() => setReady(true));
    return () => { finish?.(); finishBoard?.(); restore(); if (previous === null) localStorage.removeItem(key); else localStorage.setItem(key, previous); };
  }, [page, rows, startWithTable]);
  return <><button type="button" onMouseDown={event => event.preventDefault()} disabled={!release} onClick={() => release?.()}>Tabellenseite liefern</button>
    <button type="button" onMouseDown={event => event.preventDefault()} disabled={!releaseBoard} onClick={() => releaseBoard?.()}>Boardantwort liefern</button>
    <output aria-label="Boardanfragen">{boardReads}</output>
    <output aria-label="Tabellenanfragen">{reads}</output><output aria-label="Fremde Planungsanfragen">{foreignReads}</output>
    {ready ? <PlanningStateProvider><PlanningApp initialWorkspace="planning" initialWorkspaceRead={planningWorkspaceHydration("planning", initial, session, authority)}
      initialData={{ ...emptyPlanningShellState, tasks: [...initial.items], profiles: [profile] }} initialHeaderData={emptyPlanningHeaderData}
      initialAuthUser={user} initialCurrentProfile={profile} initialProtectedDataLoaded authRequired source="supabase" /></PlanningStateProvider> : null}</>;
}
const meta = { title: "Planning/Table page delivery", component: TablePagesFlow,
  loaders: [async () => { await import("@/features/tasks/organisms/task-table-view"); return {}; }],
  parameters: { layout: "fullscreen", nextjs: { appDirectory: true, navigation: { pathname: "/planning" } } } } satisfies Meta<typeof TablePagesFlow>;
export default meta;
type Story = StoryObj<typeof meta>;

export const ScopedTablePagesRetainBoardAndRowInteraction: Story = { play: async ({ canvasElement }) => {
  const canvas = within(canvasElement);
  await canvas.findByRole("link", { name: "Synthetic needle remembered Epic" });
  await expect(canvas.getByRole("searchbox", { name: "Aufgaben durchsuchen" })).toHaveValue("needle");
  await userEvent.click(canvas.getByRole("button", { name: "Tabelle" }));
  const first = await canvas.findByRole("link", { name: "Synthetic needle table row 1" });
  await expect(canvas.getByRole("link", { name: "Synthetic needle table row 2" })).toBeVisible();
  await expect(canvas.queryByRole("link", { name: "Synthetic needle table row 3" })).not.toBeInTheDocument();
  await expect(canvas.queryByRole("link", { name: "Synthetic required ancestor" })).not.toBeInTheDocument();
  await expect(canvas.queryByRole("link", { name: "Synthetic needle remembered Epic" })).not.toBeInTheDocument();
  const tableHeader = within(canvas.getByRole("heading", { name: "Aufgaben", level: 2 }).parentElement!);
  await expect(tableHeader.getByText((_, element) => element?.tagName === "SPAN" && element.textContent === "2 von 4")).toBeVisible();
  await expect(canvas.getByLabelText("Tabellenanfragen")).toHaveTextContent("1");
  const load = canvas.getByRole("button", { name: "Weitere Aufgaben laden" });
  fireEvent.click(load); fireEvent.click(load);
  await waitFor(() => expect(canvas.getByRole("button", { name: "Tabellenseite liefern" })).toBeEnabled());
  const control = canvas.getByRole("combobox", { name: "Zuständigkeit für Synthetic needle table row 1 ändern" });
  await userEvent.click(control); await userEvent.keyboard("{Escape}");
  await waitFor(() => expect(control).toHaveFocus());
  const row = first.closest("tr, article")!, before = row.getBoundingClientRect();
  fireEvent.click(canvas.getByRole("button", { name: "Tabellenseite liefern" }));
  await canvas.findByRole("link", { name: "Synthetic needle table row 4" });
  await expect(control).toHaveFocus();
  await expect(Math.abs(row.getBoundingClientRect().top - before.top)).toBeLessThan(1);
  await expect(Math.abs(row.getBoundingClientRect().left - before.left)).toBeLessThan(1);
  await expect(canvas.getByRole("searchbox", { name: "Aufgaben durchsuchen" })).toHaveValue("needle");
  const rendered = canvas.getAllByRole("link", { name: /Synthetic needle table row/ });
  await expect(rendered.map(link => link.textContent)).toEqual([1, 2, 3, 4].map(index => `Synthetic needle table row ${index}`));
  await expect(canvas.queryByRole("button", { name: "Weitere Aufgaben laden" })).not.toBeInTheDocument();
  await expect(tableHeader.getByText((_, element) => element?.tagName === "SPAN" && element.textContent === "4 von 4")).toBeVisible();
  await expect(canvas.getByLabelText("Tabellenanfragen")).toHaveTextContent("2");
  await userEvent.click(canvas.getByRole("button", { name: "Board" }));
  await canvas.findByRole("link", { name: "Synthetic needle remembered Epic" });
  await expect(canvas.queryByRole("link", { name: "Synthetic needle table row 1" })).not.toBeInTheDocument();
  await expect(canvas.getByLabelText("Tabellenanfragen")).toHaveTextContent("2");
  await expect(canvas.getByLabelText("Fremde Planungsanfragen")).toHaveTextContent("0");
} };

export const OffPageStatusesRetainTheCompleteTableOptionBasis: Story = {
  parameters: { viewport: { defaultViewport: "desktop" } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement), document = within(canvasElement.ownerDocument.body);
    await canvas.findByRole("link", { name: "Synthetic needle remembered Epic" });
    await userEvent.click(canvas.getByRole("button", { name: "Tabelle" }));
    await canvas.findByRole("link", { name: "Synthetic needle table row 1" });
    await userEvent.click(canvas.getByRole("button", { name: "Aufgaben nach Status filtern" }));
    await userEvent.click(document.getByRole("combobox", { name: "Status wählen" }));
    await expect(document.getByRole("option", { name: "Review" })).toBeVisible();
    await expect(document.getByRole("option", { name: "Pausiert" })).toBeVisible();
    await expect(document.getAllByRole("option").map(option => option.textContent)).toEqual(["Alle Status", "In Arbeit", "Offen", "Review", "Pausiert"]);
    await userEvent.keyboard("{Escape}");
    await expect(canvas.getByRole("link", { name: "Synthetic needle table row 1" })).toBeVisible();
    await expect(canvas.getByLabelText("Tabellenanfragen")).toHaveTextContent("1");
    await expect(canvas.getByLabelText("Fremde Planungsanfragen")).toHaveTextContent("0");
  },
};

export const ColdTableRemainsVisibleUntilItsRequestedBoardIsReady: Story = {
  args: { startWithTable: true },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const first = await canvas.findByRole("link", { name: "Synthetic needle table row 1" });
    await canvas.findByRole("heading", { name: "Aufgaben", level: 2 });
    await userEvent.click(canvas.getByRole("button", { name: "Board" }));
    await waitFor(() => expect(canvas.getByRole("button", { name: "Boardantwort liefern" })).toBeEnabled());
    await expect(canvas.getByRole("heading", { name: "Aufgaben", level: 2 })).toBeVisible();
    await expect(canvas.queryByRole("region", { name: "Board nach Status" })).not.toBeInTheDocument();
    await expect(first).toBeVisible();
    await expect(canvas.getByRole("link", { name: "Synthetic needle table row 1" })).toBe(first);
    await expect(canvas.getByRole("status", { name: "Vorherige Suchergebnisse" })).toHaveTextContent("Vorherige Suche: needle.");
    await expect(canvas.getByRole("searchbox", { name: "Aufgaben durchsuchen" })).toHaveValue("needle");
    fireEvent.click(canvas.getByRole("button", { name: "Boardantwort liefern" }));
    await canvas.findByRole("region", { name: "Board nach Status" });
    await canvas.findByRole("link", { name: "Synthetic needle table row 4" });
    await expect(canvas.queryByRole("heading", { name: "Aufgaben", level: 2 })).not.toBeInTheDocument();
    await userEvent.click(canvas.getByRole("button", { name: "Tabelle" }));
    await canvas.findByRole("heading", { name: "Aufgaben", level: 2 });
    await expect(canvas.queryByRole("link", { name: "Synthetic needle table row 4" })).not.toBeInTheDocument();
    await expect(canvas.getByLabelText("Boardanfragen")).toHaveTextContent("1");
    await expect(canvas.getByLabelText("Tabellenanfragen")).toHaveTextContent("0");
    await expect(canvas.getByLabelText("Fremde Planungsanfragen")).toHaveTextContent("0");
  },
};
