import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, userEvent, within } from "storybook/test";
import { PlanningViewLoadBoundary } from "./planning-view-load-boundary";

function BrokenView(): never {
  throw new Error("Simulated view load failure");
}

function FailedViewStory() {
  const [view, setView] = useState<"table" | "board">("table");
  if (view === "board") return <div>Board bleibt nutzbar.</div>;
  return (
    <PlanningViewLoadBoundary onReturnToBoard={() => setView("board")}>
      <BrokenView />
    </PlanningViewLoadBoundary>
  );
}

const meta = {
  component: FailedViewStory,
  title: "Planning/Molecules/PlanningViewLoadBoundary",
  tags: ["layer:molecule", "status:stable"],
} satisfies Meta<typeof FailedViewStory>;

export default meta;
type Story = StoryObj<typeof meta>;

export const KeepsBoardAvailableAfterViewFailure: Story = {
  render: () => <FailedViewStory />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole("alert")).toHaveTextContent("Diese Ansicht konnte nicht geladen werden.");
    await userEvent.click(canvas.getByRole("button", { name: "Zum Board" }));
    await expect(canvas.getByText("Board bleibt nutzbar.")).toBeInTheDocument();
  },
};
