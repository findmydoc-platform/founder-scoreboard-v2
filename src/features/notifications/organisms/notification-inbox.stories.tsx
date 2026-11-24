import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, fn, userEvent, within } from "storybook/test";
import { NotificationInbox } from "./notification-inbox";

const meta = {
  component: NotificationInbox,
  title: "Notifications/Organisms/NotificationInbox",
  tags: ["layer:organism", "status:stable"],
  args: { open: true, onToggle: () => {} },
} satisfies Meta<typeof NotificationInbox>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Loading: Story = {
  args: { notifications: { state: "loading", data: { unreadCount: 0, items: [] } } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole("button", { name: "Benachrichtigungen werden geladen" })).toHaveAttribute("aria-busy", "true");
    await expect(canvas.getByText("Benachrichtigungen werden geladen.")).toBeVisible();
    await expect(canvas.queryByText("Keine neuen Hinweise.")).not.toBeInTheDocument();
  },
};

export const Idle: Story = {
  ...Loading,
  args: { notifications: { state: "idle", data: { unreadCount: 0, items: [] } } },
};

export const Empty: Story = {
  args: { notifications: { state: "ready", data: { unreadCount: 0, items: [] } } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole("button", { name: "Benachrichtigungen" })).toHaveAttribute("aria-busy", "false");
    await expect(canvas.getByText("Keine neuen Hinweise.")).toBeVisible();
  },
};

export const Failed: Story = {
  args: { notifications: { state: "error", data: { unreadCount: 0, items: [] }, error: "Benachrichtigungen konnten nicht geladen werden." } },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByText("Benachrichtigungen konnten nicht geladen werden.")).toBeVisible();
  },
};

const visibleNotification = {
  id: 41, type: "task.assigned", actorProfileId: "", actorLabel: "System", recipientProfileId: "person",
  entityType: "task", entityId: "off-page-item", title: "A usable notification", body: "", targetPath: "", createdAt: "2026-11-02T09:00:00Z",
};

export const PreviewRemainsUsableWhileCountLoads: Story = {
  args: {
    notifications: { state: "ready", data: { unreadCount: 0, items: [visibleNotification] } },
    count: { state: "loading", data: null },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole("link", { name: /A usable notification/ })).toHaveAttribute("href", "/tasks/off-page-item");
    await expect(canvas.getByText("Ungelesene Anzahl wird geladen.")).toBeVisible();
    await expect(canvas.queryByText("0")).not.toBeInTheDocument();
  },
};

export const PreviewRemainsUsableWhenCountFails: Story = {
  args: {
    notifications: { state: "ready", data: { unreadCount: 0, items: [visibleNotification] } },
    count: { state: "error", data: null },
    onRetryCount: fn(),
  },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole("link", { name: /A usable notification/ })).toBeVisible();
    await expect(canvas.getByRole("button", { name: "Ungelesene Anzahl erneut laden" })).toBeVisible();
    await userEvent.click(canvas.getByRole("button", { name: "Ungelesene Anzahl erneut laden" }));
    await expect(args.onRetryCount).toHaveBeenCalledOnce();
    await expect(canvas.queryByText("0")).not.toBeInTheDocument();
  },
};

export const PreviewRefreshFailureKeepsContent: Story = {
  args: { notifications: { state: "ready", freshness: "stale", data: { unreadCount: 0, items: [visibleNotification] }, error: "Aktualisierung fehlgeschlagen." }, onRetryPreview: fn() },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole("link", { name: /A usable notification/ })).toBeVisible();
    await userEvent.click(canvas.getByRole("button", { name: "Benachrichtigungen erneut laden" }));
    await expect(args.onRetryPreview).toHaveBeenCalledOnce();
  },
};
