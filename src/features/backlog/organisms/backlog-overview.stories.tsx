import { buildBacklogTableViewModel, buildBacklogViewModel, DEFAULT_BACKLOG_FILTERS } from "../model/backlog-view-model";
import { useEffect, useState, useSyncExternalStore } from "react";
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, fireEvent, userEvent, waitFor, within } from "storybook/test";
import { BacklogOverview } from "./backlog-overview";
import { createBrowserPlanningState } from "@/features/planning/model/internal/browser-planning-state";
import { emptyPlanningShellState } from "@/features/planning/model/planning-shell-state";
import { emptyPlanningHeaderData } from "@/lib/planning-header-data";
import { taskDetailStoryTask } from "@/features/tasks/molecules/task-detail-story-fixtures";
import type { BrowserApiClient, BrowserApiJsonResult } from "@/lib/browser-api-client";
import type { BacklogModel } from "../model/backlog-read-model";
import type { AuthenticatedProfile, Sprint, Task } from "@/lib/types";
const sprint: Sprint = { id: "sprint-1", name: "Sprint 1", status: "active", startDate: "2026-10-26", endDate: "2026-11-01", reviewDueAt: "2026-11-03", scoreLocked: false, updatedAt: "s1" };
const tasks = [taskDetailStoryTask({ id: "a", title: "Deliverable Alpha", taskType: "deliverable", approvalStatus: "approved", parentTaskId: "initiative", parentApprovalStatus: "approved", assigneeId: "founder", ownerId: "founder", sprintId: "", updatedAt: "r1", order: 10 }), taskDetailStoryTask({ id: "b", title: "Deliverable Beta", taskType: "deliverable", approvalStatus: "approved", parentTaskId: "initiative", parentApprovalStatus: "approved", assigneeId: "founder", ownerId: "founder", sprintId: "", updatedAt: "r1", order: 20 }), taskDetailStoryTask({ id: "initiative", title: "Approved Initiative", taskType: "initiative", approvalStatus: "approved", parentTaskId: "", updatedAt: "i1" })];
const model: BacklogModel = { revision: "initial", items: tasks, people: [], sprints: [sprint], commitments: [], coverage: { items: "complete", people: "complete", sprints: "complete", commitments: "complete", strategies: "complete", raci: "complete", links: "complete" } };
const controls = new Map<string, { completeRead(): void; completeMove(): void; writes(): number }>();
function Fixture({ scenario = "success" }: { scenario?: string }) {
 const [network] = useState(() => {
   let writes = 0, reads = 0, completeRead = () => {}, completeMove = () => {};
   const current = { ...model, items: tasks.map(task => ({ ...task, updatedAt: ["sprint-chooser", "bulk-sprint-basis"].includes(scenario) ? task.updatedAt : task.id === "a" ? "foreign-r2" : task.updatedAt })), sprints: ["sprint-chooser", "bulk-sprint-basis"].includes(scenario) ? [{ ...sprint, updatedAt: "foreign-sprint" }] : [sprint] };
   const client: BrowserApiClient = {
     async requestJson<T>(url: Parameters<BrowserApiClient["requestJson"]>[0], options?: Parameters<BrowserApiClient["requestJson"]>[1]) {
       if (!options?.method) { reads++; if (reads > 1) return new Promise<BrowserApiJsonResult<T>>(resolve => { completeRead = () => resolve({ response: new Response(null), body: { model: current } as T }); }); return { response: new Response(null), body: { model } as T }; }
       writes++; if (["unknown", "order-unknown"].includes(scenario)) return { response: new Response(null, { status: 503 }), body: { error: "Bestätigung verloren" } as T };
       if (["denied", "order-denied"].includes(scenario)) return { response: new Response(null, { status: 403 }), body: { error: "Keine Berechtigung" } as T };
       if (String(url).includes("backlog-order")) {
         const body = { completeness: scenario === "order-partial" ? "partial" : "complete", updates: scenario === "order-partial" ? [{ id: "b", sortOrder: 10, updatedAt: "confirmed-r3" }] : [{ id: "a", sortOrder: 20, updatedAt: "confirmed-r3" }, { id: "b", sortOrder: 10, updatedAt: "confirmed-r3" }] };
         if (scenario === "order-delayed") return new Promise<BrowserApiJsonResult<T>>(resolve => { completeMove = () => resolve({ response: new Response(null), body: body as T }); });
         return { response: new Response(null), body: body as T };
       }
       const bulk = String(url).includes("bulk-sprint"); const ids = bulk ? ((options.json as { assignments: { taskId: string }[] }).assignments.map(item => item.taskId)) : [String(url).split("/").at(-1)!];
       const updates = (scenario === "partial" ? ids.slice(0,1) : ids).map(id => ({ id, sprintId: sprint.id, scoreRelevant: true, updatedAt: "confirmed-r3" })); return { response: new Response(null), body: (bulk ? { updates } : { task: updates[0] }) as T };
     }, requestForm: async () => { throw new Error("Unexpected upload"); }, requestBlob: async () => { throw new Error("Unexpected blob"); },
   };
   const value = { client, completeRead: () => completeRead(), completeMove: () => completeMove(), writes: () => writes }; controls.set(scenario, value); return value;
 });
 const [owner] = useState(() => { const value = createBrowserPlanningState({ initialData: { ...emptyPlanningShellState, tasks, sprints: [sprint] }, initialWorkspace: "backlog", initialUserId: "backlog-user", initialHeaderData: emptyPlanningHeaderData, initialCurrentProfile: { id: "founder", platformRole: "ceo", name: "CEO" } as AuthenticatedProfile }); value.runtime.session = {userId:value.runtime.userId,revision:"story-session",expiresAt:4102444800,user:{id:value.runtime.userId}}; value.runtime.apiClient = network.client; return value.owner; });
 useSyncExternalStore(owner.planning.subscribe, owner.internal.getSnapshot, owner.internal.getSnapshot);
 const [showBacklog, setShowBacklog] = useState(true);
 return <main><button onClick={() => setShowBacklog(value => !value)}>Ansicht wechseln</button><h1>Backlog assignment</h1><button onClick={() => void owner.planning.refreshWorkspace("backlog")}>Start background read</button><p>Detail Alpha version: {owner.planning.taskDetail("a").task?.updatedAt}</p><p>Detail Alpha order: {owner.planning.taskDetail("a").task?.order}</p><p>Detail Beta order: {owner.planning.taskDetail("b").task?.order}</p><p>Detail Alpha: {owner.planning.taskDetail("a").task?.sprintId || "unscheduled"}</p>{showBacklog ? <BacklogOverview planningState={owner.planning} canManageBacklog onOpenTask={() => {}} onCreatePlanningItem={() => {}} onProposeDeliverable={() => {}} /> : <p>Andere Planning-Ansicht</p>}</main>;
}
const meta = { title: "Planning/Backlog/CoordinatedAssignment", component: Fixture } satisfies Meta<typeof Fixture>; export default meta; type Story = StoryObj<typeof meta>;
export const OpenChooserKeepsDisplayedTaskBasis: Story = { args: { scenario: "chooser" }, play: async ({ canvasElement }) => {
 const canvas = within(canvasElement); await waitFor(() => expect(canvas.queryByText("Du siehst nur einen Teil des Backlogs.")).not.toBeInTheDocument());
 await userEvent.click(canvas.getByRole("button", { name: "Start background read" }));
 await userEvent.click(canvas.getAllByRole("button", { name: "Sprint für Deliverable Alpha zuordnen" })[0]);
 controls.get("chooser")!.completeRead();
 await waitFor(() => expect(within(document.body).getByRole("menuitem", { name: /In Sprint 1/ })).toBeVisible());
 await userEvent.click(within(document.body).getByRole("menuitem", { name: /In Sprint 1/ }));
 await expect(canvas.getAllByText(/Eine angezeigte Aufgabe wurde geändert/)[0]).toBeVisible(); expect(controls.get("chooser")!.writes()).toBe(0);
 await userEvent.click(canvas.getByRole("button", { name: "Zuordnung prüfen" })); controls.get("chooser")!.completeRead(); await waitFor(() => expect(canvas.getByRole("button", { name: "Erneut zuordnen" })).toBeVisible()); await expect(canvas.getByText(/Aktuell: Deliverable Alpha · Ohne Sprint/)).toBeVisible(); await userEvent.click(canvas.getByRole("button", { name: "Erneut zuordnen" })); await expect(canvas.getByText("Detail Alpha: sprint-1")).toBeVisible(); expect(controls.get("chooser")!.writes()).toBe(1);
} };

async function assignAlpha(canvasElement: HTMLElement) {
 const canvas = within(canvasElement); await waitFor(() => expect(canvas.queryByText("Du siehst nur einen Teil des Backlogs.")).not.toBeInTheDocument());
 await userEvent.click(canvas.getAllByRole("button", { name: "Sprint für Deliverable Alpha zuordnen" })[0]);
 await userEvent.click(within(document.body).getByRole("menuitem", { name: /In Sprint 1/ })); return canvas;
}
export const ConfirmedSingleReachesDetailAndRejectsOlderRead: Story = { args: { scenario: "success" }, play: async ({ canvasElement }) => {
 const canvas = within(canvasElement); await waitFor(() => expect(canvas.queryByText("Du siehst nur einen Teil des Backlogs.")).not.toBeInTheDocument()); await userEvent.click(canvas.getByRole("button", { name: "Start background read" })); await assignAlpha(canvasElement);
 await expect(canvas.getByText("Detail Alpha: sprint-1")).toBeVisible(); controls.get("success")!.completeRead(); await expect(canvas.getByText("Detail Alpha: sprint-1")).toBeVisible(); expect(controls.get("success")!.writes()).toBe(1);
} };
export const ConfirmedBulkReportsActualRows: Story = { args: { scenario: "bulk" }, play: async ({ canvasElement }) => {
 const canvas = within(canvasElement); await waitFor(() => expect(canvas.queryByText("Du siehst nur einen Teil des Backlogs.")).not.toBeInTheDocument()); await userEvent.click(canvas.getByText("Deliverable-Rangfolge und Sprint-Zuordnung"));
 await userEvent.click(canvas.getAllByRole("checkbox", { name: "Deliverable Alpha für Sprint-Zuordnung auswählen" })[0]); await userEvent.click(canvas.getAllByRole("checkbox", { name: "Deliverable Beta für Sprint-Zuordnung auswählen" })[0]);
 await userEvent.click(canvas.getByRole("button", { name: "2 ausgewählte Deliverables einem Sprint zuordnen" })); await userEvent.click(within(document.body).getByRole("menuitem", { name: /In Sprint 1/ })); await expect(canvas.getByText(/2 Deliverables wurden dem Sprint/)).toBeVisible(); expect(controls.get("bulk")!.writes()).toBe(1);
} };
export const BulkSelectionKeepsItsOriginalTaskVersions: Story = { args: { scenario: "bulk-basis" }, play: async ({ canvasElement }) => {
 const canvas = within(canvasElement); await waitFor(() => expect(canvas.queryByText("Du siehst nur einen Teil des Backlogs.")).not.toBeInTheDocument()); await userEvent.click(canvas.getByRole("button", { name: "Start background read" })); await userEvent.click(canvas.getByText("Deliverable-Rangfolge und Sprint-Zuordnung"));
 await userEvent.click(canvas.getAllByRole("checkbox", { name: "Deliverable Alpha für Sprint-Zuordnung auswählen" })[0]); await userEvent.click(canvas.getAllByRole("checkbox", { name: "Deliverable Beta für Sprint-Zuordnung auswählen" })[0]); controls.get("bulk-basis")!.completeRead();
 await userEvent.click(canvas.getByRole("button", { name: "2 ausgewählte Deliverables einem Sprint zuordnen" })); await userEvent.click(within(document.body).getByRole("menuitem", { name: /In Sprint 1/ })); await expect(canvas.getAllByText(/Eine angezeigte Aufgabe wurde geändert/)[0]).toBeVisible(); expect(controls.get("bulk-basis")!.writes()).toBe(0);
} };
export const OpenChooserKeepsDisplayedSprintBasis: Story = { args: { scenario: "sprint-chooser" }, play: async ({ canvasElement }) => {
 const canvas = within(canvasElement); await waitFor(() => expect(canvas.queryByText("Du siehst nur einen Teil des Backlogs.")).not.toBeInTheDocument()); await userEvent.click(canvas.getByRole("button", { name: "Start background read" })); await userEvent.click(canvas.getAllByRole("button", { name: "Sprint für Deliverable Alpha zuordnen" })[0]); controls.get("sprint-chooser")!.completeRead(); await userEvent.click(within(document.body).getByRole("menuitem", { name: /In Sprint 1/ })); await expect(canvas.getAllByText(/Ein Sprint wurde inzwischen geändert/)[0]).toBeVisible(); expect(controls.get("sprint-chooser")!.writes()).toBe(0);
} };
export const UnknownAssignmentSurvivesNavigationAndChecksWithoutReplay: Story = { args: { scenario: "unknown" }, play: async ({ canvasElement }) => {
 const canvas = await assignAlpha(canvasElement); await expect(canvas.getAllByText("Bestätigung verloren")[0]).toBeVisible(); await userEvent.click(canvas.getByRole("button", { name: "Ansicht wechseln" })); await userEvent.click(canvas.getByRole("button", { name: "Ansicht wechseln" })); await expect(canvas.getByText("Bestätigung verloren")).toBeVisible(); await userEvent.click(canvas.getByRole("button", { name: "Zuordnung prüfen" })); controls.get("unknown")!.completeRead(); await expect(canvas.getByText("Bestätigung verloren")).toBeVisible(); expect(controls.get("unknown")!.writes()).toBe(1);
} };
export const KnownPermissionRejectionRemovesOnlyItsAssignment: Story = { args: { scenario: "denied" }, play: async ({ canvasElement }) => {
 const canvas = await assignAlpha(canvasElement); await expect(canvas.getByText("Keine Berechtigung")).toBeVisible(); await expect(canvas.getByText("Detail Alpha: unscheduled")).toBeVisible(); expect(controls.get("denied")!.writes()).toBe(1);
} };

export const DragKeepsItsDisplayedTaskAndSprintBasis: Story = { args: { scenario: "drag-basis" }, play: async ({ canvasElement }) => {
 const canvas = within(canvasElement); await waitFor(() => expect(canvas.queryByText("Du siehst nur einen Teil des Backlogs.")).not.toBeInTheDocument()); await userEvent.click(canvas.getByRole("button", { name: "Start background read" }));
 const source = canvas.getAllByText("Deliverable Alpha").find(element => element.closest('[draggable="true"]'))!.closest('[draggable="true"]')!;
 const dataTransfer = new DataTransfer(); fireEvent.dragStart(source, { dataTransfer }); controls.get("drag-basis")!.completeRead();
 await waitFor(() => expect(canvas.queryByText("Du siehst nur einen Teil des Backlogs.")).not.toBeInTheDocument());
 const target = canvasElement.querySelector('[data-tour-id="backlog-sprint-pane"] section')!; fireEvent.dragOver(target, { dataTransfer }); fireEvent.drop(target, { dataTransfer }); fireEvent.dragEnd(source, { dataTransfer });
 await expect(canvas.getByText(/Eine angezeigte Aufgabe wurde geändert/)).toBeVisible(); expect(controls.get("drag-basis")!.writes()).toBe(0);
} };

export const PartialBulkReceiptKeepsActualConfirmationAndUncoveredIntent: Story = { args: { scenario: "partial" }, play: async ({ canvasElement }) => {
 const canvas = within(canvasElement); await waitFor(() => expect(canvas.queryByText("Du siehst nur einen Teil des Backlogs.")).not.toBeInTheDocument()); await userEvent.click(canvas.getByText("Deliverable-Rangfolge und Sprint-Zuordnung")); await userEvent.click(canvas.getAllByRole("checkbox", { name: "Deliverable Alpha für Sprint-Zuordnung auswählen" })[0]); await userEvent.click(canvas.getAllByRole("checkbox", { name: "Deliverable Beta für Sprint-Zuordnung auswählen" })[0]); await userEvent.click(canvas.getByRole("button", { name: "2 ausgewählte Deliverables einem Sprint zuordnen" })); await userEvent.click(within(document.body).getByRole("menuitem", { name: /In Sprint 1/ })); await expect(canvas.getByText("1 von 2 Zuordnungen bestätigt.")).toBeVisible(); await expect(canvas.getByText("Detail Alpha: sprint-1")).toBeVisible(); expect(controls.get("partial")!.writes()).toBe(1);
} };

export const BulkSelectionKeepsItsDisplayedSprintVersions: Story = { args: { scenario: "bulk-sprint-basis" }, play: async ({ canvasElement }) => {
 const canvas = within(canvasElement); await waitFor(() => expect(canvas.queryByText("Du siehst nur einen Teil des Backlogs.")).not.toBeInTheDocument()); await userEvent.click(canvas.getByRole("button", { name: "Start background read" })); await userEvent.click(canvas.getByText("Deliverable-Rangfolge und Sprint-Zuordnung"));
 await userEvent.click(canvas.getAllByRole("checkbox", { name: "Deliverable Alpha für Sprint-Zuordnung auswählen" })[0]); await userEvent.click(canvas.getAllByRole("checkbox", { name: "Deliverable Beta für Sprint-Zuordnung auswählen" })[0]); controls.get("bulk-sprint-basis")!.completeRead();
 await userEvent.click(canvas.getByRole("button", { name: "2 ausgewählte Deliverables einem Sprint zuordnen" })); await userEvent.click(within(document.body).getByRole("menuitem", { name: /In Sprint 1/ })); await expect(canvas.getAllByText(/Ein Sprint wurde inzwischen geändert/)[0]).toBeVisible(); expect(controls.get("bulk-sprint-basis")!.writes()).toBe(0);
} };

async function openBetaRankMenu(canvasElement: HTMLElement) {
 const canvas = within(canvasElement); await waitFor(() => expect(canvas.queryByText("Du siehst nur einen Teil des Backlogs.")).not.toBeInTheDocument()); await userEvent.click(canvas.getByText("Deliverable-Rangfolge und Sprint-Zuordnung")); await userEvent.click(canvas.getAllByRole("button", { name: "Backlog-Aktionen für Deliverable Beta" })[0]); return canvas;
}
export const PendingRankSurvivesNavigationAndAcceptsActualRows: Story = { args: { scenario: "order-delayed" }, play: async ({ canvasElement }) => {
 const canvas = await openBetaRankMenu(canvasElement); await userEvent.click(within(document.body).getByRole("menuitem", { name: "Ganz nach oben" })); await expect(canvas.getByText("Detail Beta order: 10")).toBeVisible(); await expect(canvas.getByText("Rangfolge wird gespeichert …")).toBeVisible(); await userEvent.click(canvas.getByRole("button", { name: "Ansicht wechseln" })); controls.get("order-delayed")!.completeMove(); await waitFor(() => expect(canvas.getByText("Detail Alpha order: 20")).toBeVisible()); await userEvent.click(canvas.getByRole("button", { name: "Ansicht wechseln" })); await expect(canvas.queryByText("Rangfolge wird gespeichert …")).not.toBeInTheDocument(); expect(controls.get("order-delayed")!.writes()).toBe(1);
} };
export const RankConfirmationRejectsOlderWorkspaceResponse: Story = { args: { scenario: "order-success" }, play: async ({ canvasElement }) => {
 const canvas = within(canvasElement); await waitFor(() => expect(canvas.queryByText("Du siehst nur einen Teil des Backlogs.")).not.toBeInTheDocument()); await userEvent.click(canvas.getByRole("button", { name: "Start background read" })); await openBetaRankMenu(canvasElement); await userEvent.click(within(document.body).getByRole("menuitem", { name: "Ganz nach oben" })); await expect(canvas.getByText("2 Positionen gespeichert.")).toBeVisible(); controls.get("order-success")!.completeRead(); await expect(canvas.getByText("Detail Alpha order: 20")).toBeVisible(); await expect(canvas.getByText("Detail Beta order: 10")).toBeVisible(); expect(controls.get("order-success")!.writes()).toBe(1);
} };
export const RankMenuKeepsOriginalTargetVersion: Story = { args: { scenario: "order-basis" }, play: async ({ canvasElement }) => {
 const canvas = within(canvasElement); await waitFor(() => expect(canvas.queryByText("Du siehst nur einen Teil des Backlogs.")).not.toBeInTheDocument()); await userEvent.click(canvas.getByRole("button", { name: "Start background read" })); await openBetaRankMenu(canvasElement); controls.get("order-basis")!.completeRead(); await userEvent.click(within(document.body).getByRole("menuitem", { name: "Ganz nach oben" })); await expect(canvas.getAllByText(/Quelle oder Ziel wurde zwischenzeitlich geändert/)[0]).toBeVisible(); expect(controls.get("order-basis")!.writes()).toBe(0);
 await userEvent.click(canvas.getByRole("button", { name: "Reihenfolge prüfen" })); controls.get("order-basis")!.completeRead(); await waitFor(() => expect(canvas.getByRole("button", { name: "Erneut verschieben" })).toBeVisible()); await expect(canvas.getByRole("list", { name: "Aktuelle Reihenfolge der betroffenen Aufgaben" })).toHaveTextContent("Deliverable AlphaDeliverable Beta"); await userEvent.click(canvas.getByRole("button", { name: "Erneut verschieben" })); await expect(canvas.getByText("Detail Beta order: 10")).toBeVisible(); expect(controls.get("order-basis")!.writes()).toBe(1);
} };
export const UnknownRankSurvivesNavigationAndChecksWithoutReplay: Story = { args: { scenario: "order-unknown" }, play: async ({ canvasElement }) => {
 const canvas = await openBetaRankMenu(canvasElement); await userEvent.click(within(document.body).getByRole("menuitem", { name: "Ganz nach oben" })); await expect(canvas.getAllByText("Bestätigung verloren")[0]).toBeVisible(); await userEvent.click(canvas.getByRole("button", { name: "Ansicht wechseln" })); await userEvent.click(canvas.getByRole("button", { name: "Ansicht wechseln" })); await expect(canvas.getByText(/Verschiebung: Deliverable Beta vor Deliverable Alpha/)).toBeVisible(); await userEvent.click(canvas.getByRole("button", { name: "Reihenfolge prüfen" })); controls.get("order-unknown")!.completeRead(); await expect(canvas.getByText("Bestätigung verloren")).toBeVisible(); expect(controls.get("order-unknown")!.writes()).toBe(1);
} };
export const RejectedRankRestoresOnlyItsOwnPosition: Story = { args: { scenario: "order-denied" }, play: async ({ canvasElement }) => {
 const canvas = await openBetaRankMenu(canvasElement); await userEvent.click(within(document.body).getByRole("menuitem", { name: "Ganz nach oben" })); await expect(canvas.getByText("Keine Berechtigung")).toBeVisible(); await expect(canvas.getByText("Detail Alpha order: 10")).toBeVisible(); await expect(canvas.getByText("Detail Beta order: 20")).toBeVisible(); expect(controls.get("order-denied")!.writes()).toBe(1);
} };
export const PartialRankReceiptRemainsUnconfirmed: Story = { args: { scenario: "order-partial" }, play: async ({ canvasElement }) => {
 const canvas = await openBetaRankMenu(canvasElement); await userEvent.click(within(document.body).getByRole("menuitem", { name: "Ganz nach oben" })); await expect(canvas.getByText(/1 Positionsänderung bestätigt/)).toBeVisible(); await expect(canvas.getByText("Detail Beta order: 10")).toBeVisible(); await expect(canvas.getByRole("button", { name: "Reihenfolge prüfen" })).toBeVisible(); expect(controls.get("order-partial")!.writes()).toBe(1);
} };


export const RankDragKeepsDisplayedSourceAndTargetBasis: Story = { globals: { viewport: { value: "rankDesktop" } }, parameters: { viewport: { options: { rankDesktop: { name: "Desktop rank drag", styles: { width: "1440px", height: "900px" } } } } }, args: { scenario: "order-drag-basis" }, play: async ({ canvasElement }) => {
 const canvas = within(canvasElement); await waitFor(() => expect(canvas.queryByText("Du siehst nur einen Teil des Backlogs.")).not.toBeInTheDocument()); await userEvent.click(canvas.getByText("Deliverable-Rangfolge und Sprint-Zuordnung")); await userEvent.click(canvas.getByRole("button", { name: "Start background read" }));
 const source = canvas.getAllByRole("button", { name: "Backlog-Aktionen für Deliverable Beta" })[0]; await expect(source).toHaveAttribute("draggable", "true"); const dataTransfer = new DataTransfer(); source.dispatchEvent(new DragEvent("dragstart", { bubbles: true, cancelable: true, dataTransfer })); expect(dataTransfer.getData("text/plain")).toBe("b"); await waitFor(() => expect(source.closest("tr")).toHaveClass("opacity-55")); controls.get("order-drag-basis")!.completeRead();
 await waitFor(() => expect(canvas.getByText("Detail Alpha version: foreign-r2")).toBeVisible()); const rank = within(canvasElement.querySelector('[data-tour-id="backlog-rank-table"]') as HTMLElement); const target = rank.getAllByText("Deliverable Alpha").map(element => element.closest("tr")).find(Boolean)!; const bounds = target.getBoundingClientRect(); target.dispatchEvent(new DragEvent("dragover", { bubbles: true, cancelable: true, dataTransfer, clientY: bounds.top + 1 })); target.dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer, clientY: bounds.top + 1 })); source.dispatchEvent(new DragEvent("dragend", { bubbles: true, cancelable: true, dataTransfer }));
 await waitFor(() => expect(canvas.getAllByText(/Quelle oder Ziel wurde zwischenzeitlich geändert/)[0]).toBeVisible()); expect(controls.get("order-drag-basis")!.writes()).toBe(0);
} };

const childAreaParent = taskDetailStoryTask({ id:"selected-backlog-initiative",title:"Ausgewählte Backlog-Initiative",taskType:"initiative",parentTaskId:"",approvalStatus:"approved",updatedAt:"2026-11-01T12:00:00Z" });
const childAreaPreview = taskDetailStoryTask({ id:"backlog-preview-deliverable",title:"Sichtbares Vorschau-Deliverable",parentTaskId:childAreaParent.id,approvalStatus:"approved",updatedAt:"2026-11-01T12:00:00Z" });
const childAreaOffPage = taskDetailStoryTask({ id:"backlog-off-page-deliverable",title:"Vollständig geladenes Backlog-Kind",parentTaskId:childAreaParent.id,approvalStatus:"approved",status:"Offen",updatedAt:"2026-11-01T12:00:00Z" });
const childAreaCompleted = taskDetailStoryTask({ id:"backlog-completed-context",title:"Erledigtes Kind nur für Rollup",parentTaskId:childAreaParent.id,approvalStatus:"approved",status:"Erledigt",updatedAt:"2026-11-01T12:00:00Z" });
const childAreaControls = new Map<string,{fail():void;resolve():void}>();
function IndependentBacklogChildrenStory() {
 const [requests,setRequests]=useState(0);
 const [bundle]=useState(()=>{
  const profile={id:"backlog-child-founder",name:"Synthetic Founder",platformRole:"ceo" as const,orgRole:"CEO",githubLogin:"",weeklyCapacity:40};
  const source=[childAreaParent,childAreaPreview],data={...emptyPlanningShellState,tasks:source,profiles:[profile]};
  const initial:BacklogModel={revision:"backlog-selected-source",items:source,people:[profile],sprints:[],commitments:[],coverage:{items:"partial",people:"complete",sprints:"complete",commitments:"complete",strategies:"complete",raci:"complete",links:"complete"}};
  const deadline=Date.now()+60_000,userId="backlog-child-user";
  let fail=()=>{},resolve=()=>{};
  const omitted:(keyof Task)[]=["description","problemStatement","intendedOutcome","scopeConstraints","acceptanceCriteria","evidenceRequired","definitionOfDone","note","strategy","raciAssignments","evidenceLinks","linkedPullRequests","reviewEvidenceExceptionNote","githubIssueSyncError","decisionNote","carryoverReason","dependsOn","evidenceLink","assignee","owner","createdBy"];
  const compact=(task:Task)=>{const row={...task,detailAvailability:"summary" as const};omitted.forEach(field=>{delete row[field];});return row;};
  const childResponse=()=>({response:new Response(null),body:{readAuthority:{userId,deadline},taskDetail:{revision:childAreaParent.updatedAt,sourceRevision:JSON.stringify(["backlog-selected-source","0",null,null]),observedAt:new Date().toISOString(),validUntil:new Date(deadline).toISOString(),authorityDeadline:deadline,readActor:{profileId:profile.id,platformRole:profile.platformRole},readArea:"children",supportingData:"omitted",taskOmittedFields:omitted,
    item:compact(childAreaParent),ancestors:[],children:[childAreaPreview,childAreaOffPage,childAreaCompleted].map(compact),childProgress:{completed:1,total:3,unfinished:2,percentage:33},coverage:{children:"complete"},relatedItems:[],discussion:{comments:[],externalComments:[]},blockers:[],relationships:[],activity:[],reviews:[]}}});
  let childReads=0;
  const client:BrowserApiClient={async requestJson<T>(input:Parameters<BrowserApiClient["requestJson"]>[0]){
    const url=new URL(String(input),"http://localhost:3000");
    if(url.pathname==="/api/backlog-data")return{response:new Response(null),body:{model:initial} as T};
    if(url.pathname===`/api/tasks/${childAreaParent.id}/detail-data`&&url.searchParams.get("area")==="children"){
      setRequests(++childReads);
      return new Promise<BrowserApiJsonResult<T>>(done=>{fail=()=>done({response:new Response(null,{status:503}),body:{error:"Synthetic child read unavailable"} as T});resolve=()=>done(childResponse() as BrowserApiJsonResult<T>);});
    }
    throw new Error("Unexpected Backlog child demand");
  },requestForm:async()=>{throw new Error("Unexpected form");},requestBlob:async()=>{throw new Error("Unexpected blob");}};
  const browser=createBrowserPlanningState({initialData:data,initialWorkspace:"backlog",initialUserId:userId,initialHeaderData:emptyPlanningHeaderData,initialCurrentProfile:profile});
  browser.runtime.session={userId,revision:"backlog-child-session",expiresAt:deadline/1000,user:{id:userId}};browser.runtime.apiClient=client;
  return{browser,fail:()=>fail(),resolve:()=>resolve()};
 });
 useEffect(()=>()=>bundle.browser.owner.internal.dispose(),[bundle]);
 useSyncExternalStore(bundle.browser.owner.planning.subscribe,bundle.browser.owner.internal.getSnapshot,bundle.browser.owner.internal.getSnapshot);
 childAreaControls.set("independent",bundle);
 return <><output aria-label="Backlog child requests">{requests}</output><BacklogOverview planningState={bundle.browser.owner.planning} canManageBacklog={false} onOpenTask={()=>{}} onCreatePlanningItem={()=>{}} onProposeDeliverable={()=>{}}/></>;
}
export const OpenBacklogGroupLoadsChildrenIndependentlyAndRetriesWithoutLosingItsParent:Story={
 render:()=> <IndependentBacklogChildrenStory/>,
 play:async({canvasElement})=>{
  const canvas=within(canvasElement);
  await waitFor(()=>expect(canvas.getByLabelText("Backlog child requests")).toHaveTextContent("1"));
  const group=canvas.getByRole("region",{name:childAreaParent.title}),area=within(group);
  await expect(area.getByRole("link",{name:childAreaPreview.title})).toBeVisible();
  await expect(area.getByText("Fortschritt noch nicht verfügbar.")).toBeVisible();
  await expect(area.queryByRole("progressbar")).not.toBeInTheDocument();
  const search=canvas.getByRole("searchbox",{name:"Backlog durchsuchen"});await userEvent.click(search);
  childAreaControls.get("independent")!.fail();
  await expect(await area.findByText("Unteraufgaben konnten nicht geladen werden.")).toBeVisible();
  await expect(search).toHaveFocus();await expect(area.getByRole("link",{name:childAreaPreview.title})).toBeVisible();
  await userEvent.click(area.getByRole("button",{name:"Erneut laden"}));
  await waitFor(()=>expect(canvas.getByLabelText("Backlog child requests")).toHaveTextContent("2"));
  childAreaControls.get("independent")!.resolve();
  await expect(await area.findByRole("link",{name:childAreaOffPage.title})).toBeVisible();
  await expect(area.getByRole("progressbar",{name:"1 von 3 Deliverables erledigt"})).toBeVisible();
  await expect(area.getByRole("link",{name:childAreaPreview.title})).toBeVisible();
  await expect(area.queryByRole("link",{name:childAreaCompleted.title})).not.toBeInTheDocument();
 },
};

const scopedBacklogChecks = new Map<string, { counts: ReturnType<typeof buildBacklogViewModel>["scopeCounts"]; matches: string[]; failSprint(): void }>();
function SelectedBacklogScopeStory() {
 const [requests,setRequests]=useState({selected:0,controls:0,sprints:0,legacy:0});
 const [bundle]=useState(()=>{
  const profile={id:"scoped-backlog-ceo",name:"Synthetic CEO",platformRole:"ceo" as const,orgRole:"CEO",githubLogin:"",weeklyCapacity:40};
  const parent=taskDetailStoryTask({id:"scoped-backlog-parent",title:"Vollständiger ausgewählter Kontext",taskType:"initiative",parentTaskId:"",updatedAt:"2026-11-01T12:00:00Z"});
  const rows=Array.from({length:1008},(_,index)=>{const n=index+1;return taskDetailStoryTask({id:`scoped-candidate-${n}`,title:n===1008?"Nur über Beschreibung gefunden":`Backlog-Zeile ${n}`,
    description:n===1008?"Verdeckter Suchtext":"Ordinary description",parentTaskId:parent.id,order:n*10,approvalStatus:n%3===1?"proposed":"approved",sprintId:n%3===2?sprint.id:"",
    assigneeId:profile.id,ownerId:profile.id,assignee:profile.name,owner:profile.name,hours:1,updatedAt:"2026-11-01T12:00:00Z"});});
  const done=taskDetailStoryTask({id:"scoped-completed",title:"Erledigter Kontext",parentTaskId:parent.id,status:"Erledigt"});
  const fullModel:BacklogModel={revision:"scoped-source",items:[parent,...rows,done],people:[profile],sprints:[sprint],
    commitments:[{id:1,sprintId:sprint.id,profileId:profile.id,commitmentLevel:"Standard",weeklyHours:13,note:"",updatedAt:"2026-11-01T12:00:00Z"}],
    coverage:{items:"complete",people:"complete",sprints:"complete",commitments:"complete",strategies:"complete",raci:"complete",links:"complete"}};
  const full=buildBacklogViewModel(fullModel,"all"),match=buildBacklogTableViewModel(fullModel,{...DEFAULT_BACKLOG_FILTERS,query:"Verdeckter Suchtext"});
  const deadline=Date.now()+60_000,userId="scoped-backlog-user";
  const receipt=(scope:string)=>({coverage:"complete" as const,scopeRevision:scope,sourceRevision:"scoped-source",observedAt:new Date().toISOString(),validUntil:new Date(deadline).toISOString()});
  const omitted:(keyof Task)[]=["description","problemStatement","intendedOutcome","scopeConstraints","acceptanceCriteria","evidenceRequired","definitionOfDone","note","strategy","raciAssignments","evidenceLinks","linkedPullRequests","reviewEvidenceExceptionNote","githubIssueSyncError","decisionNote","carryoverReason"];
  const compact=(task:Task)=>{const value={...task,detailAvailability:"summary" as const};omitted.forEach(field=>{delete value[field];});return value;};
  const partial={items:"partial" as const,people:"partial" as const,sprints:"partial" as const,commitments:"partial" as const,strategies:"partial" as const,raci:"partial" as const,links:"partial" as const};
  const empty:BacklogModel={revision:"scoped-source",items:[],people:[],sprints:[],commitments:[],coverage:partial};
  let sprintAttempts=0,failSprint=()=>{};
  const response=(model:BacklogModel)=>({response:new Response(null),body:{model,readAuthority:{userId,deadline},readActor:{profileId:profile.id,platformRole:profile.platformRole}}});
  const client:BrowserApiClient={async requestJson<T>(input:Parameters<BrowserApiClient["requestJson"]>[0]){
    const url=new URL(String(input),"http://localhost:3000"),raw=url.searchParams.get("scope");
    if(url.pathname==="/api/backlog-data"){
      const scope=raw?JSON.parse(raw) as {view:string;area?:string;day?:string;filters?:typeof DEFAULT_BACKLOG_FILTERS;limit?:number;continuation?:string}:null;
      if(!scope){setRequests(value=>({...value,legacy:value.legacy+1}));return{response:new Response(null,{status:503}),body:{error:"Unscoped Backlog is not the selected read contract"} as T};}
      if(scope.view==="backlog-support"&&scope.area==="controls"){
        setRequests(value=>({...value,controls:value.controls+1}));
        const controlData={...receipt("controls"),levelTotals:{epic:0,initiative:1,deliverable:1009},statuses:{epic:[],initiative:["Offen"],deliverable:["Offen","Erledigt"]},
          epics:[],initiatives:[{value:parent.id,label:parent.title}],assignees:[{value:profile.id,label:profile.name}],scopeCounts:full.scopeCounts};
        return response({...empty,controls:controlData}) as BrowserApiJsonResult<T>;
      }
      if(scope.view==="backlog-support"&&scope.area==="sprints"){
        setRequests(value=>({...value,sprints:value.sprints+1}));
        if(++sprintAttempts===1)return new Promise<BrowserApiJsonResult<T>>(resolve=>{failSprint=()=>resolve({response:new Response(null,{status:503}),body:{error:"Synthetic Sprint basis unavailable"} as T});});
        return response({...empty,sprintBasis:{...receipt("sprints"),day:scope.day!,buckets:full.sprintBuckets}}) as BrowserApiJsonResult<T>;
      }
      if(scope.view==="backlog"&&scope.filters){
        setRequests(value=>({...value,selected:value.selected+1}));
        const query={view:"backlog" as const,filters:{...scope.filters,level:"deliverable" as const},limit:scope.limit||20,...(scope.continuation?{continuation:scope.continuation}:{})};
        const selected=buildBacklogTableViewModel(fullModel,query.filters).visibleItems,chosen=selected.slice(0,query.limit);
        return response({...empty,items:[...(chosen.length?[parent]:[]),...chosen.map(item=>item.task)].map(compact),people:[profile],sprints:[sprint],taskOmittedFields:omitted,
          selection:{...receipt("selected"),query,itemIds:chosen.map(item=>item.task.id),contextIds:chosen.length?[parent.id]:[],rankById:Object.fromEntries(chosen.map(item=>[item.task.id,item.rank])),
            total:selected.length,coverage:chosen.length===selected.length?"complete":"partial",continuation:chosen.length===selected.length?null:"selected-next"}}) as BrowserApiJsonResult<T>;
      }
    }
    if(url.pathname===`/api/tasks/${parent.id}/detail-data`)return{response:new Response(null,{status:503}),body:{error:"Synthetic independent child basis unavailable"} as T};
    throw new Error("Unexpected selected Backlog request");
  },requestForm:async()=>{throw new Error("Unexpected form");},requestBlob:async()=>{throw new Error("Unexpected blob");}};
  const browser=createBrowserPlanningState({initialData:emptyPlanningShellState,initialWorkspace:"backlog",initialUserId:userId,initialHeaderData:emptyPlanningHeaderData,initialCurrentProfile:profile});
  browser.runtime.session={userId,revision:"scoped-backlog-session",expiresAt:deadline/1000,user:{id:userId}};browser.runtime.apiClient=client;
  return{browser,counts:full.scopeCounts,matches:match.visibleItems.map(item=>item.task.id),failSprint:()=>failSprint()};
 });
 useEffect(()=>()=>bundle.browser.owner.internal.dispose(),[bundle]);
 useSyncExternalStore(bundle.browser.owner.planning.subscribe,bundle.browser.owner.internal.getSnapshot,bundle.browser.owner.internal.getSnapshot);
 scopedBacklogChecks.set("selected",bundle);
 return <main><output aria-label="Ausgewählte Backlog-Abfragen">{requests.selected}</output><output aria-label="Backlog-Filterabfragen">{requests.controls}</output>
  <output aria-label="Sprintbasis-Abfragen">{requests.sprints}</output><output aria-label="Unbegrenzte Backlog-Abfragen">{requests.legacy}</output>
  <BacklogOverview {...{readMode:"selected" as const}} planningState={bundle.browser.owner.planning} canManageBacklog={false} onOpenTask={()=>{}} onCreatePlanningItem={()=>{}} onProposeDeliverable={()=>{}}/></main>;
}
export const SelectedBacklogUsesScopedRowsAndFullControlCountsWhileSprintRetryStaysIndependent:Story={
 name:"Selected Backlog retains full controls during independent Sprint retry",render:()=> <SelectedBacklogScopeStory/>,
 beforeEach:()=>{const previous=window.location.href,url=new URL(previous);for(const key of [...url.searchParams.keys()])if(key.startsWith("backlog."))url.searchParams.delete(key);window.history.replaceState(null,"",url);return()=>window.history.replaceState(null,"",previous);},
 play:async({canvasElement})=>{
  const canvas=within(canvasElement),reference=scopedBacklogChecks.get("selected")!;
  expect(reference.counts).toEqual({all:1008,proposals:336,ready:336,unscheduled:672});expect(reference.matches).toEqual(["scoped-candidate-1008"]);
  await waitFor(()=>expect(canvas.getByLabelText("Ausgewählte Backlog-Abfragen")).toHaveTextContent("1"));
  await expect(canvas.getByLabelText("Unbegrenzte Backlog-Abfragen")).toHaveTextContent("0");
  await waitFor(()=>expect(canvas.getByLabelText("Backlog-Filterabfragen")).toHaveTextContent("1"));await waitFor(()=>expect(canvas.getByLabelText("Sprintbasis-Abfragen")).toHaveTextContent("1"));
  const tabs=within(canvas.getByRole("group",{name:"Backlog-Scope"}));
  await expect(tabs.getByRole("button",{name:/^Alle\s*1008$/})).toBeVisible();await expect(tabs.getByRole("button",{name:/^Vorschläge\s*336$/})).toBeVisible();
  await expect(tabs.getByRole("button",{name:/^Bereit\s*336$/})).toBeVisible();await expect(tabs.getByRole("button",{name:/^Ohne Sprint\s*672$/})).toBeVisible();
  const search=canvas.getByRole("searchbox",{name:"Backlog durchsuchen"});await userEvent.click(search);fireEvent.change(search,{target:{value:"Verdeckter Suchtext"}});
  const link=await canvas.findByRole("link",{name:"Nur über Beschreibung gefunden"});await expect(link).toHaveAttribute("href","/tasks/scoped-candidate-1008");
  await expect(tabs.getByRole("button",{name:/^Alle\s*1008$/})).toBeVisible();await expect(search).toHaveFocus();
  reference.failSprint();await expect(await canvas.findByText("Sprintplanung konnte nicht geladen werden.")).toBeVisible();await expect(link).toBeVisible();await expect(search).toHaveFocus();
  await userEvent.click(canvas.getByRole("button",{name:"Sprintplanung erneut laden"}));await expect(await canvas.findByText("336h / 13h")).toBeVisible();await expect(link).toBeVisible();
  await expect(canvas.getByLabelText("Backlog-Filterabfragen")).toHaveTextContent("1");await expect(canvas.getByLabelText("Unbegrenzte Backlog-Abfragen")).toHaveTextContent("0");
 },
};
