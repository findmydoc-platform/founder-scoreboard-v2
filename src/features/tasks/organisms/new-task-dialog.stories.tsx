import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { useState, useSyncExternalStore } from "react";
import { expect, userEvent, within } from "storybook/test";
import { createBrowserPlanningState } from "@/features/planning/model/internal/browser-planning-state";
import { emptyPlanningShellState } from "@/features/planning/model/planning-shell-state";
import { emptyPlanningHeaderData } from "@/lib/planning-header-data";
import type { BrowserApiClient } from "@/lib/browser-api-client";
import { useTaskCreateCommand } from "../hooks/use-task-create-command";
import { taskDetailStoryTask } from "../molecules/task-detail-story-fixtures";
import { NewTaskDialog } from "./new-task-dialog";

const profile = { id: "ceo", name: "CEO", platformRole: "ceo" as const, orgRole: "CEO", githubLogin: "", weeklyCapacity: 40 };
const parent = taskDetailStoryTask({ id: "initiative", title: "Freigegebene Initiative", taskType: "initiative", approvalStatus: "approved", updatedAt: "opaque/parent" });
const initial = { ...emptyPlanningShellState, profiles: [profile], tasks: [parent] };
function CreateStory({ partial = false }: { partial?: boolean }) {
  const [writes, setWrites] = useState(0);
  const [reads, setReads] = useState(0);
  const [open, setOpen] = useState(true);
  const [, setError] = useState("");
  const [bundle] = useState(() => {
    const state = createBrowserPlanningState({ initialData: initial, initialHeaderData: emptyPlanningHeaderData, initialCurrentProfile: profile, initialUserId: "story-user", initialWorkspace: "planning" });
    const client: BrowserApiClient = {
      async requestJson<T>(_: Parameters<BrowserApiClient["requestJson"]>[0], options?: Parameters<BrowserApiClient["requestJson"]>[1]) {
        if (options?.method === "POST") {
          setWrites(count => count + 1);
          if (!partial) throw new Error("Antwort verloren");
          return { response: new Response(null, { status: 400 }), body: { code: "task_created_approval_failed", error: "Deliverable konnte nicht freigegeben werden.", task: taskDetailStoryTask({ id: "created", title: "Mein neuer Vorschlag", approvalStatus: "proposed", updatedAt: "opaque/created", sprintId: "" }) } as T };
        }
        setReads(count => count + 1);
        return { response: new Response(null), body: { model: { revision: "workspace", project: initial.project, items: [parent], people: [profile], sprints: [], relationships: [], preferences: [] } } as T };
      },
      requestForm: async () => { throw new Error("Unexpected form"); }, requestBlob: async () => { throw new Error("Unexpected blob"); },
    };
    state.runtime.session = {userId:state.runtime.userId,revision:"story-session",expiresAt:4102444800,user:{id:state.runtime.userId}}; state.runtime.apiClient = client;
    return state;
  });
  const data = useSyncExternalStore(bundle.owner.planning.subscribe, bundle.owner.internal.getSnapshot, bundle.owner.internal.getSnapshot);
  const { createTask } = useTaskCreateCommand({ planningState: bundle.owner.planning, currentProfile: profile, data, setSaveError: setError, startTransition: action => action(), setTaskDialogDefaults: value => { if (value === null) setOpen(false); }, syncTaskToGitHub: () => {} });
  return <>
    <output aria-label="Create requests">{writes}</output><output aria-label="Check reads">{reads}</output>
    <output aria-label="Confirmed task count">{bundle.owner.planning.protectedCache()?.tasks.length}</output>
    {open ? <NewTaskDialog defaults={{ creationRequestId: "11111111-1111-4111-8111-111111111111", title: "Mein neuer Vorschlag", parentTaskId: parent.id, approveNow: partial }} data={data} pending={false} canApproveNow currentProfileId={profile.id} onClose={() => setOpen(false)} onCreate={createTask} taskLifecycle={bundle.owner.planning.taskLifecycle()} onCheckTaskLifecycle={id => bundle.owner.planning.checkTaskLifecycle(id)} /> : null}
  </>;
}
const meta = { component: CreateStory, title: "Features/Tasks/Organisms/NewTaskDialog", parameters: { layout: "fullscreen" } } satisfies Meta<typeof CreateStory>;
export default meta;
type Story = StoryObj<typeof meta>;
export const LostCreationResponseRetainsDraftWithoutReplay: Story = {
  play: async () => {
    const canvas = within(document.body);
    await userEvent.click(canvas.getByRole("button", { name: "Deliverable vorschlagen" }));
    await expect(await canvas.findByText("Erstellung noch nicht bestätigt")).toBeVisible();
    await expect(canvas.getByRole("button", { name: "Deliverable vorschlagen" })).toBeDisabled();
    await expect(canvas.getByRole("textbox", { name: /Titel/ })).toHaveValue("Mein neuer Vorschlag");
    await userEvent.click(canvas.getByRole("button", { name: "Vorgang prüfen" }));
    await expect(canvas.getByText(/Die Prüfung hat den Vorgang nicht bestätigt/)).toBeVisible();
    await expect(canvas.getByLabelText("Create requests")).toHaveTextContent("1");
    await expect(canvas.getByLabelText("Check reads")).toHaveTextContent("1");
    await expect(canvas.getByLabelText("Confirmed task count")).toHaveTextContent("1");
  },
};
export const CreationConfirmedApprovalFailed: Story = {
  args: { partial: true },
  play: async () => {
    const canvas = within(document.body);
    await userEvent.click(canvas.getByRole("button", { name: "Erstellen und freigeben" }));
    await expect(await canvas.findByText("Aufgabe erstellt, Freigabe fehlgeschlagen")).toBeVisible();
    await expect(canvas.getByRole("button", { name: "Erstellen und freigeben" })).toBeDisabled();
    await expect(canvas.getByLabelText("Create requests")).toHaveTextContent("1");
    await expect(canvas.getByLabelText("Confirmed task count")).toHaveTextContent("2");
  },
};
