import { useEffect, useState, useSyncExternalStore } from "react";
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, userEvent, waitFor, within } from "storybook/test";
import { usePlanningStateOwner } from "./use-planning-state-owner";
import { usePlanningBoardState } from "./use-planning-board-state";
import { PlanningTaskViewRenderer } from "../organisms/planning-task-view-renderer";
import type { PlanningAppController } from "./use-planning-app-controller";
import { createPlanningState } from "../model/internal/planning-state-owner";
import { useTaskUpdateCommand } from "@/features/tasks/hooks/use-task-update-command";
import { emptyPlanningShellState } from "../model/planning-shell-state";
import { emptyPlanningHeaderData } from "@/lib/planning-header-data";
import { taskDetailStoryTask } from "@/features/tasks/molecules/task-detail-story-fixtures";
import { getProtectedPlanningShellStateCache } from "@/features/planning/model/internal/planning-protected-cache";
import type { TaskComment } from "@/lib/types";
import type { BrowserApiClient, BrowserApiJsonResult } from "@/lib/browser-api-client";

const task = taskDetailStoryTask({ id: "owner-task", title: "Before", updatedAt: "r1" });
const initial = { ...emptyPlanningShellState, tasks: [task], taskComments: [{ id: 1, taskId: task.id, profileId: "story-profile", comment: "Loaded discussion", githubDeliveryStatus: "not_applicable", githubCommentUrl: "", createdAt: "2026-10-28T00:00:00Z" } satisfies TaskComment] };
function PlanningOwnerStory() {
  const [, setHeaderData] = useState(emptyPlanningHeaderData);
  const owner = usePlanningStateOwner({ initialData: initial, initialHeaderData: emptyPlanningHeaderData, initialUserId: "owner-story", initialCurrentProfile: null, initialWorkspace: "planning", setHeaderData });
  const [network] = useState(() => {
    const pending = new Map<string, (result: BrowserApiJsonResult<unknown>) => void>();
    const client: BrowserApiClient = {
      requestJson: <T,>(input: Parameters<BrowserApiClient["requestJson"]>[0], options?: Parameters<BrowserApiClient["requestJson"]>[1]) => new Promise<BrowserApiJsonResult<T>>(resolve => { pending.set(options?.method === "PATCH" ? "save" : "read", result => resolve(result as BrowserApiJsonResult<T>)); }),
      requestForm: async () => { throw new Error("Unexpected upload"); },
      requestBlob: async () => { throw new Error("Unexpected blob"); },
    };
    return { client, pending };
  });
  useEffect(() => { owner.configure(network.client, "planning", emptyPlanningHeaderData, null); }, [owner, network]);
  const [, setError] = useState("");
  const { updateTask } = useTaskUpdateCommand({
    planningState: owner.planningState, data: owner.data,
    currentProfile: null, canChangeTaskStatus: () => true, canCorrectOperationally: true, canManageFinalTaskStatus: true, canManageTaskMeta: true,
    githubInstallationAvailable: false, setSaveError: setError, setStatusGuardNotice: () => {}, setStatusGuardTaskId: () => {},
    refreshCurrentWorkspaceModel: async () => { await owner.planningState.refreshWorkspace("planning"); },
    syncTaskToGitHub: () => {}, startTransition: operation => operation(),
  });
  return <main>
    <p>Task: {owner.data.tasks[0]?.title || "cleared"}</p>
    <p>Status: {owner.planningState.taskDetail(task.id).saveStatus}</p>
    <p>Cache: {getProtectedPlanningShellStateCache()?.data.tasks[0]?.title || "cleared"}</p>
    <p>Discussion: {owner.planningState.taskDetail(task.id).comments.map(comment => comment.comment).join(", ")}</p>
    <p>Workspace: {owner.planningState.workspace("planning").readStatus}</p>
    <p>Freshness: {owner.planningState.board().freshness}</p>
    <button onClick={() => { void owner.planningState.refreshWorkspace("planning"); }}>Refresh Board</button>
    <button onClick={() => { void updateTask(owner.data.tasks[0], { title: "Saved task" }); }}>Save task</button>
    <button onClick={() => network.pending.get("save")?.({ response: new Response(null), body: { task: { id: task.id, title: "Saved task", updatedAt: "r2" } } })}>Confirm save</button>
    <button onClick={() => network.pending.get("read")?.({ response: new Response(null), body: { model: { revision: "old", project: initial.project, items: initial.tasks, people: [], sprints: [], relationships: [], preferences: [] } } })}>Complete old refresh</button>
    <button onClick={() => owner.acceptProtectedData({ ...initial, tasks: [{ ...task, title: "Old page task" }], taskComments: [] }, "owner-story")}>Hydrate old page</button>
    <button onClick={() => owner.setData(initial)}>Restore legacy snapshot</button>
    <button onClick={owner.clearPlanningState}>End session</button>
  </main>;
}
const meta = { component: PlanningOwnerStory, title: "Planning/Hooks/TaskStateOwnership" } satisfies Meta<typeof PlanningOwnerStory>;
export default meta;
type Story = StoryObj<typeof meta>;
export const ConfirmedTaskSurvivesRefreshAndLegacyRollback: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: "Refresh Board" }));
    await userEvent.click(canvas.getByRole("button", { name: "Save task" }));
    await expect(canvas.getByText("Task: Saved task")).toBeVisible();
    await expect(canvas.getByText("Status: saving")).toBeVisible();
    await expect(canvas.getByText("Cache: Before")).toBeVisible();
    await userEvent.click(canvas.getByRole("button", { name: "Confirm save" }));
    await waitFor(() => expect(canvas.getByText("Status: saved")).toBeVisible());
    await expect(canvas.getByText("Cache: Saved task")).toBeVisible();
    await userEvent.click(canvas.getByRole("button", { name: "Complete old refresh" }));
    await userEvent.click(canvas.getByRole("button", { name: "Restore legacy snapshot" }));
    await expect(canvas.getByText("Task: Saved task")).toBeVisible();
    await expect(canvas.getByText("Cache: Saved task")).toBeVisible();
    await expect(canvas.getByText("Freshness: stale")).toBeVisible();
    await userEvent.click(canvas.getByRole("button", { name: "End session" }));
    await expect(canvas.getByText("Task: cleared")).toBeVisible();
    await expect(canvas.getByText("Cache: cleared")).toBeVisible();
  },
};

function BoardEditingStory({ loseResponse = false }: { loseResponse?: boolean }) {
  const [attempts, setAttempts] = useState(0);
  const [server] = useState(() => {
    let current = taskDetailStoryTask({ id: "board-conflict", title: "Board-Konflikt", status: "Offen", approvalStatus: "approved", updatedAt: "opaque/r1" });
    return { read: () => current, replace: (next: typeof current) => { current = next; } };
  });
  const [owner] = useState(() => createPlanningState({ userId: "board-story", initialData: { ...emptyPlanningShellState, tasks: [server.read(), ...(loseResponse ? [{ ...server.read(), id: "independent", title: "Andere Aufgabe" }] : [])] }, adapter: {
    readWorkspace: async () => ({ data: { ...emptyPlanningShellState, tasks: [server.read()] } }),
    readTaskDetail: async () => ({ model: { revision: "detail", project: initial.project, item: server.read(), ancestors: [], children: [], relatedItems: [], people: [], sprints: [], discussion: { comments: [], externalComments: [] }, blockers: [], relationships: [], activity: [], reviews: [] } }),
    async saveTask(basis, patch) {
      setAttempts(count => count + 1);
      if (basis.id === "independent") return { task: { ...patch, updatedAt: "opaque/independent" } };
      if (loseResponse) { server.replace({ ...server.read(), ...patch, updatedAt: "opaque/r2" }); throw new Error("Antwort verloren"); }
      if (basis.updatedAt !== server.read().updatedAt) throw Object.assign(new Error("Andere Version"), { status: 409, kind: "versionConflict" });
      server.replace({ ...server.read(), ...patch, updatedAt: "opaque/r3" });
      return { task: server.read() };
    },
  } }));
  const data = useSyncExternalStore(owner.planning.subscribe, owner.internal.getSnapshot, owner.internal.getSnapshot);
  useEffect(() => {
    const background = () => { server.replace({ ...server.read(), priority: "P1", updatedAt: "opaque/r2" }); void owner.planning.refreshWorkspace("planning"); };
    window.addEventListener("planning-story-background", background);
    return () => window.removeEventListener("planning-story-background", background);
  }, [owner, server]);
  const [, setError] = useState("");
  const { updateTask } = useTaskUpdateCommand({ planningState: owner.planning, data, currentProfile: null, canChangeTaskStatus: () => true, canCorrectOperationally: true, canManageFinalTaskStatus: true, canManageTaskMeta: true, githubInstallationAvailable: false, setSaveError: setError, setStatusGuardNotice: () => {}, setStatusGuardTaskId: () => {}, refreshCurrentWorkspaceModel: async () => {}, syncTaskToGitHub: () => {}, startTransition: action => action() });
  const board = usePlanningBoardState({ planningState: owner.planning, data, canChangeTaskStatus: () => true, updateTask, setStatusGuardNotice: () => {}, setStatusGuardTaskId: () => {} });
  const controller = { ...board, planningState: owner.planning, data, visibleTasks: data.tasks, canChangeTaskStatus: () => true, canManageFinalTaskStatus: true, canManageTaskMeta: true, filters: { initiativeId: "Alle" }, filtersAvailable: true, openTaskPanel: () => {}, planningLevel: "deliverable", planningParentFilterId: "all", selectedTaskId: null, setFilters: () => {}, setTaskDialogDefaults: () => {}, setView: () => {}, viewerOpenSubIssueIdsByDeliverableId: {}, view: "board" } as unknown as PlanningAppController;
  return <><output aria-label="Board write attempts">{attempts}</output><PlanningTaskViewRenderer controller={controller} /></>;
}
export const BoardMenuKeepsItsOpeningBasis: Story = {
  render: () => <BoardEditingStory />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: "Status für Board-Konflikt ändern" }));
    window.dispatchEvent(new Event("planning-story-background"));
    await waitFor(() => expect(canvas.getByText("P1")).toBeVisible());
    await userEvent.click(within(document.body).getByRole("menuitem", { name: "Blockiert" }));
    await expect(await canvas.findByRole("button", { name: "Änderung erneut speichern" })).toBeEnabled();
    await expect(canvas.getByLabelText("Board write attempts")).toHaveTextContent("0");
    await userEvent.click(canvas.getByRole("button", { name: "Änderung erneut speichern" }));
    await waitFor(() => expect(canvas.getByLabelText("Board write attempts")).toHaveTextContent("1"));
    await waitFor(() => expect(canvas.queryByRole("button", { name: "Änderung erneut speichern" })).not.toBeInTheDocument());
    await expect(canvas.getByRole("button", { name: "Status für Board-Konflikt ändern" })).toHaveTextContent("Blockiert");
  },
};

export const UntrustedHydrationRequestsFreshWorkspace: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: "Save task" }));
    await userEvent.click(canvas.getByRole("button", { name: "Confirm save" }));
    await waitFor(() => expect(canvas.getByText("Status: saved")).toBeVisible());
    await userEvent.click(canvas.getByRole("button", { name: "Hydrate old page" }));
    await expect(canvas.getByText("Task: Saved task")).toBeVisible();
    await expect(canvas.getByText("Cache: Saved task")).toBeVisible();
    await expect(canvas.getByText("Discussion: Loaded discussion")).toBeVisible();
    await expect(canvas.getByText("Workspace: loading")).toBeVisible();
  },
};


export const BoardChecksUnconfirmedTaskAndAllowsIndependentEdit: Story = {
  render: () => <BoardEditingStory loseResponse />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: "Status für Board-Konflikt ändern" }));
    await userEvent.click(within(document.body).getByRole("menuitem", { name: "Blockiert" }));
    await expect(await canvas.findByText("Speicherbestätigung ausstehend")).toBeVisible();
    await expect(canvas.queryByRole("button", { name: "Status für Board-Konflikt ändern" })).not.toBeInTheDocument();
    await userEvent.click(canvas.getByRole("button", { name: "Speicherstand prüfen" }));
    await expect(await canvas.findByText(/Serverstand geladen.*Speicherung bleibt unbestätigt/)).toBeVisible();
    await expect(canvas.getByLabelText("Board write attempts")).toHaveTextContent("1");
    await userEvent.click(canvas.getByRole("button", { name: "Status für Andere Aufgabe ändern" }));
    await userEvent.click(within(document.body).getByRole("menuitem", { name: "In Arbeit" }));
    await expect(canvas.getByRole("button", { name: "Status für Andere Aufgabe ändern" })).toHaveTextContent("In Arbeit");
    await expect(canvas.getByLabelText("Board write attempts")).toHaveTextContent("2");
    await expect(canvas.getByText("Speicherbestätigung ausstehend")).toBeVisible();
  },
};
