import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { useState } from "react";
import { expect, userEvent, within } from "storybook/test";
import { PlanningFilters } from "./planning-filters";
import { DEFAULT_PLANNING_FILTERS } from "../model/planning-board-query";
import { taskDetailStoryTask } from "@/features/tasks/molecules/task-detail-story-fixtures";

const current = taskDetailStoryTask({ id: "selected-epic", title: "Synthetic selected Epic", taskType: "epic", status: "Erledigt" });
const epics = [{ id: current.id, title: current.title }, { id: "off-page-epic", title: "Synthetic off-page Epic" }];
function ParentOptionsFlow() {
  const [parent, setParent] = useState(current.id);
  return <><output aria-label="Gewähltes Epic">{parent}</output><PlanningFilters
    filters={DEFAULT_PLANNING_FILTERS} planningLevel="initiative" planningParentFilterId={parent}
    profiles={[]} initiatives={[]} sprints={[]} tasks={[current]} workstreams={[]} quickFilters={[]}
    {...{ epics }} expanded showPlanningLevel visibleCount={1} totalCount={1}
    onExpandedChange={() => undefined} onChange={() => undefined} onPlanningLevelChange={() => undefined}
    onPlanningParentFilterChange={setParent} /></>;
}
const meta = { title: "Planning/Scalar parent options", component: ParentOptionsFlow, parameters: { layout: "fullscreen" } } satisfies Meta<typeof ParentOptionsFlow>;
export default meta;
type Story = StoryObj<typeof meta>;
export const OffPageEpicRemainsSelectableWithoutAnItemRecord: Story = { play: async ({ canvasElement }) => {
  const canvas = within(canvasElement), screen = within(document.body);
  await expect(canvas.getByLabelText("Gewähltes Epic")).toHaveTextContent(current.id);
  await userEvent.click(canvas.getByRole("combobox", { name: "Nach Parent-Epic filtern" }));
  await userEvent.click(await screen.findByRole("option", { name: epics[1].title }));
  await expect(canvas.getByLabelText("Gewähltes Epic")).toHaveTextContent(epics[1].id);
  await userEvent.click(canvas.getByRole("combobox", { name: "Nach Parent-Epic filtern" }));
  await userEvent.click(await screen.findByRole("option", { name: current.title }));
  await expect(canvas.getByLabelText("Gewähltes Epic")).toHaveTextContent(current.id);
} };
