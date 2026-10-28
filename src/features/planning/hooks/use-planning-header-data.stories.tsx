import { useState, useSyncExternalStore } from "react";
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, userEvent, waitFor, within } from "storybook/test";
import { NotificationInbox } from "@/features/notifications/organisms/notification-inbox";
import { emptyPlanningShellState } from "../model/planning-shell-state";
import { emptyPlanningHeaderData, readyHeaderSlot } from "@/lib/planning-header-data";
import { createPlanningState } from "../model/internal/planning-state-owner";
import { usePlanningHeaderData } from "./use-planning-header-data";
import type { PlanningHeaderData } from "@/lib/types";

function BackgroundHeaderStory() {
  const [signedIn, setSignedIn] = useState(true);
  const [network] = useState(() => {
    const pending: { resolve: (data: PlanningHeaderData) => void; reject: (error: Error) => void }[] = [];
    return { pending, read: () => new Promise<PlanningHeaderData>((resolve, reject) => { pending.push({ resolve, reject }); }) };
  });
  const [owner] = useState(() => createPlanningState({ userId: "header-story", initialData: emptyPlanningShellState, initialHeaderData: { ...emptyPlanningHeaderData, quickLinks: readyHeaderSlot([]), calendarEvents: readyHeaderSlot([]) }, adapter: { saveTask: async () => ({ task: {} }), readWorkspace: async () => null, readHeader: network.read } }));
  useSyncExternalStore(owner.planning.subscribe, owner.internal.getSnapshot, owner.internal.getSnapshot);
  const headerData = usePlanningHeaderData({ planningState: owner.planning, enabled: signedIn });
  return <main><h1>Planning Board</h1><p>Unread: {headerData.notifications.data.unreadCount}</p><p>Read: {owner.planning.header().slots.notifications.readStatus}</p>
    <button onClick={() => document.dispatchEvent(new Event("visibilitychange"))}>Return to tab</button>
    <button onClick={() => network.pending.at(-1)?.resolve({ ...emptyPlanningHeaderData, notifications: readyHeaderSlot({ unreadCount: network.pending.length, items: [] }) })}>Complete request</button>
    <button onClick={() => network.pending.at(-1)?.reject(new Error("Headerdaten konnten nicht geladen werden."))}>Fail request</button>
    <button onClick={() => { owner.internal.endSession(); setSignedIn(false); }}>Sign out</button>
    {signedIn ? <NotificationInbox notifications={headerData.notifications} open onToggle={() => {}} /> : <p>Signed out</p>}
  </main>;
}
const meta = { component: BackgroundHeaderStory, title: "Planning/Hooks/BackgroundHeader" } satisfies Meta<typeof BackgroundHeaderStory>;
export default meta;
type Story = StoryObj<typeof meta>;
export const InitialFetchAndVisibilityRefresh: Story = { play: async ({ canvasElement }) => {
  const canvas = within(canvasElement);
  await expect(canvas.getByRole("button", { name: "Benachrichtigungen werden geladen" })).toHaveAttribute("aria-busy", "true");
  await userEvent.click(canvas.getByRole("button", { name: "Complete request" }));
  await waitFor(() => expect(canvas.getByText("Unread: 1")).toBeVisible());
  await userEvent.click(canvas.getByRole("button", { name: "Return to tab" }));
  await userEvent.click(canvas.getByRole("button", { name: "Complete request" }));
  await waitFor(() => expect(canvas.getByText("Unread: 2")).toBeVisible());
} };
export const InitialFailureRecoversOnReturn: Story = { play: async ({ canvasElement }) => {
  const canvas = within(canvasElement);
  await userEvent.click(canvas.getByRole("button", { name: "Fail request" }));
  await waitFor(() => expect(canvas.getByText("Headerdaten konnten nicht geladen werden.")).toBeVisible());
  await userEvent.click(canvas.getByRole("button", { name: "Return to tab" }));
  await userEvent.click(canvas.getByRole("button", { name: "Complete request" }));
  await waitFor(() => expect(canvas.getByText("Unread: 2")).toBeVisible());
} };
export const SignOutDiscardsResponse: Story = { play: async ({ canvasElement }) => {
  const canvas = within(canvasElement);
  await userEvent.click(canvas.getByRole("button", { name: "Sign out" }));
  await userEvent.click(canvas.getByRole("button", { name: "Complete request" }));
  await expect(canvas.getByText("Signed out")).toBeVisible();
  await expect(canvas.getByText("Unread: 0")).toBeVisible();
} };
