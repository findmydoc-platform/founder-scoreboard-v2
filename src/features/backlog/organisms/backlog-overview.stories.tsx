import { useState, useSyncExternalStore } from "react";
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, fireEvent, userEvent, waitFor, within } from "storybook/test";
import { BacklogOverview } from "./backlog-overview";
import { createBrowserPlanningState } from "@/features/planning/model/internal/browser-planning-state";
import { emptyPlanningShellState } from "@/features/planning/model/planning-shell-state";
import { emptyPlanningHeaderData } from "@/lib/planning-header-data";
import { taskDetailStoryTask } from "@/features/tasks/molecules/task-detail-story-fixtures";
import type { BrowserApiClient, BrowserApiJsonResult } from "@/lib/browser-api-client";
import type { BacklogModel } from "../model/backlog-read-model";
import type { AuthenticatedProfile, Sprint } from "@/lib/types";
const sprint: Sprint = { id: "sprint-1", name: "Sprint 1", status: "active", startDate: "2026-10-26", endDate: "2026-11-01", reviewDueAt: "2026-11-03", scoreLocked: false, updatedAt: "s1" };
const tasks = [taskDetailStoryTask({ id: "a", title: "Deliverable Alpha", taskType: "deliverable", approvalStatus: "approved", parentTaskId: "initiative", parentApprovalStatus: "approved", assigneeId: "founder", ownerId: "founder", sprintId: "", updatedAt: "r1", order: 10 }), taskDetailStoryTask({ id: "b", title: "Deliverable Beta", taskType: "deliverable", approvalStatus: "approved", parentTaskId: "initiative", parentApprovalStatus: "approved", assigneeId: "founder", ownerId: "founder", sprintId: "", updatedAt: "r1", order: 20 }), taskDetailStoryTask({ id: "initiative", title: "Approved Initiative", taskType: "initiative", approvalStatus: "approved", parentTaskId: "", updatedAt: "i1" })];
const model: BacklogModel = { revision: "initial", items: tasks, people: [], sprints: [sprint], commitments: [], coverage: { items: "complete", people: "complete", sprints: "complete", commitments: "complete", strategies: "complete", raci: "complete", links: "complete" } };
const controls = new Map<string, { completeRead(): void; writes(): number }>();
function Fixture({ scenario = "success" }: { scenario?: string }) {
 const [network] = useState(() => {
   let writes = 0, reads = 0, completeRead = () => {};
   const current = { ...model, items: tasks.map(task => ({ ...task, updatedAt: ["sprint-chooser", "bulk-sprint-basis"].includes(scenario) ? task.updatedAt : task.id === "a" ? "foreign-r2" : task.updatedAt })), sprints: ["sprint-chooser", "bulk-sprint-basis"].includes(scenario) ? [{ ...sprint, updatedAt: "foreign-sprint" }] : [sprint] };
   const client: BrowserApiClient = {
     async requestJson<T>(url: Parameters<BrowserApiClient["requestJson"]>[0], options?: Parameters<BrowserApiClient["requestJson"]>[1]) {
       if (!options?.method) { reads++; if (reads > 1) return new Promise<BrowserApiJsonResult<T>>(resolve => { completeRead = () => resolve({ response: new Response(null), body: { model: current } as T }); }); return { response: new Response(null), body: { model } as T }; }
       writes++; if (scenario === "unknown") return { response: new Response(null, { status: 503 }), body: { error: "Bestätigung verloren" } as T };
       if (scenario === "denied") return { response: new Response(null, { status: 403 }), body: { error: "Keine Berechtigung" } as T };
       const bulk = String(url).includes("bulk-sprint"); const ids = bulk ? ((options.json as { assignments: { taskId: string }[] }).assignments.map(item => item.taskId)) : [String(url).split("/").at(-1)!];
       const updates = (scenario === "partial" ? ids.slice(0,1) : ids).map(id => ({ id, sprintId: sprint.id, scoreRelevant: true, updatedAt: "confirmed-r3" })); return { response: new Response(null), body: (bulk ? { updates } : { task: updates[0] }) as T };
     }, requestForm: async () => { throw new Error("Unexpected upload"); }, requestBlob: async () => { throw new Error("Unexpected blob"); },
   };
   const value = { client, completeRead: () => completeRead(), writes: () => writes }; controls.set(scenario, value); return value;
 });
 const [owner] = useState(() => { const value = createBrowserPlanningState({ initialData: { ...emptyPlanningShellState, tasks, sprints: [sprint] }, initialWorkspace: "backlog", initialUserId: "backlog-user", initialHeaderData: emptyPlanningHeaderData, initialCurrentProfile: { id: "founder", platformRole: "ceo", name: "CEO" } as AuthenticatedProfile }); value.runtime.apiClient = network.client; return value.owner; });
 useSyncExternalStore(owner.planning.subscribe, owner.internal.getSnapshot, owner.internal.getSnapshot);
 const [showBacklog, setShowBacklog] = useState(true);
 return <main><button onClick={() => setShowBacklog(value => !value)}>Ansicht wechseln</button><h1>Backlog assignment</h1><button onClick={() => void owner.planning.refreshWorkspace("backlog")}>Start background read</button><p>Detail Alpha: {owner.planning.taskDetail("a").task?.sprintId || "unscheduled"}</p>{showBacklog ? <BacklogOverview apiClient={network.client} planningState={owner.planning} canManageBacklog initialModel={model} onOpenTask={() => {}} onCreatePlanningItem={() => {}} onProposeDeliverable={() => {}} /> : <p>Andere Planning-Ansicht</p>}</main>;
}
const meta = { title: "Planning/Backlog/CoordinatedAssignment", component: Fixture } satisfies Meta<typeof Fixture>; export default meta; type Story = StoryObj<typeof meta>;
export const OpenChooserKeepsDisplayedTaskBasis: Story = { args: { scenario: "chooser" }, play: async ({ canvasElement }) => {
 const canvas = within(canvasElement); await waitFor(() => expect(canvas.queryByText(/Backlog-Ausschnitt/)).not.toBeInTheDocument());
 await userEvent.click(canvas.getByRole("button", { name: "Start background read" }));
 await userEvent.click(canvas.getAllByRole("button", { name: "Sprint für Deliverable Alpha zuordnen" })[0]);
 controls.get("chooser")!.completeRead();
 await waitFor(() => expect(within(document.body).getByRole("menuitem", { name: /In Sprint 1/ })).toBeVisible());
 await userEvent.click(within(document.body).getByRole("menuitem", { name: /In Sprint 1/ }));
 await expect(canvas.getAllByText(/Eine angezeigte Aufgabe wurde geändert/)[0]).toBeVisible(); expect(controls.get("chooser")!.writes()).toBe(0);
 await userEvent.click(canvas.getByRole("button", { name: "Serverstand prüfen" })); controls.get("chooser")!.completeRead(); await waitFor(() => expect(canvas.getByRole("button", { name: "Bewusst erneut zuordnen" })).toBeVisible()); await expect(canvas.getByText(/Serverstand: Deliverable Alpha/)).toBeVisible(); await userEvent.click(canvas.getByRole("button", { name: "Bewusst erneut zuordnen" })); await expect(canvas.getByText("Detail Alpha: sprint-1")).toBeVisible(); expect(controls.get("chooser")!.writes()).toBe(1);
} };

async function assignAlpha(canvasElement: HTMLElement) {
 const canvas = within(canvasElement); await waitFor(() => expect(canvas.queryByText(/Backlog-Ausschnitt/)).not.toBeInTheDocument());
 await userEvent.click(canvas.getAllByRole("button", { name: "Sprint für Deliverable Alpha zuordnen" })[0]);
 await userEvent.click(within(document.body).getByRole("menuitem", { name: /In Sprint 1/ })); return canvas;
}
export const ConfirmedSingleReachesDetailAndRejectsOlderRead: Story = { args: { scenario: "success" }, play: async ({ canvasElement }) => {
 const canvas = within(canvasElement); await waitFor(() => expect(canvas.queryByText(/Backlog-Ausschnitt/)).not.toBeInTheDocument()); await userEvent.click(canvas.getByRole("button", { name: "Start background read" })); await assignAlpha(canvasElement);
 await expect(canvas.getByText("Detail Alpha: sprint-1")).toBeVisible(); controls.get("success")!.completeRead(); await expect(canvas.getByText("Detail Alpha: sprint-1")).toBeVisible(); expect(controls.get("success")!.writes()).toBe(1);
} };
export const ConfirmedBulkReportsActualRows: Story = { args: { scenario: "bulk" }, play: async ({ canvasElement }) => {
 const canvas = within(canvasElement); await waitFor(() => expect(canvas.queryByText(/Backlog-Ausschnitt/)).not.toBeInTheDocument()); await userEvent.click(canvas.getByText("Deliverable-Rangfolge und Sprint-Zuordnung"));
 await userEvent.click(canvas.getAllByRole("checkbox", { name: "Deliverable Alpha für Sprint-Zuordnung auswählen" })[0]); await userEvent.click(canvas.getAllByRole("checkbox", { name: "Deliverable Beta für Sprint-Zuordnung auswählen" })[0]);
 await userEvent.click(canvas.getByRole("button", { name: "2 ausgewählte Deliverables einem Sprint zuordnen" })); await userEvent.click(within(document.body).getByRole("menuitem", { name: /In Sprint 1/ })); await expect(canvas.getByText(/2 Deliverables wurden dem Sprint/)).toBeVisible(); expect(controls.get("bulk")!.writes()).toBe(1);
} };
export const BulkSelectionKeepsItsOriginalTaskVersions: Story = { args: { scenario: "bulk-basis" }, play: async ({ canvasElement }) => {
 const canvas = within(canvasElement); await waitFor(() => expect(canvas.queryByText(/Backlog-Ausschnitt/)).not.toBeInTheDocument()); await userEvent.click(canvas.getByRole("button", { name: "Start background read" })); await userEvent.click(canvas.getByText("Deliverable-Rangfolge und Sprint-Zuordnung"));
 await userEvent.click(canvas.getAllByRole("checkbox", { name: "Deliverable Alpha für Sprint-Zuordnung auswählen" })[0]); await userEvent.click(canvas.getAllByRole("checkbox", { name: "Deliverable Beta für Sprint-Zuordnung auswählen" })[0]); controls.get("bulk-basis")!.completeRead();
 await userEvent.click(canvas.getByRole("button", { name: "2 ausgewählte Deliverables einem Sprint zuordnen" })); await userEvent.click(within(document.body).getByRole("menuitem", { name: /In Sprint 1/ })); await expect(canvas.getAllByText(/Eine angezeigte Aufgabe wurde geändert/)[0]).toBeVisible(); expect(controls.get("bulk-basis")!.writes()).toBe(0);
} };
export const OpenChooserKeepsDisplayedSprintBasis: Story = { args: { scenario: "sprint-chooser" }, play: async ({ canvasElement }) => {
 const canvas = within(canvasElement); await waitFor(() => expect(canvas.queryByText(/Backlog-Ausschnitt/)).not.toBeInTheDocument()); await userEvent.click(canvas.getByRole("button", { name: "Start background read" })); await userEvent.click(canvas.getAllByRole("button", { name: "Sprint für Deliverable Alpha zuordnen" })[0]); controls.get("sprint-chooser")!.completeRead(); await userEvent.click(within(document.body).getByRole("menuitem", { name: /In Sprint 1/ })); await expect(canvas.getAllByText(/Ein angezeigter Sprint wurde geändert/)[0]).toBeVisible(); expect(controls.get("sprint-chooser")!.writes()).toBe(0);
} };
export const UnknownAssignmentSurvivesNavigationAndChecksWithoutReplay: Story = { args: { scenario: "unknown" }, play: async ({ canvasElement }) => {
 const canvas = await assignAlpha(canvasElement); await expect(canvas.getAllByText("Bestätigung verloren")[0]).toBeVisible(); await userEvent.click(canvas.getByRole("button", { name: "Ansicht wechseln" })); await userEvent.click(canvas.getByRole("button", { name: "Ansicht wechseln" })); await expect(canvas.getByText("Bestätigung verloren")).toBeVisible(); await userEvent.click(canvas.getByRole("button", { name: "Serverstand prüfen" })); controls.get("unknown")!.completeRead(); await expect(canvas.getByText("Bestätigung verloren")).toBeVisible(); expect(controls.get("unknown")!.writes()).toBe(1);
} };
export const KnownPermissionRejectionRemovesOnlyItsAssignment: Story = { args: { scenario: "denied" }, play: async ({ canvasElement }) => {
 const canvas = await assignAlpha(canvasElement); await expect(canvas.getByText("Keine Berechtigung")).toBeVisible(); await expect(canvas.getByText("Detail Alpha: unscheduled")).toBeVisible(); expect(controls.get("denied")!.writes()).toBe(1);
} };

export const DragKeepsItsDisplayedTaskAndSprintBasis: Story = { args: { scenario: "drag-basis" }, play: async ({ canvasElement }) => {
 const canvas = within(canvasElement); await waitFor(() => expect(canvas.queryByText(/Backlog-Ausschnitt/)).not.toBeInTheDocument()); await userEvent.click(canvas.getByRole("button", { name: "Start background read" }));
 const source = canvas.getAllByText("Deliverable Alpha").find(element => element.closest('[draggable="true"]'))!.closest('[draggable="true"]')!;
 const dataTransfer = new DataTransfer(); fireEvent.dragStart(source, { dataTransfer }); controls.get("drag-basis")!.completeRead();
 await waitFor(() => expect(canvas.queryByText(/Backlog-Ausschnitt/)).not.toBeInTheDocument());
 const target = canvasElement.querySelector('[data-tour-id="backlog-sprint-pane"] section')!; fireEvent.dragOver(target, { dataTransfer }); fireEvent.drop(target, { dataTransfer }); fireEvent.dragEnd(source, { dataTransfer });
 await expect(canvas.getByText(/Eine angezeigte Aufgabe wurde geändert/)).toBeVisible(); expect(controls.get("drag-basis")!.writes()).toBe(0);
} };

export const PartialBulkReceiptKeepsActualConfirmationAndUncoveredIntent: Story = { args: { scenario: "partial" }, play: async ({ canvasElement }) => {
 const canvas = within(canvasElement); await waitFor(() => expect(canvas.queryByText(/Backlog-Ausschnitt/)).not.toBeInTheDocument()); await userEvent.click(canvas.getByText("Deliverable-Rangfolge und Sprint-Zuordnung")); await userEvent.click(canvas.getAllByRole("checkbox", { name: "Deliverable Alpha für Sprint-Zuordnung auswählen" })[0]); await userEvent.click(canvas.getAllByRole("checkbox", { name: "Deliverable Beta für Sprint-Zuordnung auswählen" })[0]); await userEvent.click(canvas.getByRole("button", { name: "2 ausgewählte Deliverables einem Sprint zuordnen" })); await userEvent.click(within(document.body).getByRole("menuitem", { name: /In Sprint 1/ })); await expect(canvas.getByText("1 von 2 Aufgaben bestätigt.")).toBeVisible(); await expect(canvas.getByText("Detail Alpha: sprint-1")).toBeVisible(); expect(controls.get("partial")!.writes()).toBe(1);
} };

export const BulkSelectionKeepsItsDisplayedSprintVersions: Story = { args: { scenario: "bulk-sprint-basis" }, play: async ({ canvasElement }) => {
 const canvas = within(canvasElement); await waitFor(() => expect(canvas.queryByText(/Backlog-Ausschnitt/)).not.toBeInTheDocument()); await userEvent.click(canvas.getByRole("button", { name: "Start background read" })); await userEvent.click(canvas.getByText("Deliverable-Rangfolge und Sprint-Zuordnung"));
 await userEvent.click(canvas.getAllByRole("checkbox", { name: "Deliverable Alpha für Sprint-Zuordnung auswählen" })[0]); await userEvent.click(canvas.getAllByRole("checkbox", { name: "Deliverable Beta für Sprint-Zuordnung auswählen" })[0]); controls.get("bulk-sprint-basis")!.completeRead();
 await userEvent.click(canvas.getByRole("button", { name: "2 ausgewählte Deliverables einem Sprint zuordnen" })); await userEvent.click(within(document.body).getByRole("menuitem", { name: /In Sprint 1/ })); await expect(canvas.getAllByText(/Ein angezeigter Sprint wurde geändert/)[0]).toBeVisible(); expect(controls.get("bulk-sprint-basis")!.writes()).toBe(0);
} };
