import { useState, useSyncExternalStore } from "react";
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, userEvent, waitFor, within } from "storybook/test";
import { PlatformReleaseSidebarCard } from "./platform-release-sidebar-card";
import { PlatformReleaseDetail } from "./platform-release-detail";
import { platformReleaseSeed } from "../model/platform-release-seed";
import { createPlanningState } from "@/features/planning/model/internal/planning-state-owner";
import { emptyPlanningShellState } from "@/features/planning/model/planning-shell-state";
import { PlanningBusinessStateContext } from "@/features/planning/hooks/use-planning-business-state";

function SharedReleaseStory() {
  const [network] = useState(() => {
    let finish!: () => void;
    const state = { reads: 0, writes: 0, seenAt: "", read: async () => { state.reads++; return [{ ...platformReleaseSeed[1], notificationId: 1, seenAt: state.seenAt }]; }, mark: () => { state.writes++; return new Promise<void>(resolve => { finish = () => { state.seenAt = "2026-10-28T01:00:00Z"; resolve(); }; }); }, confirm: () => finish() };
    return state;
  });
  const [owner] = useState(() => createPlanningState({ userId: "release-story", initialData: emptyPlanningShellState, adapter: { saveTask: async () => ({ task: {} }), readWorkspace: async () => null, readPlatformReleases: network.read, markPlatformReleaseSeen: network.mark } }));
  useSyncExternalStore(owner.planning.subscribe, owner.internal.getSnapshot, owner.internal.getSnapshot);
  return <PlanningBusinessStateContext.Provider value={owner.planning}><main>
    <p>Reads: {network.reads}</p><p>Writes: {network.writes}</p><button onClick={network.confirm}>Confirm seen</button>
    <aside aria-label="Desktop release"><PlatformReleaseSidebarCard compact /></aside><aside aria-label="Mobile release"><PlatformReleaseSidebarCard mobile /></aside>
    <PlatformReleaseDetail release={{ ...platformReleaseSeed[1], notificationId: 1, seenAt: "" }} />
  </main></PlanningBusinessStateContext.Provider>;
}
const meta = { component: SharedReleaseStory, title: "Platform Releases/Shared sidebar state" } satisfies Meta<typeof SharedReleaseStory>;
export default meta;
type Story = StoryObj<typeof meta>;
export const DetailAcknowledgementUpdatesBothSidebarConsumers: Story = { play: async ({ canvasElement }) => {
  const canvas = within(canvasElement);
  await userEvent.click(canvas.getByRole("button", { name: "Confirm seen" }));
  await waitFor(() => expect(canvas.getByText("Reads: 2")).toBeVisible());
  await expect(canvas.getByText("Writes: 1")).toBeVisible();
  await expect(within(canvas.getByLabelText("Desktop release")).getByRole("link")).toBeVisible();
  await expect(within(canvas.getByLabelText("Mobile release")).getByRole("link")).toBeVisible();
  await expect(canvas.queryAllByLabelText("Neu")).toHaveLength(0);
} };
