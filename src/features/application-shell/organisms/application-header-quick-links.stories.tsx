import { useState, useSyncExternalStore } from "react";
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, userEvent, waitFor, within } from "storybook/test";
import { createPlanningState } from "@/features/planning/model/internal/planning-state-owner";
import { emptyPlanningShellState } from "@/features/planning/model/planning-shell-state";
import { emptyPlanningHeaderData, readyHeaderSlot } from "@/lib/planning-header-data";
import type { PlanningHeaderData } from "@/lib/types";
import { taskDetailStoryTask } from "@/features/tasks/molecules/task-detail-story-fixtures";
import { ApplicationHeader } from "./application-header";

function retryFixture() {
  const requests: string[] = [];
  let boardReads = 0;
  let finish!: (success: boolean) => void;
  const owner = createPlanningState({ userId: "retry-user", initialData: { ...emptyPlanningShellState, tasks: [taskDetailStoryTask({ id: "retry-card", title: "Karte öffnen" })] }, initialHeaderData: {
    quickLinks: { state: "error", data: [], error: "Kuratierte Links konnten nicht geladen werden." },
    calendarEvents: readyHeaderSlot([]), notifications: readyHeaderSlot({ unreadCount: 0, items: [] }),
  }, adapter: {
    saveTask: async () => ({ task: {} }), readWorkspace: async () => { boardReads++; return null; },
    readHeader: slots => {
      requests.push(slots.join(","));
      return new Promise<PlanningHeaderData>((resolve, reject) => {
        finish = success => success ? resolve({ ...emptyPlanningHeaderData, quickLinks: readyHeaderSlot([{ id: "guide", name: "Recovered guide", category: "knowledge", url: "https://example.com/guide", previewImageUrl: "" }]) }) : reject(new Error("Kuratierte Links konnten nicht geladen werden."));
      });
    },
  } });
  return { ...owner, requests, counts: () => `${requests.join(";")} / ${boardReads} Board`, finish: (success: boolean) => finish(success) };
}
let fixture: ReturnType<typeof retryFixture>;
function RetryComposition() {
  const [state] = useState(() => { fixture = retryFixture(); return fixture; });
  useSyncExternalStore(state.planning.subscribe, state.internal.getSnapshot, state.internal.getSnapshot);
  const [opened, setOpened] = useState(false);
  return <main>
    <ApplicationHeader area={{ title: "Planung" }} lifecycle={{ planningState: state.planning, enabled: true, profiles: [], github: { count: 0, failedCount: 0, installationAvailable: false, connectionState: "unknown", open: false, onOpen: () => {} } }} navigation={{ mobileNavOpen: false, openMobileNav: () => {}, navigate: () => {} }} />
    {state.planning.workspace("planning").tasks.map(task => <button key={task.id} onClick={() => setOpened(true)}>{task.title}</button>)}
    {opened ? <p>Card open</p> : null}
    <label>Kartenentwurf<input defaultValue="Preserved draft" /></label>
    <output aria-label="Retry reads">{state.counts()}</output>
  </main>;
}
const meta = { component: RetryComposition, title: "Application shell/Quick Links recovery", parameters: { layout: "fullscreen" } } satisfies Meta<typeof RetryComposition>;
export default meta;
type Story = StoryObj<typeof meta>;
async function retryWithKeyboard(canvasElement: HTMLElement) {
  const canvas = within(canvasElement), page = within(document.body);
  await userEvent.click(canvas.getByRole("button", { name: "Kuratierte Links" }));
  const dialog = within(page.getByRole("dialog", { name: "Kuratierte Links" }));
  const close = dialog.getByRole("button", { name: "Kuratierte Links schließen" });
  await waitFor(() => expect(close).toHaveFocus());
  await userEvent.tab();
  const retry = dialog.getByRole("button", { name: "Kuratierte Links erneut laden" });
  await expect(retry).toHaveFocus();
  await userEvent.keyboard("{Enter}");
  await expect(close).toHaveFocus();
  return { canvas, dialog, close };
}
export const FailureHasTargetedKeyboardRetryWithoutAutomaticLoop: Story = { play: async ({ canvasElement }) => {
  const canvas = within(canvasElement);
  await userEvent.click(canvas.getByRole("button", { name: "Karte öffnen" }));
  await expect(canvas.getByText("Card open")).toBeVisible();
  await expect(canvas.getByLabelText("Retry reads")).toHaveTextContent(/^\/ 0 Board$/);
  const { dialog, close } = await retryWithKeyboard(canvasElement);
  await expect(canvas.getByLabelText("Retry reads")).toHaveTextContent(/^quickLinks \/ 0 Board$/);
  fixture.finish(false);
  await expect(await dialog.findByRole("button", { name: "Kuratierte Links erneut laden" })).toBeVisible();
  await expect(canvas.getByLabelText("Retry reads")).toHaveTextContent(/^quickLinks \/ 0 Board$/);
  await userEvent.tab(); await userEvent.keyboard("{Enter}");
  fixture.finish(true);
  await expect(await dialog.findByRole("link", { name: /Recovered guide/ })).toBeVisible();
  await expect(close).toHaveFocus();
  await expect(canvas.getByLabelText("Retry reads")).toHaveTextContent(/^quickLinks;quickLinks \/ 0 Board$/);
  await expect(canvas.getByRole("textbox", { name: "Kartenentwurf" })).toHaveValue("Preserved draft");
  await expect(canvas.getByText("Card open")).toBeVisible();
} };
export const CompletionAfterClosingPreservesIndependentInputFocus: Story = { play: async ({ canvasElement }) => {
  const { canvas } = await retryWithKeyboard(canvasElement);
  await userEvent.keyboard("{Escape}");
  await waitFor(() => expect(canvas.getByRole("button", { name: "Kuratierte Links" })).toHaveFocus());
  const input = canvas.getByRole("textbox", { name: "Kartenentwurf" });
  await userEvent.click(input); await userEvent.clear(input); await userEvent.type(input, "Unsaved input");
  fixture.finish(true);
  await waitFor(() => expect(fixture.planning.header().data.quickLinks.state).toBe("ready"));
  await expect(input).toHaveFocus(); await expect(input).toHaveValue("Unsaved input");
  await expect(canvas.getByLabelText("Retry reads")).toHaveTextContent(/^quickLinks \/ 0 Board$/);
} };
