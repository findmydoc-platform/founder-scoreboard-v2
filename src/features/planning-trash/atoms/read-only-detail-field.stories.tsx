import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, within } from "storybook/test";
import { ReadOnlyDetailField } from "./read-only-detail-field";

const meta = {
  component: ReadOnlyDetailField,
  args: {
    children: "Diese Information bleibt im Papierkorb unverändert.",
    label: "Beschreibung",
  },
  decorators: [(Story) => <dl className="w-96"><Story /></dl>],
  tags: ["domain:planning-trash", "layer:atom", "status:stable"],
  title: "Features/PlanningTrash/Atoms/ReadOnlyDetailField",
} satisfies Meta<typeof ReadOnlyDetailField>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Empty: Story = {
  args: {
    children: "",
  },
};

export const PlainTextUrl: Story = {
  args: {
    children: "Prüfunterlagen: https://example.com/papertrail.",
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const link = canvas.getByRole("link", { name: "https://example.com/papertrail (öffnet in neuem Tab)" });

    await expect(link).toHaveAttribute("href", "https://example.com/papertrail");
    await expect(canvasElement.textContent).toBe("BeschreibungPrüfunterlagen: https://example.com/papertrail.");
  },
};
