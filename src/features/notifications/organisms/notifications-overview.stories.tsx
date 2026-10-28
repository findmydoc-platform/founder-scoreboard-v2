import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, within } from "storybook/test";
import { NotificationsOverview } from "./notifications-overview";
import { emptyPlanningShellState } from "@/features/planning/model/planning-shell-state";
const meta = { component: NotificationsOverview, args: { currentProfile: null, data: emptyPlanningShellState, onOpenNotification: () => {}, onDismissNotification: () => {} } } satisfies Meta<typeof NotificationsOverview>;
export default meta;
type Story = StoryObj<typeof meta>;
export const ForbiddenIsNotAnEmptyResult: Story = { args: { readStatus: "forbidden" }, play: async ({ canvasElement }) => {
  const canvas = within(canvasElement);
  await expect(canvas.getByRole("status")).toHaveTextContent("Kein Zugriff auf Benachrichtigungen.");
  await expect(canvas.queryByText("Keine Hinweise für diesen Filter.")).not.toBeInTheDocument();
} };
export const Loading: Story = { args: { readStatus: "loading" } };
export const Unavailable: Story = { args: { readStatus: "unavailable" } };
