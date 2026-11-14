import { useState, useSyncExternalStore } from "react";
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, fireEvent, waitFor, within } from "storybook/test";
import { createPlanningState } from "../model/internal/planning-state-owner";
import { planningWorkspaceHydration } from "../model/planning-workspace-hydration";
import { emptyPlanningShellState } from "../model/planning-shell-state";
import { usePlanningRemoteChanges } from "./use-planning-remote-changes";

// Time and browser visibility are controlled external boundaries. The real hook and owner run unchanged.
let clock: { advance: (milliseconds: number) => void; polling: () => number };
function RemoteChangesStory() {
  const [enabled, setEnabled] = useState(true);
  const [versions, setVersions] = useState(0);
  const [content, setContent] = useState(0);
  const [owner] = useState(() => {
    const session = { userId: "visible-reader", revision: "session", expiresAt: Date.now() / 1000 + 3600, user: { id: "visible-reader" } };
    const read = planningWorkspaceHydration("planning", { revision: "r1", scopeRevision: "source-1", project: emptyPlanningShellState.project, items: [], people: [], sprints: [], relationships: [], preferences: [], coverage: { items: "complete" } }, session, { userId: session.userId, deadline: session.expiresAt * 1000 });
    return createPlanningState({ userId: session.userId, initialData: emptyPlanningShellState, initialSession: session, initialWorkspaceRead: read, adapter: {
      saveTask: async () => ({ task: {} }),
      readPlanningSourceVersion: async () => { setVersions(value => value + 1); return "source-1"; },
      readWorkspace: async () => { setContent(value => value + 1); return null; },
    } });
  });
  useSyncExternalStore(owner.planning.subscribe, owner.internal.getSnapshot, owner.internal.getSnapshot);
  usePlanningRemoteChanges({ planningState: owner.planning, enabled, refreshCurrentWorkspaceModel: async () => { await owner.planning.refreshWorkspace("planning"); } });
  const visibility = (value: "hidden" | "visible") => {
    Object.defineProperty(document, "visibilityState", { configurable: true, value });
    document.dispatchEvent(new Event("visibilitychange"));
  };
  return <main>
    <output aria-label="Version checks">{versions}</output><output aria-label="Content reads">{content}</output>
    <button onClick={() => clock.advance(59_000)}>Advance 59 seconds</button>
    <button onClick={() => clock.advance(1_000)}>Advance one second</button>
    <button onClick={() => clock.advance(60_000)}>Advance one minute</button>
    <button onClick={() => visibility("hidden")}>Hide tab</button><button onClick={() => visibility("visible")}>Show tab</button>
    <button onClick={() => window.dispatchEvent(new Event("online"))}>Reconnect</button>
    <button onClick={() => setEnabled(false)}>Leave Planning</button><button onClick={() => setEnabled(true)}>Return to Planning</button>
  </main>;
}
const meta = {
  title: "Planning/Hooks/Remote changes", component: RemoteChangesStory,
  beforeEach: () => {
    const originalSet = window.setInterval, originalClear = window.clearInterval;
    const visibility = Object.getOwnPropertyDescriptor(document, "visibilityState");
    const intervals = new Map<number, { callback: () => void; next: number }>();
    let now = 0, sequence = 1_000_000;
    window.setInterval = ((callback: () => void, delay: number, ...args: unknown[]) => {
      if (delay !== 60_000) return originalSet(callback, delay, ...args);
      const id = ++sequence;
      intervals.set(id, { callback, next: now + delay });
      return id;
    }) as typeof window.setInterval;
    window.clearInterval = ((id: number) => { if (!intervals.delete(id)) originalClear(id); }) as typeof window.clearInterval;
    clock = { polling: () => intervals.size, advance: milliseconds => {
      now += milliseconds;
      for (const interval of intervals.values()) if (interval.next <= now) { interval.next = now + 60_000; interval.callback(); }
    } };
    return () => {
      window.setInterval = originalSet; window.clearInterval = originalClear;
      if (visibility) Object.defineProperty(document, "visibilityState", visibility);
      else Reflect.deleteProperty(document, "visibilityState");
    };
  },
} satisfies Meta<typeof RemoteChangesStory>;
export default meta;
type Story = StoryObj<typeof meta>;
export const VisibleMinuteReturnAndConnectivity: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const checks = (expected: string) => waitFor(() => expect(canvas.getByLabelText("Version checks")).toHaveTextContent(expected));
    await checks("1");
    fireEvent.click(canvas.getByRole("button", { name: "Advance 59 seconds" })); await checks("1");
    fireEvent.click(canvas.getByRole("button", { name: "Advance one second" })); await checks("2");
    fireEvent.click(canvas.getByRole("button", { name: "Hide tab" }));
    await expect(clock.polling()).toBe(0);
    fireEvent.click(canvas.getByRole("button", { name: "Advance one minute" }));
    fireEvent.click(canvas.getByRole("button", { name: "Reconnect" })); await checks("2");
    fireEvent.click(canvas.getByRole("button", { name: "Show tab" })); await checks("3");
    fireEvent.click(canvas.getByRole("button", { name: "Reconnect" })); await checks("4");
    fireEvent.click(canvas.getByRole("button", { name: "Leave Planning" }));
    await waitFor(() => expect(clock.polling()).toBe(0));
    fireEvent.click(canvas.getByRole("button", { name: "Advance one minute" })); await checks("4");
    fireEvent.click(canvas.getByRole("button", { name: "Return to Planning" })); await checks("5");
    await expect(clock.polling()).toBe(1);
    await expect(canvas.getByLabelText("Content reads")).toHaveTextContent("0");
  },
};
