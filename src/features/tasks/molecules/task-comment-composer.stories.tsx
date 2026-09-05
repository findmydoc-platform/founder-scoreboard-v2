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
    await expect(canvas.getByText("Keine passenden Personen.")).toBeVisible();
  },
};
