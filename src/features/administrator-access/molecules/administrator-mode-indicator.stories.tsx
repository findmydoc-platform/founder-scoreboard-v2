import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, fn, userEvent, within } from "storybook/test";
import { AdministratorModeIndicator } from "./administrator-mode-indicator";

const onEnd = fn();

const meta = {
  args: {
    busy: false,
    onEnd,
    remainingSeconds: 2862,
  },
  component: AdministratorModeIndicator,
  decorators: [
    (Story) => (
      <div className="flex min-h-20 items-center justify-center bg-white px-4">
        <Story />
      </div>
    ),
  ],
  parameters: { layout: "fullscreen" },
  tags: ["layer:molecule", "status:stable"],
  title: "Administrator Access/Molecules/AdministratorModeIndicator",
} satisfies Meta<typeof AdministratorModeIndicator>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Active: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const status = canvas.getByRole("status", { name: "Admin-Modus aktiv. Noch etwa 48 Minuten verbleibend." });

    await expect(status).toHaveTextContent("Admin-Modus aktiv");
    await expect(status).toHaveTextContent("47:42 verbleibend");
    await expect(status).toHaveAttribute("data-tone", "critical");
    await userEvent.click(canvas.getByRole("button", { name: "Admin-Modus beenden" }));
    await expect(onEnd).toHaveBeenCalledOnce();
  },
};

