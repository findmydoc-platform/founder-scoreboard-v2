import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { CommentBody } from "./task-comment-body";

const meta = {
  component: CommentBody,
  args: {
    value: "## Status\n\n- [x] API-Vertrag geprüft\n- [ ] Preview verifizieren\n\nDetails stehen im [Issue](https://github.com/findmydoc-platform/management).",
  },
  decorators: [(Story) => <div className="w-[min(640px,90vw)]"><Story /></div>],
  tags: ["domain:tasks", "layer:atom", "status:stable"],
  title: "Features/Tasks/Atoms/CommentBody",
} satisfies Meta<typeof CommentBody>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Markdown: Story = {};
