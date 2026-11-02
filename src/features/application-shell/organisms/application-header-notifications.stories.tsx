import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, userEvent, waitFor, within } from "storybook/test";
import { getRouter } from "@storybook/nextjs-vite/navigation.mock";
import { PlanningApp } from "@/features/planning/PlanningApp";
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

function NotificationPlanningPage() {
  return <PlanningApp
    initialData={taskDetailModelToPlanningShellState(itemPageModel())} initialHeaderData={headerData}
    initialWorkspace="planning" source="supabase" authRequired initialAuthUser={itemPageUser}
    initialCurrentProfile={itemPageProfile} initialProtectedDataLoaded
  />;
}

const meta = {
  title: "Application shell/Notifications",
  component: NotificationPlanningPage,
  parameters: { layout: "fullscreen", nextjs: { appDirectory: true } },
  beforeEach: () => mockItemPageBrowser({ headerData, respond: (input, init) => {
    if (new URL(String(input), window.location.origin).pathname === "/api/notifications/597" && init?.method === "PATCH") {
      return Response.json({ ok: true, action: "seen", status: "pending" });
    }
    return undefined;
  } }),
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

