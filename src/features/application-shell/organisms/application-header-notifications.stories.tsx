import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, userEvent, waitFor, within } from "storybook/test";
import { getRouter } from "@storybook/nextjs-vite/navigation.mock";
import { PlanningApp } from "@/features/planning/PlanningApp";
import { TaskDetailPage } from "@/features/tasks/templates/task-detail-page";
import { taskDetailModelToPlanningShellState } from "@/features/tasks/model/task-detail-planning-shell-projection";
import { readyHeaderSlot } from "@/lib/planning-header-data";
import type { HeaderNotification } from "@/lib/types";
import { itemPageHeaderData, itemPageModel, itemPageProfile, itemPageUser, mockItemPageBrowser } from "../../../../tests/helpers/task-detail-page-browser-fixture";

const notification: HeaderNotification = {
  id: 597, type: "task.assigned", actorProfileId: "", actorLabel: "System", recipientProfileId: itemPageProfile.id,
  entityType: "task", entityId: "item-page-task", title: "Open planning assignment", body: "Inspect the assigned Item.",
  targetPath: "", createdAt: "2026-11-02T09:00:00Z",
};
const headerData = { ...itemPageHeaderData, notifications: readyHeaderSlot({ unreadCount: 1, items: [notification] }) };

function notificationHeader(targetPath = "") {
  return { ...headerData, notifications: readyHeaderSlot({ unreadCount: 1, items: [{ ...notification, targetPath }] }) };
}

function NotificationPlanningPage({ host = "planning", targetPath = "" }: { host?: "planning" | "item"; targetPath?: string; outcome?: "saved" | "unconfirmed" }) {
  const pageHeader = notificationHeader(targetPath);
  if (host === "item") return <TaskDetailPage taskId="item-page-task" initialModel={itemPageModel()} headerData={pageHeader}
    source="supabase" authRequired initialAuthUser={itemPageUser} initialCurrentProfile={itemPageProfile} />;
  return <PlanningApp
    initialData={taskDetailModelToPlanningShellState(itemPageModel())} initialHeaderData={pageHeader}
    initialWorkspace="planning" source="supabase" authRequired initialAuthUser={itemPageUser}
    initialCurrentProfile={itemPageProfile} initialProtectedDataLoaded
  />;
}

let statusActions: string[] = [];
const meta = {
  title: "Application shell/Notifications",
  component: NotificationPlanningPage,
  parameters: { layout: "fullscreen", nextjs: { appDirectory: true } },
  beforeEach: ({ args }) => {
    statusActions = [];
    return mockItemPageBrowser({ headerData: notificationHeader(args.targetPath), respond: (input, init) => {
      if (new URL(String(input), window.location.origin).pathname === "/api/notifications/597" && init?.method === "PATCH") {
        statusActions.push(JSON.parse(String(init.body)).action);
        if (args.outcome === "unconfirmed") return Response.json({ error: "Response was lost" }, { status: 503 });
        return Response.json({ ok: true, action: "seen", status: "pending" });
      }
      return undefined;
    } });
  },
} satisfies Meta<typeof NotificationPlanningPage>;
export default meta;
type Story = StoryObj<typeof meta>;

export const LoadedPlanningItemOpensFullPage: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(await canvas.findByRole("button", { name: "Benachrichtigungen" }));
    await userEvent.click(canvas.getByRole("link", { name: /Open planning assignment/ }));
    await waitFor(() => expect(getRouter().push).toHaveBeenCalledTimes(1));
    await expect(getRouter().push).toHaveBeenCalledWith("/tasks/item-page-task");
  },
};

export const DirtyItemKeepsOrDiscardsNotificationNavigation: Story = {
  args: { host: "item" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(await canvas.findByRole("button", { name: "Bearbeiten" }));
    const title = canvas.getByRole("textbox", { name: "Titel" });
    await userEvent.type(title, " with private edits");
    await userEvent.click(canvas.getByRole("button", { name: "Benachrichtigungen" }));
    await userEvent.click(canvas.getByRole("link", { name: /Open planning assignment/ }));
    await userEvent.click(within(await canvas.findByRole("alertdialog")).getByRole("button", { name: "Weiter bearbeiten" }));
    await expect(title).toHaveValue("Reliable planning with private edits");
    await expect(getRouter().push).not.toHaveBeenCalled();
    await expect(statusActions).toEqual([]);
    await userEvent.click(canvas.getByRole("button", { name: "Benachrichtigungen" }));
    await userEvent.click(canvas.getByRole("link", { name: /Open planning assignment/ }));
    await userEvent.click(within(await canvas.findByRole("alertdialog")).getByRole("button", { name: "Änderungen verwerfen" }));
    await waitFor(() => expect(getRouter().push).toHaveBeenCalledTimes(1));
    await expect(getRouter().push).toHaveBeenCalledWith("/tasks/item-page-task");
    await expect(statusActions).toEqual(["seen"]);
  },
};

const anchoredTarget = "/tasks/item-page-task?comment=github%3A42&returnTo=%2Fteam%2Fplatform-releases%2Fv1.2.3%3Fsection%3Dplanning%23change-7#discussion";

export const ExplicitTargetKeepsQueryAndAnchor: Story = {
  args: { targetPath: anchoredTarget },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(await canvas.findByRole("button", { name: "Benachrichtigungen" }));
    const target = canvas.getByRole("link", { name: /Open planning assignment/ });
    await expect(target).toHaveAttribute("href", anchoredTarget);
    const user = userEvent.setup();
    await user.keyboard("{Control>}");
    await user.click(target);
    await user.keyboard("{/Control}");
    await expect(statusActions).toEqual([]);
    await expect(getRouter().push).not.toHaveBeenCalled();
    await userEvent.click(target);
    await waitFor(() => expect(getRouter().push).toHaveBeenCalledTimes(1));
    await expect(getRouter().push).toHaveBeenCalledWith(anchoredTarget);
    await expect(statusActions).toEqual(["seen"]);
  },
};

export const UnconfirmedSeenDoesNotNavigateOrReplay: Story = {
  args: { outcome: "unconfirmed" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(await canvas.findByRole("button", { name: "Benachrichtigungen" }));
    await userEvent.click(canvas.getByRole("link", { name: /Open planning assignment/ }));
    await expect(await canvas.findByText(/Ob die Benachrichtigung als gesehen markiert wurde, ist noch unklar/)).toBeVisible();
    await expect(getRouter().push).not.toHaveBeenCalled();
    await userEvent.click(canvas.getByRole("button", { name: "Aktuellen Stand prüfen" }));
    await expect(await canvas.findByRole("button", { name: "Aktuellen Stand prüfen" })).toBeEnabled();
    await expect(statusActions).toEqual(["seen"]);
    await expect(getRouter().push).not.toHaveBeenCalled();
  },
};
