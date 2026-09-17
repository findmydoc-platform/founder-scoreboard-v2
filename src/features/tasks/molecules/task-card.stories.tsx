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
    ownerColor: "#7c3aed",
    relations: [],
    task: deliverable,
    viewerOpenSubIssueIds: [subIssues[0].id],
  },
  decorators: [(Story) => <div className="w-80 bg-slate-50 p-2"><Story /></div>],
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
    await expect(canvas.queryByText(subIssues[0].title)).not.toBeInTheDocument();
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
