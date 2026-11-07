import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { useEffect, useState } from "react";
import { expect, userEvent, waitFor, within } from "storybook/test";
import { PlanningApp } from "./PlanningApp";
import { PlanningStateProvider } from "./organisms/planning-state-provider";
import { emptyPlanningShellState } from "./model/planning-shell-state";
import { planningWorkspaceHydration } from "./model/planning-workspace-hydration";
import { normalizePlanningBoardQuery, planningBoardQueryKey, type PlanningBoardColumn } from "./model/planning-board-query";
import { taskStatuses } from "@/lib/status";
import type { TaskStatus } from "@/lib/types";
import { productUpdates } from "@/features/product-updates/model/product-update-registry";
import { taskDetailStoryTask } from "@/features/tasks/molecules/task-detail-story-fixtures";
import { itemPageModel, itemPageProfile, itemPageUser, itemPageHeaderData, mockItemPageBrowser } from "../../../tests/helpers/task-detail-page-browser-fixture";

let completeChildRead: (() => void) | undefined;
function ChildListFlow({ level = "deliverable", failure = "none" }: { level?: "epic" | "initiative" | "deliverable"; failure?: "none" | "unavailable" | "forbidden" }) {
  const [ready, setReady] = useState(false);
  const [detailReads, setDetailReads] = useState(0);
  const [boardReads, setBoardReads] = useState(0);
  const base = itemPageModel(level);
  const parent = { ...base.item, id: `child-list-${level}`, title: `Parent ${level}`, detailAvailability: "summary" as const };
  const childType = level === "epic" ? "initiative" : level === "initiative" ? "deliverable" : "sub_issue";
  const children = [
    taskDetailStoryTask({ id: "on-demand-child", taskType: childType, parentTaskId: parent.id, title: "On-demand child", status: "Offen", assigneeId: itemPageProfile.id }),
    taskDetailStoryTask({ id: "finished-child", taskType: childType, parentTaskId: parent.id, title: "Finished child", status: "Erledigt", order: 2 }),
  ];
  const query = normalizePlanningBoardQuery({ level });
  const columns = Object.fromEntries([...taskStatuses, "Pausiert"].map(status => [status, { total: status === parent.status ? 1 : 0, loaded: status === parent.status ? 1 : 0, completeness: "complete", continuation: null } satisfies PlanningBoardColumn])) as Record<TaskStatus, PlanningBoardColumn>;
  const model = { revision: "child-list-r1", project: base.project, items: [parent], people: [itemPageProfile], sprints: [], relationships: [], preferences: [], query,
    coverage: { items: "partial", people: "complete", strategies: "complete", raci: "complete", links: "complete", sprints: "complete", relationships: "complete", preferences: "complete" } as const,
    board: { query, queryKey: planningBoardQueryKey(query), revision: "child-list-r1", observedAt: "2026-11-07T00:00:00Z", cardIds: [parent.id], columns,
      childProgressById: { [parent.id]: { total: 2, completed: 1, unfinished: 1, percentage: 50 } }, metrics: { total: 1, open: 1, done: 0, blocked: 0 }, viewerOpenSubIssueIdsByDeliverableId: {}, workspaceRevision: { activeTaskCount: 3, latestUpdatedAt: "child-list-r1" } },
  };
  const [session] = useState(() => ({ user: itemPageUser, userId: itemPageUser.id, revision: "item-page-session", expiresAt: Math.floor(Date.now() / 1000) + 3600 }));
  useEffect(() => {
    completeChildRead = undefined;
    let reads = 0;
    const seenKey = `founderops.product-updates.seen.${itemPageProfile.id}`;
    const previous = localStorage.getItem(seenKey);
    localStorage.setItem(seenKey, JSON.stringify(productUpdates.map(update => update.id)));
    let restore: (() => void) | undefined;
    let active = true;
    void mockItemPageBrowser({ respond: input => {
      const path = new URL(String(input), window.location.origin).pathname;
      if (path === "/api/planning-board-data") { setBoardReads(value => value + 1); return Response.json({ model, currentProfile: itemPageProfile }); }
      if (path === "/api/planning-revision") return Response.json({ revision: model.board.workspaceRevision });
      if (path === `/api/tasks/${parent.id}/detail-data`) {
        setDetailReads(value => value + 1);
        if (++reads === 1 && failure !== "none") return Response.json({ error: failure === "forbidden" ? "Kein Zugriff auf diese Aufgabe." : "Details sind vorübergehend nicht erreichbar." }, { status: failure === "forbidden" ? 403 : 503 });
        return new Promise<Response>(resolve => { completeChildRead = () => resolve(Response.json({ taskDetail: { ...base, item: { ...parent, detailAvailability: undefined }, children }, unavailable: [] })); });
      }
      if (path === `/api/tasks/${children[0].id}/detail-data`) {
        setDetailReads(value => value + 1);
        return Response.json({ taskDetail: { ...base, item: { ...children[0], problemStatement: "The child detail is loaded independently.", description: "The child detail is loaded independently." }, ancestors: [{ ...parent, detailAvailability: "summary" }], children: [] }, unavailable: [] });
      }
      return undefined;
    } }).then(cleanup => { if (!active) cleanup(); else { restore = cleanup; setReady(true); } });
    return () => { active = false; restore?.(); if (previous === null) localStorage.removeItem(seenKey); else localStorage.setItem(seenKey, previous); };
    // The fixture is fixed for the lifetime of one story.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return <><output className="sr-only" aria-label="Child detail reads">{detailReads}</output><output className="sr-only" aria-label="Child Board reads">{boardReads}</output>{ready ? <PlanningStateProvider><PlanningApp initialWorkspace="planning" initialWorkspaceRead={planningWorkspaceHydration("planning", model, session)} initialData={{ ...emptyPlanningShellState, tasks: [parent], profiles: [itemPageProfile] }} initialHeaderData={itemPageHeaderData} initialAuthUser={itemPageUser} initialCurrentProfile={itemPageProfile} initialProtectedDataLoaded authRequired source="supabase" /></PlanningStateProvider> : null}</>;
}
const meta = { title: "Planning/On-demand children", component: ChildListFlow, parameters: { layout: "fullscreen", nextjs: { appDirectory: true, navigation: { pathname: "/planning" } } } } satisfies Meta<typeof ChildListFlow>;
export default meta;
type Story = StoryObj<typeof meta>;

async function expandChildren(canvasElement: HTMLElement) {
  const canvas = within(canvasElement);
  const toggle = await canvas.findByRole("button", { name: /anzeigen: 1 offen, 1 erledigt/ });
  await expect(canvas.getByText("50%")).toBeVisible();
  await expect(canvas.getByLabelText("Child detail reads")).toHaveTextContent("0");
  toggle.focus();
  await userEvent.keyboard("[Enter]");
  return { canvas, toggle };
}
async function completeAndOpenChild(canvasElement: HTMLElement) {
  const { canvas, toggle } = await expandChildren(canvasElement);
  await expect(await canvas.findByText("Kinder werden geladen …")).toBeVisible();
  await expect(toggle).toHaveFocus();
  await waitFor(() => expect(completeChildRead).toBeDefined());
  completeChildRead?.();
  const child = await canvas.findByRole("link", { name: "On-demand child, Status Offen" });
  await expect(child).toBeVisible();
  await expect(within(canvas.getByRole("region", { name: "Board nach Status" })).getAllByRole("article")).toHaveLength(1);
  await userEvent.click(toggle);
  await userEvent.click(toggle);
  await expect(canvas.getByLabelText("Child detail reads")).toHaveTextContent("1");
  await userEvent.click(canvas.getByRole("link", { name: "On-demand child, Status Offen" }));
  const panel = await canvas.findByRole("dialog", { name: "On-demand child" }, { timeout: 5000 });
  await expect(await within(panel).findByText("The child detail is loaded independently.")).toBeVisible();
  await expect(canvas.getByLabelText("Child Board reads")).toHaveTextContent("0");
}
export const DeliverableChildrenLoadOnExpansion: Story = { play: async ({ canvasElement }) => completeAndOpenChild(canvasElement) };
export const InitiativeChildrenLoadOnExpansion: Story = { args: { level: "initiative" }, play: async ({ canvasElement }) => completeAndOpenChild(canvasElement) };
export const EpicChildrenLoadOnExpansion: Story = { args: { level: "epic" }, play: async ({ canvasElement }) => completeAndOpenChild(canvasElement) };
export const ChildListFailureCanBeRetried: Story = { args: { failure: "unavailable" }, play: async ({ canvasElement }) => {
  const { canvas, toggle } = await expandChildren(canvasElement);
  await expect(await canvas.findByText("Kinder konnten nicht geladen werden.")).toBeVisible();
  await expect(toggle).toHaveFocus();
  await expect(canvas.getByText("50%")).toBeVisible();
  const retry = canvas.getByRole("button", { name: "Kinder erneut laden" });
  await userEvent.click(retry);
  await waitFor(() => expect(completeChildRead).toBeDefined());
  await expect(retry).toHaveFocus();
  completeChildRead?.();
  await expect(await canvas.findByRole("link", { name: "On-demand child, Status Offen" })).toBeVisible();
  await expect(retry).toHaveFocus();
  await expect(canvas.getByLabelText("Child Board reads")).toHaveTextContent("0");
} };

export const DeniedChildListKeepsASafeOutcome: Story = { args: { failure: "forbidden" }, play: async ({ canvasElement }) => {
  const { canvas } = await expandChildren(canvasElement);
  await expect(await canvas.findByText("Kinder dürfen nicht geladen werden.")).toBeVisible();
  await expect(canvas.queryByRole("link", { name: /On-demand child/ })).not.toBeInTheDocument();
  await expect(canvas.queryByText("Parent deliverable")).not.toBeInTheDocument();
  await expect(canvas.queryByRole("region", { name: "Board nach Status" })).not.toBeInTheDocument();
  await expect(canvas.getByLabelText("Child Board reads")).toHaveTextContent("0");
} };
