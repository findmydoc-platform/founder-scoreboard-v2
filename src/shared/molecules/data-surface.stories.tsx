import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { useState } from "react";
import { expect, userEvent, within } from "storybook/test";
import {
  DataCell,
  DataColumnHeader,
  DataOverflow,
  DataRow,
  DataSurface,
  DataTable,
  DataTableHead,
  type SortDirection,
} from "./data-surface";

function DataSurfaceStory() {
  const [direction, setDirection] = useState<SortDirection>("asc");
  return (
    <DataSurface title="Planning Items" description="Aktueller Ausschnitt" className="w-[min(720px,90vw)]">
      <DataOverflow>
        <DataTable minWidth={480}>
          <DataTableHead>
            <DataRow>
              <DataColumnHeader label="Titel" direction={direction} onSort={() => setDirection((current) => current === "asc" ? "desc" : "asc")} />
              <DataColumnHeader label="Status" />
            </DataRow>
          </DataTableHead>
          <tbody>
            <DataRow>
              <DataCell>Clinic onboarding</DataCell>
              <DataCell>In Arbeit</DataCell>
            </DataRow>
          </tbody>
        </DataTable>
      </DataOverflow>
    </DataSurface>
  );
}

const meta = {
  component: DataSurfaceStory,
  tags: ["layer:molecule", "status:stable"],
  title: "Shared/Molecules/DataSurface",
} satisfies Meta<typeof DataSurfaceStory>;

export default meta;
type Story = StoryObj<typeof meta>;

export const SortsAColumn: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: "Titel sortieren" }));
    await expect(canvas.getByRole("columnheader", { name: /Titel/ })).toHaveAttribute("aria-sort", "descending");
  },
};
