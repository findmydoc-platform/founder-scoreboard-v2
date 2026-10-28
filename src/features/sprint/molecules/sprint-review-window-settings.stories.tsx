import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { useState, useSyncExternalStore } from "react";
import { expect, userEvent, within } from "storybook/test";
import { createPlanningState } from "@/features/planning/model/internal/planning-state-owner";
import { emptyPlanningShellState } from "@/features/planning/model/planning-shell-state";
import { SprintReviewWindowSettings } from "./sprint-review-window-settings";
function ReviewWindowStory({ conflict = false }: { conflict?: boolean }) {
  const [writes, setWrites] = useState(0);
  const [reads, setReads] = useState(0);
  const [owner] = useState(() => createPlanningState({ userId: "story", initialWorkspace: "sprint", initialData: emptyPlanningShellState, adapter: {
    saveTask: async () => ({ task: {} }),
    readWorkspace: async () => { setReads(count => count + 1); return { data: { ...emptyPlanningShellState, project: { ...emptyPlanningShellState.project, reviewObjectionWindowHours: 72 } } }; },
    saveReviewWindow: async (expected, hours) => { setWrites(count => count + 1); if (!conflict) throw new Error("Antwort verloren"); if (expected === 48) throw Object.assign(new Error("Parallel geändert"), { status: 409, code: "review_window_conflict" }); return { project: { id: emptyPlanningShellState.project.id, reviewObjectionWindowHours: hours }, sprints: [] }; },
  } }));
  const data = useSyncExternalStore(owner.planning.subscribe, owner.internal.getSnapshot, owner.internal.getSnapshot);
  return <main className="p-4"><output aria-label="Window writes">{writes}</output><output aria-label="Window reads">{reads}</output><SprintReviewWindowSettings disabled={false} pending={false} reviewObjectionWindowHours={data.project.reviewObjectionWindowHours} planningState={owner.planning} /></main>;
}
const meta = { component: ReviewWindowStory, title: "Features/Sprint/ReviewWindowSettings" } satisfies Meta<typeof ReviewWindowStory>;
export default meta;
type Story = StoryObj<typeof meta>;
export const KeepsUnknownInputAndChecksWithoutReplay: Story = { play: async ({ canvasElement }) => {
  const canvas = within(canvasElement);
  await userEvent.clear(canvas.getByRole("spinbutton", { name: "Stunden" }));
  await userEvent.type(canvas.getByRole("spinbutton", { name: "Stunden" }), "96");
  await userEvent.click(canvas.getByRole("button", { name: "Frist speichern" }));
  await expect(await canvas.findByText("Speicherung der Frist unklar")).toBeVisible();
  await expect(canvas.getByRole("spinbutton")).toHaveValue(96);
  await expect(canvas.getByRole("button", { name: "Frist speichern" })).toBeDisabled();
  await userEvent.click(canvas.getByRole("button", { name: "Aktuellen Stand prüfen" }));
  await expect(canvas.getByLabelText("Window writes")).toHaveTextContent("1");
  await expect(canvas.getByLabelText("Window reads")).toHaveTextContent("1");
} };
export const ComparesConflictAndResavesConsciously: Story = { args: { conflict: true }, play: async ({ canvasElement }) => {
  const canvas = within(canvasElement);
  await userEvent.clear(canvas.getByRole("spinbutton", { name: "Stunden" }));
  await userEvent.type(canvas.getByRole("spinbutton", { name: "Stunden" }), "96");
  await userEvent.click(canvas.getByRole("button", { name: "Frist speichern" }));
  await expect(await canvas.findByText("Frist wurde zwischenzeitlich geändert")).toBeVisible();
  await expect(canvas.getByRole("spinbutton")).toHaveValue(96);
  await userEvent.click(canvas.getByRole("button", { name: "Änderungen vergleichen" }));
  await expect(await canvas.findByText("Aktueller Stand: 72 Stunden")).toBeVisible();
  await userEvent.click(canvas.getByRole("button", { name: "Erneut speichern" }));
  await expect(await canvas.findByText("Frist gespeichert.")).toBeVisible();
  await expect(canvas.getByLabelText("Window writes")).toHaveTextContent("2");
} };
