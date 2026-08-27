import type { Meta, StoryObj } from "@storybook/nextjs-vite";
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
