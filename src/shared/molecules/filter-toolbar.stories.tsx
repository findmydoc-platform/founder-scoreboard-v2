import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { useState } from "react";
import { expect, userEvent, within } from "storybook/test";
import { FilterField, FilterToolbar } from "./filter-toolbar";
import { CustomSelect } from "@/shared/atoms/custom-select";

function FilterToolbarStory() {
  const [expanded, setExpanded] = useState(false);
  const [query, setQuery] = useState("");
  return (
    <FilterToolbar
      searchLabel="Planning Items durchsuchen"
      searchPlaceholder="Titel suchen"
      query={query}
      onQueryChange={setQuery}
      expanded={expanded}
      onExpandedChange={setExpanded}
      activeFilters={[]}
      onReset={() => setQuery("")}
      results={[{ id: "items", visibleCount: query ? 1 : 4, totalCount: 4 }]}
      className="w-[min(760px,90vw)]"
    >
      <FilterField label="Status">
        <CustomSelect aria-label="Status" value="Alle" options={[{ value: "Alle", label: "Alle Status" }]} onChange={() => undefined} />
      </FilterField>
    </FilterToolbar>
  );
}

const meta = {
  component: FilterToolbarStory,
  tags: ["layer:molecule", "status:stable"],
  title: "Shared/Molecules/FilterToolbar",
} satisfies Meta<typeof FilterToolbarStory>;

export default meta;
type Story = StoryObj<typeof meta>;

export const SearchesAndOpensFilters: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.type(canvas.getByRole("searchbox", { name: "Planning Items durchsuchen" }), "clinic");
    await expect(canvas.getByText("1")).toBeVisible();
    await userEvent.click(canvas.getByRole("button", { name: "Filter" }));
    await expect(canvas.getByRole("combobox", { name: "Status" })).toBeVisible();
  },
};
