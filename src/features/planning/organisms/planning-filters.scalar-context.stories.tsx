import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { useState } from "react";
import { expect, userEvent, within } from "storybook/test";
import { PlanningFilters } from "./planning-filters";
import { DEFAULT_PLANNING_FILTERS } from "../model/planning-board-query";
import { taskDetailStoryTask } from "@/features/tasks/molecules/task-detail-story-fixtures";

const selected = { id: "filter-context-1026", title: "Selected off-page parent" };
const completeOptions = Array.from({ length: 1027 }, (_, index) => index === 1026
  ? selected : { id: `filter-context-${index}`, title: `Scalar parent ${index}` });
const displayedCard = taskDetailStoryTask({ id: "unrelated-filter-card", title: "Unrelated displayed card" });

function ScalarFilterContextFlow({ kind = "initiative" }: { kind?: "initiative" | "epic" }) {
  const [options, setOptions] = useState(completeOptions);
  const [cardsReplaced, setCardsReplaced] = useState(false);
  const [filters, setFilters] = useState({ ...DEFAULT_PLANNING_FILTERS, initiativeId: selected.id });
  const [parent, setParent] = useState(selected.id);
  return <>
    <output aria-label="Selected scalar ID">{kind === "epic" ? parent : filters.initiativeId}</output>
    <button type="button" onClick={() => setCardsReplaced(true)}>Replace displayed cards</button>
    <button type="button" onClick={() => setOptions(kind === "epic" ? [] : [completeOptions[0]])}>Replace complete scalar source</button>
    <PlanningFilters
      filters={filters} planningLevel={kind === "epic" ? "initiative" : "deliverable"}
      planningParentFilterId={parent} profiles={[]} initiatives={kind === "initiative" ? options : []}
      epics={kind === "epic" ? options : undefined} sprints={[]}
      tasks={cardsReplaced ? [] : [displayedCard]} workstreams={[]} quickFilters={[]}
      expanded showPlanningLevel={kind === "epic"} visibleCount={cardsReplaced ? 0 : 1} totalCount={cardsReplaced ? 0 : 1}
      onExpandedChange={() => undefined} onChange={setFilters} onPlanningLevelChange={() => undefined}
      onPlanningParentFilterChange={setParent}
    />
  </>;
}

const meta = { title: "Planning/Scalar filter context", component: ScalarFilterContextFlow,
  parameters: { layout: "fullscreen" } } satisfies Meta<typeof ScalarFilterContextFlow>;
export default meta;
type Story = StoryObj<typeof meta>;

export const InitiativeScalarInventorySurvivesDisplayedDatasetReplacement: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement), screen = within(document.body);
    const filter = canvas.getByRole("combobox", { name: "Nach Initiative filtern" });
    await expect(filter).toHaveTextContent(selected.title);
    await userEvent.click(canvas.getByRole("button", { name: "Replace displayed cards" }));
    await expect(filter).toHaveTextContent(selected.title);
    await expect(canvas.getByLabelText("Selected scalar ID")).toHaveTextContent(selected.id);
    await userEvent.click(filter);
    await expect(await screen.findByRole("option", { name: completeOptions[0].title })).toBeVisible();
    await userEvent.click(screen.getByRole("option", { name: selected.title }));
    await expect(filter).toHaveTextContent(selected.title);
    await expect(canvas.getByLabelText("Selected scalar ID")).toHaveTextContent(selected.id);
  },
};

export const InitiativeMissingFromCurrentCompleteSourceKeepsExplicitIdentity: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole("combobox", { name: "Nach Initiative filtern" })).toHaveTextContent(selected.title);
    await userEvent.click(canvas.getByRole("button", { name: "Replace complete scalar source" }));
    await expect(canvas.getByLabelText("Selected scalar ID")).toHaveTextContent(selected.id);
    await expect(canvas.queryByText(selected.title)).not.toBeInTheDocument();
    await expect((await canvas.findAllByText(/nicht verfügbar/i)).length).toBeGreaterThan(0);
  },
};

export const EpicMissingFromCurrentCompleteSourceKeepsExplicitIdentity: Story = {
  args: { kind: "epic" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole("combobox", { name: "Nach Parent-Epic filtern" })).toHaveTextContent(selected.title);
    await userEvent.click(canvas.getByRole("button", { name: "Replace complete scalar source" }));
    await expect(canvas.getByLabelText("Selected scalar ID")).toHaveTextContent(selected.id);
    await expect(canvas.queryByText(selected.title)).not.toBeInTheDocument();
    await expect((await canvas.findAllByText(/nicht verfügbar/i)).length).toBeGreaterThan(0);
  },
};
