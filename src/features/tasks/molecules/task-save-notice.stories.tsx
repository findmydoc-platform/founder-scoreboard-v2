import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, fn, userEvent, within } from "storybook/test";
import { taskDetailStoryTask } from "./task-detail-story-fixtures";
import { TaskSaveNotice } from "./task-save-notice";

const task = taskDetailStoryTask({ title: "Serverstand zur Aufgabe", status: "Offen" });
const meta = {
  title: "Features/Tasks/Molecules/TaskSaveNotice",
  component: TaskSaveNotice,
  parameters: { layout: "padded" },
  args: {
    taskTitle: "Aufgabe für die nächste Produktphase",
    saves: [
      { phase: "unconfirmed", submitted: { title: "Mein abgesendeter Titel", status: "In Arbeit" }, checkStatus: "not-checked", serverTask: null },
      { phase: "blocked", submitted: { note: "Diese zusätzliche Eingabe wartet auf Bestätigung." }, checkStatus: "not-checked", serverTask: null },
    ],
    onCheck: fn(async () => ({ outcome: "unconfirmed" as const, readStatus: "current" as const })),
  },
} satisfies Meta<typeof TaskSaveNotice>;
export default meta;
type Story = StoryObj<typeof meta>;

export const ConfirmationPending: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole("status")).toHaveTextContent("Speicherbestätigung ausstehend");
    await userEvent.click(canvas.getByText("Wartende Eingaben anzeigen"));
    await expect(canvas.getByText("Diese Änderung wurde noch nicht gesendet.")).toBeVisible();
    await expect(canvas.getByText("Diese zusätzliche Eingabe wartet auf Bestätigung.")).toBeVisible();
    await userEvent.click(canvas.getByRole("button", { name: "Speicherstand prüfen" }));
    await expect(args.onCheck).toHaveBeenCalledOnce();
    await expect(canvas.queryByRole("button", { name: /erneut speichern/i })).not.toBeInTheDocument();
  },
};
export const Checking: Story = {
  args: { saves: meta.args.saves.map(save => ({ ...save, checkStatus: "checking" })) },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByRole("button", { name: "Speicherstand wird geprüft …" })).toBeDisabled();
  },
};
export const Checked: Story = {
  args: { saves: meta.args.saves.map(save => ({ ...save, checkStatus: "checked", serverTask: task })) },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByText("Aktuellen Serverstand anzeigen"));
    await expect(canvas.getByText("Serverstand zur Aufgabe", { selector: "dd" })).toBeVisible();
    await expect(canvas.getByText(/Speicherung bleibt unbestätigt/)).toBeVisible();
  },
};
export const Unavailable: Story = {
  args: { saves: meta.args.saves.map(save => ({ ...save, checkStatus: "unavailable" })) },
};
export const Forbidden: Story = {
  args: { taskTitle: "Aufgabe", saves: meta.args.saves.map(save => ({ ...save, submitted: null, checkStatus: "forbidden" })) },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText(/Kein Zugriff auf die Aufgabe/)).toBeVisible();
    await expect(canvas.queryByText("Abgesendete Eingaben anzeigen")).not.toBeInTheDocument();
  },
};
