import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, fn, userEvent, within } from "storybook/test";
import { TaskCard } from "./task-card";
import { taskDetailStoryTask } from "./task-detail-story-fixtures";

const deliverable = taskDetailStoryTask({
  id: "deliverable-1",
  title: "Persönliche Meilensteine der Founder dokumentieren",
  status: "In Arbeit",
  assigneeId: "volkan",
  assignee: "Volkan",
  ownerId: "volkan",
  owner: "Volkan",
  acceptanceCriteria: "Milestones are documented.",
  definitionOfDone: "Documentation is complete.",
});

const sampleAvatar = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 96 96'%3E%3Crect width='96' height='96' fill='%23dbeafe'/%3E%3Ccircle cx='48' cy='36' r='18' fill='%233b82f6'/%3E%3Cpath d='M13 96c2-23 15-35 35-35s33 12 35 35' fill='%231d4ed8'/%3E%3C/svg%3E";

const subIssues = [
  taskDetailStoryTask({
    id: "sub-issue-1",
    title: "Initialen 10-%-Meilenstein dokumentieren",
    taskType: "sub_issue",
    parentTaskId: deliverable.id,
    status: "Offen",
    assigneeId: "sebastian",
    assignee: "Sebastian",
    ownerId: "sebastian",
    owner: "Sebastian",
    approvalStatus: null,
  }),
];

const multipleAssignedSubIssues = [
  ...subIssues,
  taskDetailStoryTask({
    id: "sub-issue-assigned-2",
    order: 2,
    title: "Zweiten Meilenstein dokumentieren",
    taskType: "sub_issue",
    parentTaskId: deliverable.id,
    status: "In Arbeit",
    assigneeId: "sebastian",
    assignee: "Sebastian",
    ownerId: "sebastian",
    owner: "Sebastian",
    approvalStatus: null,
  }),
];

const twentySubIssues = [
  ...subIssues,
  ...Array.from({ length: 19 }, (_, index) => taskDetailStoryTask({
    id: `sub-issue-${index + 2}`,
    order: index + 2,
    title: `Weiteres Sub-Issue ${index + 2}`,
    taskType: "sub_issue",
    parentTaskId: deliverable.id,
    status: "Erledigt",
    assigneeId: "volkan",
    assignee: "Volkan",
    ownerId: "volkan",
    owner: "Volkan",
    approvalStatus: null,
  })),
];

const meta = {
  component: TaskCard,
  args: {
    allTasks: [deliverable, ...subIssues],
    blockers: [],
    childItems: subIssues,
    onOpenTask: fn(),
    assigneeProfile: { id: "volkan", name: "Volkan", color: "#7c3aed", avatarUrl: sampleAvatar },
    relations: [],
    task: deliverable,
    viewerOpenSubIssueIds: [subIssues[0].id],
  },
  decorators: [(Story) => <div className="w-full max-w-80 bg-slate-50 p-2"><Story /></div>],
  tags: ["domain:tasks", "layer:molecule", "status:stable"],
  title: "Features/Tasks/Molecules/TaskCard",
} satisfies Meta<typeof TaskCard>;

export default meta;
type Story = StoryObj<typeof meta>;

export const ForeignDeliverableWithAssignedSubIssue: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText("1 offenes Sub-Issue für dich")).toBeVisible();
    await expect(canvas.getByText(deliverable.title)).toBeVisible();
    await expect(canvas.getByText("Volkan")).toBeVisible();
    await expect(canvasElement.querySelector("img[src^='data:image/svg+xml']")).toBeVisible();
    await expect(canvas.queryByText(subIssues[0].title)).not.toBeInTheDocument();
  },
};

export const AssigneeWithoutAvatar: Story = {
  args: { assigneeProfile: { id: "volkan", name: "Volkan", color: "#7c3aed" } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText("V", { exact: true })).toBeVisible();
    await expect(canvasElement.querySelector("img")).not.toBeInTheDocument();
  },
};

export const AssigneeWithBrokenAvatar: Story = {
  args: { assigneeProfile: { id: "volkan", name: "Volkan", color: "#7c3aed", avatarUrl: "/missing-assignee-avatar.png" } },
  play: async ({ canvasElement }) => {
    await expect(await within(canvasElement).findByText("V", { exact: true })).toBeVisible();
  },
};

export const Unassigned: Story = {
  args: {
    assigneeProfile: undefined,
    task: taskDetailStoryTask({ ...deliverable, assigneeId: "", assignee: "", ownerId: "", owner: "" }),
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText("?", { exact: true })).toBeVisible();
    await expect(canvas.getByText("Nicht zugeordnet")).toBeVisible();
  },
};

export const NarrowCardWithDueDate: Story = {
  args: {
    assigneeProfile: { id: "volkan", name: "Volkan Mehmet Kablan", color: "#7c3aed", avatarUrl: sampleAvatar },
    task: taskDetailStoryTask({ ...deliverable, assignee: "Volkan Mehmet Kablan", targetDate: "12.10.2026" }),
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText("Volkan Mehmet Kablan")).toBeVisible();
    await expect(canvas.getByText("12.10.2026")).toBeVisible();
  },
};

export const ForeignDeliverableWithMultipleAssignedSubIssues: Story = {
  args: {
    allTasks: [deliverable, ...multipleAssignedSubIssues],
    childItems: multipleAssignedSubIssues,
    viewerOpenSubIssueIds: multipleAssignedSubIssues.map((subIssue) => subIssue.id),
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText("2 offene Sub-Issues für dich")).toBeVisible();
    await expect(canvas.getByText(deliverable.title)).toBeVisible();
    await userEvent.click(canvas.getByRole("button", { name: "Sub-Issues anzeigen: 2 offen, 0 erledigt" }));
    await expect(canvas.getByText("Für dich (2)")).toBeVisible();
  },
};

export const ForeignDeliverableWithPersonalSubIssueGroup: Story = {
  args: {
    allTasks: [deliverable, ...twentySubIssues],
    childItems: twentySubIssues,
    viewerOpenSubIssueIds: [subIssues[0].id],
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: "Sub-Issues anzeigen: 1 offen, 19 erledigt" }));

    await expect(canvas.getByText("Für dich (1)")).toBeVisible();
    await expect(canvas.getByText("Weitere Sub-Issues (19)")).toBeVisible();
    await expect(canvas.getByText("Für dich", { exact: true })).toBeVisible();
    await expect(canvas.getByRole("link", {
      name: `${subIssues[0].title}, Status Offen`,
    })).toBeVisible();
    await expect(canvas.queryByRole("link", {
      name: "Weiteres Sub-Issue 20, Status Erledigt",
    })).not.toBeInTheDocument();

    const showRemainingSubIssuesButton = canvas.getByRole("button", { name: "Weitere 9 Sub-Issues anzeigen" });
    await expect(getComputedStyle(canvas.getByText("Weitere 9 Sub-Issues", { exact: true })).fontSize).toBe("10px");
    await userEvent.click(showRemainingSubIssuesButton);
    await expect(canvas.getByRole("link", {
      name: "Weiteres Sub-Issue 20, Status Erledigt",
    })).toBeVisible();

    await userEvent.click(canvas.getByRole("button", { name: "Sub-Issues einklappen: 1 offen, 19 erledigt" }));
    await userEvent.click(canvas.getByRole("button", { name: "Sub-Issues anzeigen: 1 offen, 19 erledigt" }));
    await expect(canvas.queryByRole("link", {
      name: "Weiteres Sub-Issue 20, Status Erledigt",
    })).not.toBeInTheDocument();
    await expect(canvas.getByRole("button", { name: "Weitere 9 Sub-Issues anzeigen" })).toBeVisible();
  },
};

export const DeliverableWithoutPersonalNotice: Story = {
  args: {
    viewerOpenSubIssueIds: [],
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.queryByText(/für dich/)).not.toBeInTheDocument();
    await expect(canvas.getByText(deliverable.title)).toBeVisible();
  },
};
