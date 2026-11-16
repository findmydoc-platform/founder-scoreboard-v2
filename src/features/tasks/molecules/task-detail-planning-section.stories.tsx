import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, fn, userEvent, waitFor, within } from "storybook/test";
import type { Sprint } from "@/lib/types";
import { TaskDetailPlanningSection } from "./task-detail-planning-section";
import { taskDetailStoryTask } from "./task-detail-story-fixtures";
import { useEffect, useState, useSyncExternalStore } from "react";
import { PlanningBusinessStateContext } from "@/features/planning/hooks/use-planning-business-state";
import { createEpicParentBrowserFixture, epicDetailInitiative, searchedParentEpic, parentDetailDeliverable, parentDetailSubIssue, searchedParentInitiative, searchedParentDeliverable } from "../../../../tests/helpers/epic-parent-browser-fixture";

const meta = {
  component: TaskDetailPlanningSection,
  decorators: [(Story) => <div className="w-[min(900px,90vw)] bg-white px-5"><Story /></div>],
  tags: ["domain:tasks", "layer:molecule", "status:stable"],
  title: "Features/Tasks/Molecules/TaskDetailPlanningSection",
  args: {
    teamProfiles: [],
    canManageTaskMeta: false,
    canReparentSubIssue: false,
    pending: false,
    onUpdate: fn(),
  },
} satisfies Meta<typeof TaskDetailPlanningSection>;

export default meta;
type Story = StoryObj<typeof meta>;

const epic = taskDetailStoryTask({
  id: "epic-parent",
  title: "Unique Parent Epic",
  taskType: "epic",
});
const initiative = taskDetailStoryTask({
  id: "initiative-child",
  title: "Initiative",
  taskType: "initiative",
  parentTaskId: epic.id,
  targetDate: "2026-08-30",
});

export const InitiativeHierarchy: Story = {
  args: {
    task: initiative,
    allTasks: [epic, initiative],
    sprints: [],
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.queryByText(epic.title)).not.toBeInTheDocument();
    await userEvent.click(canvas.getByRole("button", { name: "Einordnung anzeigen" }));
    await expect(canvas.getByText(epic.title)).toBeVisible();
  },
};

const parentInitiative = taskDetailStoryTask({
  id: "initiative-parent",
  title: "Unique Parent Initiative",
  taskType: "initiative",
});
const deliverable = taskDetailStoryTask({
  id: "deliverable-child",
  title: "Deliverable",
  parentTaskId: parentInitiative.id,
  sprintId: "sprint-1",
});
const sprint: Sprint = {
  id: "sprint-1",
  name: "Sprint 1",
  status: "active",
  startDate: "2026-06-02",
  endDate: "2026-06-04",
  reviewDueAt: "2026-06-05T10:00:00.000Z",
  scoreLocked: false,
};

export const DeliverableHierarchy: Story = {
  args: {
    task: deliverable,
    allTasks: [parentInitiative, deliverable],
    sprints: [sprint],
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText("Sprint 1")).toBeVisible();
    await expect(canvas.getByText("02.–04. Juni")).toBeVisible();
    await expect(canvas.queryByText(parentInitiative.title)).not.toBeInTheDocument();
    await userEvent.click(canvas.getByRole("button", { name: "Planung anzeigen" }));
    await expect(canvas.getByText(parentInitiative.title)).toBeVisible();
  },
};

function EpicDetailSelectionStory() {
  const [writtenParent, setWrittenParent] = useState("");
  const [fixture] = useState(() => createEpicParentBrowserFixture({ onWrite: payload => setWrittenParent(String(payload.parentTaskId || "")) }));
  useEffect(() => () => fixture.state.owner.internal.dispose(), [fixture]);
  const data = useSyncExternalStore(fixture.state.owner.planning.subscribe, fixture.state.owner.internal.getSnapshot, fixture.state.owner.internal.getSnapshot);
  const task = data.tasks.find(item => item.id === epicDetailInitiative.id)!;
  return <PlanningBusinessStateContext.Provider value={fixture.state.owner.planning}>
    <output aria-label="Detail parent update">{writtenParent}</output>
    <TaskDetailPlanningSection task={task} allTasks={data.tasks} teamProfiles={data.profiles} sprints={[]} canManageTaskMeta canReparentSubIssue={false} pending={false}
      onUpdate={patch => { void fixture.state.owner.planning.saveTask(task, patch); }} />
  </PlanningBusinessStateContext.Provider>;
}

export const InitiativeDetailDiscoversAndRetainsAnOffPageEpic: Story = {
  args: { task: initiative, allTasks: [epic, initiative], sprints: [] },
  render: () => <EpicDetailSelectionStory />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement), page = within(document.body);
    await userEvent.click(canvas.getByRole("button", { name: "Einordnung bearbeiten" }));
    const trigger = canvas.getByRole("combobox", { name: "Parent-Epic" });
    await userEvent.click(trigger);
    const search = await page.findByRole("searchbox", { name: "Epic suchen" });
    await userEvent.type(search, "Fern"); await userEvent.keyboard("{Enter}");
    await userEvent.click(await page.findByRole("option", { name: searchedParentEpic.title }));
    await expect(canvas.getByLabelText("Detail parent update")).toHaveTextContent(searchedParentEpic.id);
    await expect(trigger).toHaveTextContent(searchedParentEpic.title);
    await userEvent.click(trigger);
    const replacement = page.getByRole("searchbox", { name: "Epic suchen" });
    await userEvent.clear(replacement); await userEvent.type(replacement, "Kein Treffer"); await userEvent.keyboard("{Enter}");
    await expect(await page.findByText("Keine Epics gefunden.")).toBeVisible();
    await expect(trigger).toHaveTextContent(searchedParentEpic.title);
  },
};

function ParentDetailDiscoveryStory({ subIssue }: { subIssue: boolean }) {
  const selected = subIssue ? parentDetailSubIssue : parentDetailDeliverable;
  const [writtenParent, setWrittenParent] = useState("");
  const [fixture] = useState(() => createEpicParentBrowserFixture({ parentKind: subIssue ? "deliverable" : "initiative", detailTask: selected,
    onWrite: payload => setWrittenParent(String(payload.parentTaskId || "")) }));
  useEffect(() => () => fixture.state.owner.internal.dispose(), [fixture]);
  const data = useSyncExternalStore(fixture.state.owner.planning.subscribe, fixture.state.owner.internal.getSnapshot, fixture.state.owner.internal.getSnapshot);
  const task = data.tasks.find(item => item.id === selected.id)!;
  return <PlanningBusinessStateContext.Provider value={fixture.state.owner.planning}>
    <output aria-label="Parent detail mutation">{writtenParent}</output>
    <TaskDetailPlanningSection task={task} allTasks={data.tasks} teamProfiles={data.profiles} sprints={[]} canManageTaskMeta canReparentSubIssue pending={false}
      onUpdate={patch => { void fixture.state.owner.planning.saveTask(task, patch); }} />
  </PlanningBusinessStateContext.Provider>;
}
export const DeliverableDetailDiscoversAndRetainsAnOffPageInitiative: Story = {
  args: { task: parentDetailDeliverable, allTasks: [], sprints: [] }, render: () => <ParentDetailDiscoveryStory subIssue={false} />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement), page = within(document.body);
    await userEvent.click(canvas.getByRole("button", { name: "Planung bearbeiten" }));
    const trigger = canvas.getByRole("combobox", { name: "Initiative" });
    await userEvent.click(trigger);
    const search = await page.findByRole("searchbox", { name: "Initiative suchen" });
    await userEvent.type(search, "Fern"); await userEvent.keyboard("{Enter}");
    await userEvent.click(await page.findByRole("option", { name: searchedParentInitiative.title }));
    await waitFor(() => expect(canvas.getByLabelText("Parent detail mutation")).toHaveTextContent(searchedParentInitiative.id));
    await waitFor(() => expect(trigger).toHaveTextContent(searchedParentInitiative.title));
    await userEvent.click(trigger);
    const replacement = page.getByRole("searchbox", { name: "Initiative suchen" });
    await userEvent.clear(replacement); await userEvent.type(replacement, "Kein Treffer"); await userEvent.keyboard("{Enter}");
    await expect(await page.findByText("Keine Initiativen gefunden.")).toBeVisible();
    await expect(trigger).toHaveTextContent(searchedParentInitiative.title);
  },
};
export const SubIssueDetailDiscoversAndRetainsAnUnapprovedOffPageDeliverable: Story = {
  args: { task: parentDetailSubIssue, allTasks: [], sprints: [] }, render: () => <ParentDetailDiscoveryStory subIssue />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement), page = within(document.body);
    await userEvent.click(canvas.getByRole("button", { name: "Parent ändern" }));
    const trigger = canvas.getByRole("combobox", { name: "Parent-Deliverable" });
    await userEvent.click(trigger);
    const search = await page.findByRole("searchbox", { name: "Deliverable suchen" });
    await userEvent.type(search, "Fern"); await userEvent.keyboard("{Enter}");
    await userEvent.click(await page.findByRole("option", { name: /Fernes Deliverable.*Initiative mit Parent.*wartet auf Freigabe/ }));
    await waitFor(() => expect(canvas.getByLabelText("Parent detail mutation")).toHaveTextContent(searchedParentDeliverable.id));
    await waitFor(() => expect(trigger).toHaveTextContent(searchedParentDeliverable.title));
    await expect(trigger).toHaveTextContent("wartet auf Freigabe");
    await userEvent.click(trigger);
    const replacement = page.getByRole("searchbox", { name: "Deliverable suchen" });
    await userEvent.clear(replacement); await userEvent.type(replacement, "Kein Treffer"); await userEvent.keyboard("{Enter}");
    await expect(await page.findByText("Keine Deliverables gefunden.")).toBeVisible();
    await expect(trigger).toHaveTextContent(searchedParentDeliverable.title);
  },
};
