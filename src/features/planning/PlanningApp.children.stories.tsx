import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { useEffect, useState } from "react";
import { expect, userEvent, waitFor, within } from "storybook/test";
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

let completeChildRead: (() => void) | undefined;
let completeSummaryRead: (() => void) | undefined;
let completeOpenedTarget: (() => void) | undefined;
let completeOpenedChildren: (() => void) | undefined;
let openedTargetSignal: AbortSignal | null | undefined;
let openedChildrenSignal: AbortSignal | null | undefined;
const openedAreas: string[] = [];
function ChildListFlow({ level = "deliverable", failure = "none", summaryFailure = false, parallelOpen = false }: { level?: "epic" | "initiative" | "deliverable"; failure?: "none" | "unavailable" | "forbidden"; summaryFailure?: boolean; parallelOpen?: boolean }) {
  const [ready, setReady] = useState(false);
  const [detailReads, setDetailReads] = useState(0);
  const [boardReads, setBoardReads] = useState(0);
  const [summaryReads, setSummaryReads] = useState(0);
  const base = itemPageModel(level);
  const parent = { ...base.item, id: `child-list-${level}`, title: `Parent ${level}`, detailAvailability: "summary" as const };
  const childType = level === "epic" ? "initiative" : level === "initiative" ? "deliverable" : "sub_issue";
  const children = [
    taskDetailStoryTask({ id: "on-demand-child", taskType: childType, parentTaskId: parent.id, title: "On-demand child", status: "Offen", assigneeId: itemPageProfile.id, ...(parallelOpen ? { updatedAt: "2026-11-02T12:00:00.000Z" } : {}) }),
    taskDetailStoryTask({ id: "finished-child", taskType: childType, parentTaskId: parent.id, title: "Finished child", status: "Erledigt", order: 2, ...(parallelOpen ? { updatedAt: "2026-11-02T12:00:00.000Z" } : {}) }),
  ];
  const query = normalizePlanningBoardQuery({ level });
  const columns = Object.fromEntries([...taskStatuses, "Pausiert"].map(status => [status, { total: status === parent.status ? 1 : 0, loaded: status === parent.status ? 1 : 0, completeness: "complete", continuation: null } satisfies PlanningBoardColumn])) as Record<TaskStatus, PlanningBoardColumn>;
  const model = { revision: "child-list-r1", ...(summaryFailure ? { scopeRevision: "child-list-r1" } : {}), project: base.project, items: [parent], people: [itemPageProfile], sprints: [], relationships: [], preferences: [], query,
    coverage: { items: "partial", people: "complete", strategies: "complete", raci: "complete", links: "complete", sprints: "complete", relationships: "complete", preferences: "complete" } as const,
    board: { query, queryKey: planningBoardQueryKey(query), revision: "child-list-r1", observedAt: "2026-11-07T00:00:00Z", cardIds: [parent.id], columns,
      childProgressById: { [parent.id]: summaryFailure ? null : { total: 2, completed: 1, unfinished: 1, percentage: 50 } },
      ...(summaryFailure ? { attentionById: { [parent.id]: null }, summaryRequests: [{ token: "child-summary-batch", cardIds: [parent.id], status: "unavailable" as const }] } : {}),
      metrics: { total: 1, open: 1, done: 0, blocked: 0 }, viewerOpenSubIssueIdsByDeliverableId: {}, workspaceRevision: { activeTaskCount: 3, latestUpdatedAt: "child-list-r1" } },
  };
  const [session] = useState(() => ({ user: itemPageUser, userId: itemPageUser.id, revision: "item-page-session", expiresAt: Math.floor(Date.now() / 1000) + 3600 }));
  useEffect(() => {
    completeChildRead = undefined;
    completeSummaryRead = undefined;
    completeOpenedTarget = undefined; completeOpenedChildren = undefined;
    openedTargetSignal = undefined; openedChildrenSignal = undefined; openedAreas.splice(0);
    let reads = 0;
    const seenKey = `founderops.product-updates.seen.${itemPageProfile.id}`;
    const previous = localStorage.getItem(seenKey);
    localStorage.setItem(seenKey, JSON.stringify(productUpdates.map(update => update.id)));
    let restore: (() => void) | undefined;
    let active = true;
    void mockItemPageBrowser({ respond: (input, init) => {
      const url = new URL(String(input), window.location.origin), path = url.pathname;
      if (path === "/api/planning-board-data") {
        if (url.searchParams.get("summaries")) {
          setSummaryReads(value => value + 1);
          return new Promise<Response>(resolve => { completeSummaryRead = () => resolve(Response.json({ readAuthority: { userId: session.userId, deadline: session.expiresAt * 1000 },
            summaries: { kind: "summaries", readId: "child-summary-read", token: "child-summary-batch", cardIds: [parent.id], scopeRevision: "child-list-r1", queryRevision: model.board.revision,
              observedAt: model.board.observedAt, validUntil: null, childProgressById: { [parent.id]: { completed: 1, total: 2, unfinished: 1, percentage: 50 } } } })); });
        }
        setBoardReads(value => value + 1); return Response.json({ readAuthority: { userId: session.userId, deadline: session.expiresAt * 1000 }, model, currentProfile: itemPageProfile });
      }
      if (path === "/api/planning-revision") return Response.json({ revision: model.board.workspaceRevision });
      if (path === `/api/tasks/${parent.id}/detail-data`) {
        if (parallelOpen && url.searchParams.get("area") === "target") return Response.json({ taskDetail: { ...base, item: { ...parent, detailAvailability: undefined } }, unavailable: [] });
        if (url.searchParams.get("area") !== "children") return Response.json({ error: "Independent child demand required" }, { status: 400 });
        setDetailReads(value => value + 1);
        if (++reads === 1 && failure !== "none") return Response.json({ error: failure === "forbidden" ? "Kein Zugriff auf diese Aufgabe." : "Details sind vorübergehend nicht erreichbar." }, { status: failure === "forbidden" ? 403 : 503 });
        const deadline = Date.now() + 60_000, observedAt = new Date().toISOString();
        const omitted: (keyof Task)[] = ["description", "problemStatement", "intendedOutcome", "scopeConstraints", "acceptanceCriteria", "evidenceRequired", "definitionOfDone", "note",
          "strategy", "raciAssignments", "evidenceLinks", "linkedPullRequests", "reviewEvidenceExceptionNote", "githubIssueSyncError", "decisionNote", "carryoverReason", "dependsOn", "evidenceLink", "assignee", "owner", "createdBy"];
        const compact = (task: Task) => {
          const row = { ...task, detailAvailability: "summary" as const };
          omitted.forEach(field => { delete row[field]; });
          return row;
        };
        return new Promise<Response>(resolve => { completeChildRead = () => resolve(Response.json({
          readAuthority: { userId: itemPageUser.id, deadline }, taskDetail: {
            revision: base.revision, readArea: "children", sourceRevision: `fixture-detail:${parent.id}:${base.revision}:children`, observedAt, validUntil: null,
            authorityDeadline: deadline, readActor: { profileId: itemPageProfile.id, platformRole: itemPageProfile.platformRole },
            supportingData: "omitted", taskOmittedFields: omitted, coverage: { children: "complete" },
            item: compact(parent), ancestors: base.ancestors.map(compact), children: children.map(compact), relatedItems: [],
            childProgress: { completed: 1, total: 2, unfinished: 1, percentage: 50 },
            discussion: { comments: [], externalComments: [] }, blockers: [], relationships: [], activity: [], reviews: [],
          }, unavailable: [],
        })); });
      }
      if (path === `/api/tasks/${children[0].id}/detail-data`) {
        setDetailReads(value => value + 1);
        if (parallelOpen) {
          const area = url.searchParams.get("area") || "complete";
          openedAreas.push(area);
          const signal = input instanceof Request ? input.signal : init?.signal;
          if (area === "target") {
            openedTargetSignal = signal;
            const deadline = Date.now() + 60_000, observedAt = new Date().toISOString();
            return new Promise<Response>(resolve => { completeOpenedTarget = () => resolve(Response.json({ readAuthority: { userId: itemPageUser.id, deadline }, taskDetail: { ...base,
              readArea: "target", sourceRevision: "parallel-open-source", observedAt, validUntil: null, authorityDeadline: deadline,
              readActor: { profileId: itemPageProfile.id, platformRole: itemPageProfile.platformRole }, coverage: {},
              item: { ...children[0], detailAvailability: undefined, description: "Canonical opened child", problemStatement: "Canonical opened child" },
              ancestors: [{ ...parent, detailAvailability: "summary" }], children: [] }, unavailable: [] })); });
          }
          if (area === "children") {
            openedChildrenSignal = signal;
            const deadline = Date.now() + 60_000, observedAt = new Date().toISOString();
            const compact = (row: Task) => ({ id: row.id, title: row.title, taskType: row.taskType, parentTaskId: row.parentTaskId,
              updatedAt: row.updatedAt, status: row.status, order: row.order, assigneeId: row.assigneeId, ownerId: row.ownerId, detailAvailability: "summary" });
            const child = taskDetailStoryTask({ id: "early-visible-sub-issue", taskType: "sub_issue", title: "Early complete child membership", parentTaskId: children[0].id, status: "Offen" });
            return new Promise<Response>(resolve => { completeOpenedChildren = () => resolve(Response.json({ readAuthority: { userId: itemPageUser.id, deadline }, taskDetail: {
              revision: base.revision, readArea: "children", sourceRevision: "parallel-open-source", observedAt, validUntil: null, authorityDeadline: deadline,
              readActor: { profileId: itemPageProfile.id, platformRole: itemPageProfile.platformRole }, supportingData: "omitted",
              taskOmittedFields: ["description", "problemStatement", "assignee", "owner", "createdBy"], coverage: { children: "complete" },
              item: compact(children[0]), ancestors: [compact(parent)], children: [compact(child)], relatedItems: [],
              childProgress: { completed: 0, total: 1, unfinished: 1, percentage: 0 },
              discussion: { comments: [], externalComments: [] }, blockers: [], relationships: [], activity: [], reviews: [],
            }, unavailable: [] })); });
          }
          return Response.json({ error: "Independent scoped demand required" }, { status: 400 });
        }
        return Response.json({ taskDetail: { ...base, item: { ...children[0], problemStatement: "The child detail is loaded independently.", description: "The child detail is loaded independently." }, ancestors: [{ ...parent, detailAvailability: "summary" }], children: [] }, unavailable: [] });
      }
      return undefined;
    } }).then(cleanup => { if (!active) cleanup(); else { restore = cleanup; setReady(true); } });
    return () => { active = false; completeOpenedChildren?.(); completeOpenedTarget?.(); restore?.(); if (previous === null) localStorage.removeItem(seenKey); else localStorage.setItem(seenKey, previous); };
    // The fixture is fixed for the lifetime of one story.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return <><output className="sr-only" aria-label="Child detail reads">{detailReads}</output><output className="sr-only" aria-label="Child Board reads">{boardReads}</output><output className="sr-only" aria-label="Summary reads">{summaryReads}</output>{summaryFailure ? <button type="button" onClick={() => undefined}>Interaktion abschließen</button> : null}{ready ? <PlanningStateProvider><PlanningApp initialWorkspace="planning" initialWorkspaceRead={planningWorkspaceHydration("planning", model, session, { userId: session.userId, deadline: session.expiresAt * 1000 })} initialData={{ ...emptyPlanningShellState, tasks: [parent], profiles: [itemPageProfile] }} initialHeaderData={itemPageHeaderData} initialAuthUser={itemPageUser} initialCurrentProfile={itemPageProfile} initialProtectedDataLoaded authRequired source="supabase" /></PlanningStateProvider> : null}</>;
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

export const SummaryFailureKeepsCardsAndRetriesOnlySummaries: Story = { args: { summaryFailure: true }, play: async ({ canvasElement }) => {
  const canvas = within(canvasElement), cardLink = await canvas.findByRole("link", { name: "Parent deliverable" });
  await expect(canvas.getByText("Kindfortschritt unbekannt")).toBeVisible();
  await expect(canvas.getByText("Signale unbekannt")).toBeVisible();
  const retry = canvas.getByRole("button", { name: "Fortschritt und Signale erneut laden" });
  retry.focus(); await userEvent.keyboard("[Enter]");
  await waitFor(() => expect(completeSummaryRead).toBeDefined());
  await expect(retry).toHaveFocus();
  await expect(canvas.getByLabelText("Summary reads")).toHaveTextContent("1");
  await expect(canvas.getByLabelText("Child Board reads")).toHaveTextContent("0");
  const card = cardLink.closest("article")!;
  const control = within(card).getByRole("button", { name: "Status für Parent deliverable ändern" });
  await userEvent.click(control); await userEvent.keyboard("{Escape}");
  await waitFor(() => expect(control).toHaveFocus());
  const top = card.getBoundingClientRect().top, scroll = window.scrollY;
  completeSummaryRead?.();
  await expect(control).toHaveFocus();
  await expect(canvas.getByText("Kindfortschritt unbekannt")).toBeVisible();
  await expect(card.getBoundingClientRect().top).toBe(top);
  await expect(window.scrollY).toBe(scroll);
  await userEvent.keyboard("{Escape}");
  await userEvent.click(canvas.getByRole("button", { name: "Interaktion abschließen" }));
  await expect(await canvas.findByText("50%")).toBeVisible();
  await expect(canvas.getByLabelText("Child detail reads")).toHaveTextContent("0");
  await expect(canvas.getByLabelText("Child Board reads")).toHaveTextContent("0");
  await expect(canvas.getByLabelText("Summary reads")).toHaveTextContent("1");
} };

export const DeniedChildListKeepsASafeOutcome: Story = { args: { failure: "forbidden" }, play: async ({ canvasElement }) => {
  const { canvas } = await expandChildren(canvasElement);
  await expect(await canvas.findByText("Kinder dürfen nicht geladen werden.")).toBeVisible();
  await expect(canvas.queryByRole("link", { name: /On-demand child/ })).not.toBeInTheDocument();
  await expect(canvas.queryByText("Parent deliverable")).not.toBeInTheDocument();
  await expect(canvas.queryByRole("region", { name: "Board nach Status" })).not.toBeInTheDocument();
  await expect(canvas.getByLabelText("Child Board reads")).toHaveTextContent("0");
} };


async function openHeldChild(canvasElement: HTMLElement) {
  const { canvas } = await expandChildren(canvasElement);
  await waitFor(() => expect(completeChildRead).toBeDefined());
  completeChildRead?.();
  await userEvent.click(await canvas.findByRole("link", { name: "On-demand child, Status Offen" }));
  await waitFor(() => expect(completeOpenedTarget).toBeDefined());
  return { canvas };
}

export const ChildrenStartWhileTargetIsHeldWithoutUnlockingTheEditor: Story = {
  args: { level: "initiative", parallelOpen: true },
  play: async ({ canvasElement }) => {
    const { canvas } = await openHeldChild(canvasElement);
    await waitFor(() => expect(openedAreas.filter(area => area === "children")).toHaveLength(1));
    const panel = await canvas.findByRole("dialog"), detail = within(panel);
    await expect(detail.getByRole("link", { name: "Große Ansicht" })).toHaveAttribute("href", "/tasks/on-demand-child");
    await expect(detail.getByText("Aufgabendetails werden geladen …")).toBeVisible();
    completeOpenedChildren?.();
    await expect(detail.queryByRole("button", { name: "Bearbeiten" })).not.toBeInTheDocument();
    await expect(detail.queryByText("Canonical opened child")).not.toBeInTheDocument();
    await expect(openedTargetSignal?.aborted).toBe(false);
    await expect(openedAreas.filter(area => area === "target")).toHaveLength(1);
    completeOpenedTarget?.();
    await expect(await detail.findByText("Canonical opened child")).toBeVisible();
    await expect(await detail.findByRole("link", { name: /Early complete child membership/ })).toBeVisible();
    await waitFor(() => expect(detail.getByRole("button", { name: "Bearbeiten" })).toBeEnabled());
    await expect(openedAreas.filter(area => area === "target")).toHaveLength(1);
  },
};

export const FirstTargetBecomesEditableWhileChildrenAreHeld: Story = {
  args: { level: "initiative", parallelOpen: true },
  play: async ({ canvasElement }) => {
    const { canvas } = await openHeldChild(canvasElement);
    completeOpenedTarget?.();
    const panel = await canvas.findByRole("dialog", { name: "On-demand child" }), detail = within(panel);
    await expect(await detail.findByText("Canonical opened child")).toBeVisible();
    await waitFor(() => expect(completeOpenedChildren).toBeDefined());
    await waitFor(() => expect(detail.getByRole("button", { name: "Bearbeiten" })).toBeEnabled());
    await userEvent.click(detail.getByRole("button", { name: "Bearbeiten" }));
    const title = await detail.findByRole("textbox", { name: "Titel" });
    await userEvent.clear(title); await userEvent.type(title, "Current target draft");
    completeOpenedChildren?.();
    await expect(await detail.findByRole("link", { name: /Early complete child membership/ })).toBeVisible();
    await expect(title).toHaveValue("Current target draft");
    await expect(title).toHaveFocus();
    await expect(openedAreas.filter(area => area === "target")).toHaveLength(1);
  },
};

export const SelectionChangeAbortsEarlyChildrenAndRejectsLateResults: Story = {
  args: { level: "initiative", parallelOpen: true },
  play: async ({ canvasElement }) => {
    const { canvas } = await openHeldChild(canvasElement);
    await waitFor(() => expect(completeOpenedChildren).toBeDefined());
    const panel = await canvas.findByRole("dialog");
    await expect(panel).toBeVisible();
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(openedChildrenSignal?.aborted).toBe(true));
    await expect(openedTargetSignal?.aborted).toBe(true);
    await userEvent.click(canvas.getByRole("link", { name: "Parent initiative" }));
    const current = await canvas.findByRole("dialog", { name: "Parent initiative" });
    completeOpenedChildren?.(); completeOpenedTarget?.();
    await expect(within(current).queryByText("Early complete child membership")).not.toBeInTheDocument();
    await expect(within(current).queryByText("Canonical opened child")).not.toBeInTheDocument();
    await expect(current).toBeVisible();
    await expect(openedAreas.filter(area => area === "target")).toHaveLength(1);
  },
};
