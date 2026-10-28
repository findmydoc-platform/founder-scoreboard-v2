import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { useState, useSyncExternalStore } from "react";
import { expect, fn, userEvent, within } from "storybook/test";
import type { PlanningTaskLifecycleView } from "@/features/planning/model/planning-task-lifecycle";
import { createPlanningState } from "@/features/planning/model/internal/planning-state-owner";
import { emptyPlanningShellState } from "@/features/planning/model/planning-shell-state";
import { useTaskWithdrawCommand } from "../hooks/use-task-withdraw-command";
import { taskDetailStoryTask } from "./task-detail-story-fixtures";
import { TaskDetailHeaderActions } from "./task-detail-header-actions";
import { TaskLifecycleNotice } from "./task-lifecycle-notice";

const root = taskDetailStoryTask({ id: "proposal", title: "Offener Vorschlag", approvalStatus: "proposed", proposedById: "ceo", updatedAt: "opaque/root" });
const other = taskDetailStoryTask({ id: "other", title: "Unabhängige Aufgabe", updatedAt: "opaque/other" });
function WithdrawalStory() {
  const [writes, setWrites] = useState(0);
  const [reads, setReads] = useState(0);
  const [, setError] = useState("");
  const [owner] = useState(() => createPlanningState({ userId: "story", initialData: { ...emptyPlanningShellState, tasks: [root, other] }, adapter: {
    readWorkspace: async () => ({ data: emptyPlanningShellState }), saveTask: async () => ({ task: other }),
    removeTask: async () => { setWrites(count => count + 1); throw new Error("Antwort verloren"); },
    readTaskDetail: async () => { setReads(count => count + 1); throw Object.assign(new Error("Not found"), { status: 404 }); },
  } }));
  const data = useSyncExternalStore(owner.planning.subscribe, owner.internal.getSnapshot, owner.internal.getSnapshot);
  const { withdrawTask } = useTaskWithdrawCommand({ planningState: owner.planning, currentProfile: { id: "ceo", name: "CEO", platformRole: "ceo", orgRole: "CEO", githubLogin: "", weeklyCapacity: 40 }, closeTaskPanel: () => {}, setSaveError: setError, startTransition: action => action() });
  return <main className="p-4">
    <output aria-label="Removal writes">{writes}</output><output aria-label="Removal checks">{reads}</output>
    <p aria-label="Active tasks">{data.tasks.map(task => task.title).join(", ")}</p>
    {data.tasks.some(task => task.id === root.id) ? <TaskDetailHeaderActions task={root} canEditOverview={false} canManageReviewOwner={false} canWithdrawTask githubInstallationAvailable={false} pending={false} onEditOverview={() => {}} onShowReviewSetup={() => {}} onSyncGitHub={() => {}} onWithdraw={reason => { withdrawTask(root, reason); }} /> : null}
    {owner.planning.taskLifecycle().map(operation => <TaskLifecycleNotice key={operation.id} operation={operation} onCheck={id => owner.planning.checkTaskLifecycle(id)} />)}
  </main>;
}
const meta = { component: WithdrawalStory, title: "Features/Tasks/Molecules/TaskLifecycleNotice" } satisfies Meta<typeof WithdrawalStory>;
export default meta;
type Story = StoryObj<typeof meta>;
export const WithdrawalResponseLost: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: "Weitere Item-Aktionen" }));
    await userEvent.click(within(document.body).getByRole("menuitem", { name: "Deliverable zurückziehen" }));
    const dialog = within(await within(document.body).findByRole("dialog", { name: "In den Papierkorb verschieben" }));
    await expect(dialog.getByRole("button", { name: "Zurückziehen" })).toBeDisabled();
    await userEvent.type(dialog.getByRole("textbox", { name: "Begründung" }), "Nicht mehr benötigt");
    await userEvent.click(dialog.getByRole("button", { name: "Zurückziehen" }));
    await expect(await canvas.findByText("Zurückziehen unklar")).toBeVisible();
    await expect(canvas.getByLabelText("Active tasks")).toHaveTextContent("Unabhängige Aufgabe");
    await expect(canvas.getByLabelText("Active tasks")).not.toHaveTextContent("Offener Vorschlag");
    await userEvent.click(canvas.getByText("Eingaben anzeigen"));
    await expect(canvas.getByText("Nicht mehr benötigt", { selector: "dd" })).toBeVisible();
    await userEvent.click(canvas.getByRole("button", { name: "Ergebnis prüfen" }));
    await expect(canvas.getByText(/Das Ergebnis bleibt unklar/)).toBeVisible();
    await expect(canvas.getByLabelText("Removal writes")).toHaveTextContent("1");
    await expect(canvas.getByLabelText("Removal checks")).toHaveTextContent("1");
  },
};

const blockedOperations: PlanningTaskLifecycleView[] = [
  { id: "create", taskId: "new", kind: "create", phase: "blocked", submitted: { creationRequestId: "create", taskType: "deliverable", title: "Neue Aufgabe", description: "Kontext", parentTaskId: "", ownerId: "" }, error: "", checkStatus: "not-checked" },
  ...(["delete_epic", "withdraw", "reject"] as const).map(kind => ({ id: kind, taskId: root.id, kind, phase: "blocked" as const, submitted: { task: root, reason: "Nicht mehr benötigt" }, error: "", checkStatus: "not-checked" as const })),
];
const checkBlocked = fn(async () => ({ outcome: "unconfirmed" as const, readStatus: "current" as const }));
export const BlockedActionsNameTheirOperation: Story = {
  render: () => <div>{blockedOperations.map(operation => <TaskLifecycleNotice key={operation.id} operation={operation} onCheck={checkBlocked} />)}</div>,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    for (const heading of ["Aufgabe noch nicht erstellt", "Noch nicht gelöscht", "Noch nicht zurückgezogen", "Noch nicht abgelehnt"]) {
      const notice = within(canvas.getByRole("heading", { name: heading }).closest('[role="status"]') as HTMLElement);
      await expect(notice.getByText("Zuerst muss eine frühere Änderung geprüft werden. Deine Eingaben bleiben erhalten.")).toBeVisible();
      await userEvent.click(notice.getByRole("button", { name: "Ergebnis prüfen" }));
    }
    await expect(checkBlocked).toHaveBeenCalledTimes(4);
    await expect(canvas.queryByText(/Die Erstellung wurde/)).not.toBeInTheDocument();
  },
};
