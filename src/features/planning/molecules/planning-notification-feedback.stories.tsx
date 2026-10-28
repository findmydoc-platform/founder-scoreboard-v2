import { useState, useSyncExternalStore } from "react";
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, userEvent, waitFor, within } from "storybook/test";
import { createPlanningState } from "../model/internal/planning-state-owner";
import { PlanningBusinessStateContext } from "../hooks/use-planning-business-state";
import { emptyPlanningShellState } from "../model/planning-shell-state";
import { emptyPlanningHeaderData, readyHeaderSlot } from "@/lib/planning-header-data";
import { NotificationInbox } from "@/features/notifications/organisms/notification-inbox";
import { PlanningNotificationFeedback } from "./planning-notification-feedback";
import type { NotificationEvent } from "@/lib/types";
import { useNotificationCommands } from "../hooks/use-notification-commands";
import type { PlanningCommandContext } from "../hooks/planning-command-context";

const event = { id: 1, title: "Meine Benachrichtigung", status: "pending", seenAt: "", dismissedAt: "", resolvedAt: "", resolutionReason: "", recipientProfileId: "profile", actorProfileId: "", entityId: "task", entityType: "task", type: "task_changed", body: "", createdAt: "2026-10-28T00:00:00Z" } satisfies NotificationEvent;
const second = { ...event, id: 2, title: "Unabhängiger Hinweis" };
function NotificationFeedbackStory() {
  const [open, setOpen] = useState(true);
  const [server] = useState(() => {
    let reject!: (error: Error) => void;
    const fixture = { writes: 0, reads: 0, lose: () => reject(new Error("Verbindung unterbrochen")), reject: () => reject(Object.assign(new Error("Aktion abgelehnt"), { status: 422 })), write: (id: number, action: "seen" | "dismiss") => { fixture.writes++; if (id === 2) return Promise.resolve({ action, status: "dismissed" as const }); return new Promise<{ action: "seen" | "dismiss"; status: "dismissed" }>((_resolve, fail) => { reject = fail; }); } };
    return fixture;
  });
  const [owner] = useState(() => createPlanningState({ userId: "notification-story", initialData: { ...emptyPlanningShellState, notificationEvents: [event, second] }, initialWorkspace: "notifications", initialHeaderData: { ...emptyPlanningHeaderData, notifications: readyHeaderSlot({ unreadCount: 27, items: [event, second] }) }, adapter: {
    saveTask: async () => ({ task: {} }), readWorkspace: async () => null, updateNotification: server.write,
    readHeader: async () => { server.reads++; return { ...emptyPlanningHeaderData, notifications: readyHeaderSlot({ unreadCount: 26, items: [second] }) }; },
  } }));
  const data = useSyncExternalStore(owner.planning.subscribe, owner.internal.getSnapshot, owner.internal.getSnapshot);
  const context = { planningState: owner.planning, data, setSaveError: () => {} } as unknown as PlanningCommandContext;
  const commands = useNotificationCommands({ ...context, openTaskPanel: () => {}, refreshCurrentWorkspaceModel: async () => {}, setShowNotifications: () => {}, setWorkspace: () => {}, workspace: "planning" });
  return <PlanningBusinessStateContext.Provider value={owner.planning}><main className="min-h-96 p-4">
    <h1>Benachrichtigungen</h1><p>Writes: {server.writes}</p><p>Checks: {server.reads}</p>
    <button onClick={server.lose}>Lose response</button><button onClick={server.reject}>Reject action</button>
    <NotificationInbox notifications={owner.planning.header().data.notifications} open={open} onToggle={() => setOpen(value => !value)} onDismiss={commands.dismissNotification} />
    <PlanningNotificationFeedback />
  </main></PlanningBusinessStateContext.Provider>;
}
const meta = { component: NotificationFeedbackStory, title: "Planning/Notifications/CoordinatedActions" } satisfies Meta<typeof NotificationFeedbackStory>;
export default meta;
type Story = StoryObj<typeof meta>;
export const UnknownOutcomeChecksWithoutReplayAndIndependentActionContinues: Story = { play: async ({ canvasElement }) => {
  const canvas = within(canvasElement);
  await userEvent.click(canvas.getAllByRole("button", { name: "Notification schließen" })[0]);
  await expect(canvas.getByRole("status")).toHaveTextContent("wird geschlossen");
  await userEvent.click(canvas.getByRole("button", { name: "Lose response" }));
  await expect(await canvas.findByRole("status")).toHaveTextContent("Ob die Benachrichtigung geschlossen wurde, ist noch unklar");
  await userEvent.click(canvas.getByRole("button", { name: "Aktuellen Stand prüfen" }));
  await waitFor(() => expect(canvas.getByText("Checks: 1")).toBeVisible());
  await expect(canvas.getByText("Writes: 1")).toBeVisible();
  await expect(canvas.getByRole("status")).toHaveTextContent("Ob die Benachrichtigung geschlossen wurde, ist noch unklar");
  await userEvent.click(canvas.getByRole("button", { name: "Benachrichtigungen" }));
  await userEvent.click(canvas.getByRole("button", { name: "Notification schließen" }));
  await waitFor(() => expect(canvas.getByText("Writes: 2")).toBeVisible());
} };
export const KnownFailureRestoresOnlyTheRejectedNotification: Story = { play: async ({ canvasElement }) => {
  const canvas = within(canvasElement);
  await userEvent.click(canvas.getAllByRole("button", { name: "Notification schließen" })[0]);
  await userEvent.click(canvas.getByRole("button", { name: "Reject action" }));
  await expect(await canvas.findByRole("status")).toHaveTextContent("Aktion abgelehnt");
  await userEvent.click(canvas.getByRole("button", { name: "Benachrichtigungen" }));
  await expect(canvas.getByText("Meine Benachrichtigung")).toBeVisible();
  await expect(canvas.getByText("Unabhängiger Hinweis")).toBeVisible();
} };
