import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { useEffect, useState } from "react";
import { expect, userEvent, within } from "storybook/test";
import { PlanningApp } from "./PlanningApp";
import { PlanningStateProvider } from "./organisms/planning-state-provider";
import { emptyPlanningShellState } from "./model/planning-shell-state";
import { planningWorkspaceHydration } from "./model/planning-workspace-hydration";
import { normalizePlanningBoardQuery, planningBoardQueryKey, type PlanningBoardColumn } from "./model/planning-board-query";
import { taskStatuses } from "@/lib/status";
import type { Task, TaskStatus } from "@/lib/types";
import { productUpdates } from "@/features/product-updates/model/product-update-registry";
import { taskDetailStoryTask } from "@/features/tasks/molecules/task-detail-story-fixtures";
import { itemPageModel, itemPageProfile, itemPageUser, itemPageHeaderData, mockItemPageBrowser } from "../../../tests/helpers/task-detail-page-browser-fixture";

const full = taskDetailStoryTask({ id: "compact-card", title: "Compact card", description: "Complete description", problemStatement: "Full problem statement", acceptanceCriteria: "Full acceptance criteria", definitionOfDone: "Full definition of done", evidenceLink: "https://example.test/evidence", status: "Offen" });
const omitted: (keyof Task)[] = ["description", "problemStatement", "acceptanceCriteria", "definitionOfDone"];
const compact = { ...full, detailAvailability: "summary" as const };
for (const field of omitted) delete compact[field];
const query = normalizePlanningBoardQuery({ view: "board" });
const columns = Object.fromEntries([...taskStatuses, "Pausiert"].map(status => [status, { total: status === "Offen" ? 1 : 0, loaded: status === "Offen" ? 1 : 0, completeness: "complete", continuation: null } satisfies PlanningBoardColumn])) as Record<TaskStatus, PlanningBoardColumn>;
const model = { revision: "compact-r1", project: emptyPlanningShellState.project, items: [compact], people: [itemPageProfile], sprints: [], relationships: [], blockers: [], preferences: [], query, taskOmittedFields: omitted,
  coverage: { items: "partial", people: "complete", strategies: "complete", raci: "complete", links: "complete", sprints: "complete", relationships: "complete", blockers: "complete", preferences: "complete" } as const,
  board: { query, queryKey: planningBoardQueryKey(query), revision: "compact-r1", observedAt: "2026-11-07T00:00:00Z", cardIds: [full.id], columns, attentionById: { [full.id]: [] }, childProgressById: {}, metrics: { total: 1, open: 1, done: 0, blocked: 0 }, viewerOpenSubIssueIdsByDeliverableId: {}, workspaceRevision: { activeTaskCount: 1, latestUpdatedAt: "compact-r1" } },
};
const completed = Array.from({ length: 21 }, (_, index) => ({ ...compact, id: `compact-done-${index}`, title: `Completed compact card ${index + 1}`, status: "Erledigt", order: index }));
function compactPage(next = false) {
  const cards = next ? completed.slice(20) : [compact, ...completed.slice(0, 20)];
  return { ...model, items: cards, board: { ...model.board, column: next ? "Erledigt" as const : undefined, cardIds: cards.map(task => task.id), attentionById: Object.fromEntries(cards.map(task => [task.id, []])), metrics: { total: 22, open: 1, done: 21, blocked: 0 }, columns: { ...columns, Erledigt: { total: 21, loaded: next ? 1 : 20, continuation: next ? null : "next-compact-page", completeness: next ? "complete" as const : "partial" as const } }, workspaceRevision: { activeTaskCount: 22, latestUpdatedAt: "compact-r1" } } };
}
function CompactBoardFlow({ bootstrap = false, paging = false }: { bootstrap?: boolean; paging?: boolean }) {
  const initialModel = paging ? compactPage() : model;
  const [ready, setReady] = useState(false);
  const [unscopedReads, setUnscopedReads] = useState(0);
  const [detailReads, setDetailReads] = useState(0);
  const [session] = useState(() => ({ user: itemPageUser, userId: itemPageUser.id, revision: "item-page-session", expiresAt: Math.floor(Date.now() / 1000) + 3600 }));
  useEffect(() => {
    const key = `founderops.product-updates.seen.${itemPageProfile.id}`;
    const previous = localStorage.getItem(key);
    localStorage.setItem(key, JSON.stringify(productUpdates.map(update => update.id)));
    let active = true;
    let restore: (() => void) | undefined;
    void mockItemPageBrowser({ respond: input => {
      const url = new URL(String(input), window.location.origin);
      if (url.pathname === "/api/planning-board-data") {
        if (!url.searchParams.has("scope")) setUnscopedReads(value => value + 1);
        return Response.json({ model: paging ? compactPage(Boolean(JSON.parse(url.searchParams.get("scope") || "{}").continuation)) : model, currentProfile: itemPageProfile });
      }
      if (url.pathname === "/api/planning-revision") return Response.json({ revision: initialModel.board.workspaceRevision });
      if (url.pathname === `/api/tasks/${full.id}/detail-data`) {
        setDetailReads(value => value + 1);
        return Response.json({ taskDetail: { ...itemPageModel("deliverable"), item: full, children: [] }, unavailable: [] });
      }
      return undefined;
    } }).then(cleanup => { if (!active) cleanup(); else { restore = cleanup; setReady(true); } });
    return () => { active = false; restore?.(); if (previous === null) localStorage.removeItem(key); else localStorage.setItem(key, previous); };
    // The initial fixture is fixed for one mounted story.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return <><output className="sr-only" aria-label="Unscoped reads">{unscopedReads}</output><output className="sr-only" aria-label="Detail reads">{detailReads}</output>{ready ? <PlanningStateProvider><PlanningApp initialWorkspace="planning" initialWorkspaceRead={planningWorkspaceHydration("planning", bootstrap ? { ...model, items: [], query: undefined, board: undefined } : initialModel, session)} initialData={bootstrap ? { ...emptyPlanningShellState, profiles: [itemPageProfile] } : { ...emptyPlanningShellState, tasks: initialModel.items, profiles: [itemPageProfile] }} initialHeaderData={itemPageHeaderData} initialAuthUser={itemPageUser} initialCurrentProfile={itemPageProfile} initialProtectedDataLoaded={!bootstrap} authRequired source="supabase" /></PlanningStateProvider> : null}</>;
}
const meta = { title: "Planning/Compact Board flow", component: CompactBoardFlow, parameters: { layout: "fullscreen", nextjs: { appDirectory: true, navigation: { pathname: "/planning" } } } } satisfies Meta<typeof CompactBoardFlow>;
export default meta;
type Story = StoryObj<typeof meta>;
export const CompactSignalsAndFullDetail: Story = { play: async ({ canvasElement }) => {
  const canvas = within(canvasElement);
  const board = await canvas.findByRole("region", { name: "Board nach Status" });
  await expect(within(board).queryByText("AC fehlt")).not.toBeInTheDocument();
  await expect(within(board).queryByText("DoD fehlt")).not.toBeInTheDocument();
  await expect(canvas.getByLabelText("Detail reads")).toHaveTextContent("0");
  await userEvent.click(within(board).getByRole("link", { name: "Compact card" }));
    const panel = await canvas.findByRole("dialog", { name: "Compact card" }, { timeout: 5000 });
  await expect(await within(panel).findByText("Full acceptance criteria")).toBeVisible();
  await expect(await within(panel).findByText("Full definition of done")).toBeVisible();
  await expect(canvas.getByLabelText("Detail reads")).toHaveTextContent("1");
  await expect(canvas.getByLabelText("Unscoped reads")).toHaveTextContent("0");
} };
export const BootstrapAlwaysDeclaresBoardScope: Story = { args: { bootstrap: true }, play: async ({ canvasElement }) => {
  const canvas = within(canvasElement);
  await canvas.findByRole("region", { name: "Board nach Status" });
  await expect(canvas.getByLabelText("Unscoped reads")).toHaveTextContent("0");
} };

export const ProgressivePagesKeepExistingSignals: Story = { args: { paging: true }, play: async ({ canvasElement }) => {
  const canvas = within(canvasElement);
  const board = await canvas.findByRole("region", { name: "Board nach Status" });
  await expect(within(board).queryByText("AC fehlt")).not.toBeInTheDocument();
  await userEvent.click(within(board).getByRole("button", { name: "Weitere erledigte laden" }));
  await expect(await within(board).findByText("21 von 21 geladen")).toBeVisible();
  await expect(within(board).getByRole("link", { name: "Completed compact card 21" })).toBeVisible();
  await expect(within(board).queryAllByText("AC fehlt")).toHaveLength(0);
  await expect(within(board).queryAllByText("DoD fehlt")).toHaveLength(0);
} };
