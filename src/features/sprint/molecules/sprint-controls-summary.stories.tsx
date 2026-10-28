import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { useState, useSyncExternalStore } from "react";
import { expect, userEvent, within } from "storybook/test";
import { createPlanningState } from "@/features/planning/model/internal/planning-state-owner";
import { emptyPlanningShellState } from "@/features/planning/model/planning-shell-state";
import { SprintControlsSummary } from "./sprint-controls-summary";
const sprint = { id: "sprint", name: "Sprint shown", status: "planning" as const, startDate: "2026-10-01", endDate: "2026-10-14", reviewDueAt: "", scoreLocked: false, updatedAt: "opaque/shown" };
function SprintStory({ conflict = false }: { conflict?: boolean }) {
  const [writes, setWrites] = useState(0);
  const [reads, setReads] = useState(0);
  const [owner] = useState(() => createPlanningState({ userId: "story", initialWorkspace: "sprint", initialData: { ...emptyPlanningShellState, sprints: [sprint] }, adapter: {
    readWorkspace: async () => { setReads(count => count + 1); return { data: { ...emptyPlanningShellState, sprints: [{ ...sprint, status: "review" as const, updatedAt: "opaque/foreign" }] } }; },
    saveTask: async () => ({ task: {} }),
    saveSprint: async (basis, patch) => { setWrites(count => count + 1); if (conflict && basis.updatedAt === sprint.updatedAt) throw Object.assign(new Error("Parallel geändert"), { status: 409, code: "sprint_revision_conflict" }); if (!conflict) throw new Error("Antwort verloren"); return { sprint: { ...basis, ...patch, updatedAt: "opaque/saved" } }; },
  } }));
  const data = useSyncExternalStore(owner.planning.subscribe, owner.internal.getSnapshot, owner.internal.getSnapshot);
  return <main className="p-4"><output aria-label="Sprint writes">{writes}</output><output aria-label="Sprint reads">{reads}</output><SprintControlsSummary data={data} sprint={data.sprints[0]} sprintTasks={[]} reviewTasksCount={0} finalScores={0} openScores={0} unassignedTasksCount={0} sprintHasTasks={false} sprintIsCurrent={false} sprintControlsDisabled={false} canFinalizeSprintScore={false} sprintPlanningOptions={{firstSprintNumber:1,anchorStartDate:"2099-01-01",rhythmWeeks:2,horizonWeeks:1,targetSprintNumber:2}} openObjectionsCount={0} onSelectedSprintChange={() => {}} planningState={owner.planning} /></main>;
}
const meta = { component: SprintStory, title: "Features/Sprint/SprintControlsSummary" } satisfies Meta<typeof SprintStory>;
export default meta;
type Story = StoryObj<typeof meta>;
export const KeepsUnconfirmedStatusWithoutReplay: Story = { play: async ({ canvasElement }) => {
  const canvas = within(canvasElement);
  await userEvent.click(canvas.getAllByRole("combobox")[1]);
  await userEvent.click(within(document.body).getByRole("option", { name: "Aktiv" }));
  await expect(await canvas.findByText("Speicherung der Sprint-Änderung unklar")).toBeVisible();
  await expect(canvas.getAllByRole("combobox")[1]).toBeDisabled();
  await expect(canvas.getByText("Eingabe: Status: Aktiv")).toBeVisible();
  await userEvent.click(canvas.getByRole("button", { name: "Aktuellen Stand prüfen" }));
  await expect(canvas.getByLabelText("Sprint writes")).toHaveTextContent("1");
  await expect(canvas.getByLabelText("Sprint reads")).toHaveTextContent("1");
} };
export const KeepsConflictAndResavesConsciously: Story = { args: { conflict: true }, play: async ({ canvasElement }) => {
  const canvas = within(canvasElement);
  await userEvent.click(canvas.getAllByRole("combobox")[1]);
  await userEvent.click(within(document.body).getByRole("option", { name: "Aktiv" }));
  await expect(await canvas.findByText("Sprint wurde zwischenzeitlich geändert")).toBeVisible();
  await userEvent.click(canvas.getByRole("button", { name: "Änderungen vergleichen" }));
  await expect(await canvas.findByText("Aktueller Status: Review")).toBeVisible();
  await userEvent.click(canvas.getByRole("button", { name: "Erneut speichern" }));
  await expect(canvas.getByLabelText("Sprint writes")).toHaveTextContent("2");
  await expect(canvas.getAllByRole("combobox")[1]).toHaveTextContent("Aktiv");
} };
