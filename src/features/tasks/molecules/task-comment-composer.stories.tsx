import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, fn, userEvent, within } from "storybook/test";
import type { Profile } from "@/lib/types";
import { TaskCommentComposer } from "./task-comment-composer";

const profiles: Profile[] = [
  { id: "sebastian", name: "Sebastian Schütze", role: "admin", platformRole: "ceo", orgRole: "CEO", githubLogin: "SebastianSchuetze", weeklyCapacity: 40 },
  { id: "volkan", name: "Mehmet Volkan Kablan", role: "member", platformRole: "founder", orgRole: "Engineering", githubLogin: "MehmetVolkan", weeklyCapacity: 40 },
  { id: "volker", name: "Volker Beispiel", role: "member", platformRole: "viewer", orgRole: "Advisory", githubLogin: "volker", weeklyCapacity: 8 },
];

const meta = {
  component: TaskCommentComposer,
  decorators: [(Story) => <div className="w-[min(680px,90vw)]"><Story /></div>],
  tags: ["domain:tasks", "layer:molecule", "status:stable"],
  title: "Features/Tasks/Molecules/TaskCommentComposer",
  args: {
    onAddComment: fn(),
    profiles,
    renderPreview: (value: string) => <p>{value}</p>,
  },
} satisfies Meta<typeof TaskCommentComposer>;

export default meta;
type Story = StoryObj<typeof meta>;

export const KeyboardSelection: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const textbox = canvas.getByRole("textbox", { name: "Kommentar oder Update" });
    await userEvent.type(textbox, "Bitte @vol");
    const listbox = canvas.getByRole("listbox", { name: "Person erwähnen" });
    await expect(listbox).toBeVisible();
    await expect(listbox).toHaveStyle({ position: "absolute" });
    await expect(listbox.getBoundingClientRect().top).toBeLessThan(textbox.getBoundingClientRect().bottom);
    await userEvent.keyboard("{ArrowDown}{Enter}");
    await expect(textbox).toHaveValue("Bitte @volker ");
    await expect(canvas.queryByRole("listbox", { name: "Person erwähnen" })).not.toBeInTheDocument();
  },
};

export const TabSelectionKeepsFocus: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const textbox = canvas.getByRole("textbox", { name: "Kommentar oder Update" });
    const textarea = textbox as HTMLTextAreaElement;
    await userEvent.type(textbox, "@seb");
    await userEvent.keyboard("{Tab}");
    await expect(textbox).toHaveValue("@SebastianSchuetze ");
    await expect(canvasElement.ownerDocument.activeElement).toBe(textbox);
    await expect(textarea.selectionStart).toBe(textarea.value.length);
    await expect(textarea.selectionEnd).toBe(textarea.value.length);
  },
};

export const EscapeClosesMentionSearch: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const textbox = canvas.getByRole("textbox", { name: "Kommentar oder Update" });
    await userEvent.type(textbox, "@seb");
    await userEvent.keyboard("{Escape}");
    await expect(textbox).toHaveValue("@seb");
    await expect(canvas.queryByRole("listbox", { name: "Person erwähnen" })).not.toBeInTheDocument();
  },
};

export const PointerSelection: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const textbox = canvas.getByRole("textbox", { name: "Kommentar oder Update" });
    await userEvent.type(textbox, "@seb");
    await userEvent.click(canvas.getByRole("option", { name: "Sebastian Schütze, @SebastianSchuetze" }));
    await expect(textbox).toHaveValue("@SebastianSchuetze ");
  },
};

export const EmptyMentionSearch: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.type(canvas.getByRole("textbox", { name: "Kommentar oder Update" }), "@niemand");
    await expect(canvas.getByRole("status")).toHaveTextContent("Keine passenden Personen.");
    await expect(canvas.queryByRole("listbox", { name: "Person erwähnen" })).not.toBeInTheDocument();
    await expect(canvas.queryByRole("option")).not.toBeInTheDocument();
  },
};

export const MentionPopoverFollowsCaret: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const textbox = canvas.getByRole("textbox", { name: "Kommentar oder Update" });
    await userEvent.type(textbox, "@vol");
    const firstLeft = canvas.getByRole("listbox", { name: "Person erwähnen" }).getBoundingClientRect().left;
    await userEvent.clear(textbox);
    await userEvent.type(textbox, "Bitte @vol");
    const listbox = canvas.getByRole("listbox", { name: "Person erwähnen" });
    const textboxRect = textbox.getBoundingClientRect();
    const listboxRect = listbox.getBoundingClientRect();
    await expect(listboxRect.left).toBeGreaterThan(firstLeft + 20);
    await expect(listboxRect.left).toBeGreaterThanOrEqual(textboxRect.left);
    await expect(listboxRect.right).toBeLessThanOrEqual(textboxRect.right);
  },
};
