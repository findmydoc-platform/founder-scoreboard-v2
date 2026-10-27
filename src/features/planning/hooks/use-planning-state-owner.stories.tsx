import { useEffect, useState } from "react";
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, userEvent, waitFor, within } from "storybook/test";
import { usePlanningStateOwner } from "./use-planning-state-owner";
import { useTaskUpdateCommand } from "@/features/tasks/hooks/use-task-update-command";
import { emptyPlanningShellState } from "../model/planning-shell-state";
import { emptyPlanningHeaderData } from "@/lib/planning-header-data";
import { taskDetailStoryTask } from "@/features/tasks/molecules/task-detail-story-fixtures";
import { getProtectedPlanningShellStateCache } from "./use-planning-auth";
import type { BrowserApiClient, BrowserApiJsonResult } from "@/lib/browser-api-client";

const task = taskDetailStoryTask({ id: "owner-task", title: "Before", updatedAt: "r1" });
const initial = { ...emptyPlanningShellState, tasks: [task] };
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
    <p>Freshness: {owner.planningState.board().freshness}</p>
    <button onClick={() => { void owner.planningState.refreshWorkspace("planning"); }}>Refresh Board</button>
    <button onClick={() => { void updateTask(owner.data.tasks[0], { title: "Saved task" }); }}>Save task</button>
    <button onClick={() => network.pending.get("save")?.({ response: new Response(null), body: { task: { id: task.id, title: "Saved task", updatedAt: "r2" } } })}>Confirm save</button>
    <button onClick={() => network.pending.get("read")?.({ response: new Response(null), body: { model: { revision: "old", project: initial.project, items: initial.tasks, people: [], sprints: [], relationships: [], preferences: [] } } })}>Complete old refresh</button>
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
