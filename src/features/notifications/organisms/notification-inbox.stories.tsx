import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, within } from "storybook/test";
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
