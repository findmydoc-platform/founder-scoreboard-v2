import { useEffect, useState, useSyncExternalStore } from "react";
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, userEvent, within } from "storybook/test";
import { usePlanningStateOwner } from "./use-planning-state-owner";
import { usePlanningRemoteChanges } from "./use-planning-remote-changes";
import { usePlanningHeaderData } from "./use-planning-header-data";
import { PlanningStateLifetimeContext } from "../model/internal/planning-state-lifetime-context";
import { createBrowserPlanningLifetime } from "../model/internal/browser-planning-lifetime";
import { planningWorkspaceHydration } from "../model/planning-workspace-hydration";
import { emptyPlanningShellState } from "../model/planning-shell-state";
import { emptyPlanningHeaderData } from "@/lib/planning-header-data";
import { taskDetailStoryTask } from "@/features/tasks/molecules/task-detail-story-fixtures";
import type { BrowserApiClient, BrowserApiJsonResult } from "@/lib/browser-api-client";

const task = taskDetailStoryTask({ id: "reused-entry-task", title: "Available Planning card" });
const data = { ...emptyPlanningShellState, tasks: [task] };
function entryFixture() {
  const session = { userId: "entry-user", revision: "entry-session", expiresAt: Math.floor(Date.now() / 1000) + 3600, user: { id: "entry-user" } };
  const model = { revision: "content-1", scopeRevision: "source-1", project: data.project, items: [task], people: [], sprints: [], relationships: [], preferences: [], coverage: { items: "complete" as const } };
  const hydration = planningWorkspaceHydration("planning", model, session);
  const listeners = new Set<() => void>();
  let contentReads = 0, versionReads = 0;
  let resolveVersion: ((value: BrowserApiJsonResult<unknown>) => void) | undefined;
  let resolveLinks: ((value: BrowserApiJsonResult<unknown>) => void) | undefined;
  const client: BrowserApiClient = {
    requestJson: <T,>(input: Parameters<BrowserApiClient["requestJson"]>[0]) => {
      const url = String(input);
      if (url.includes("planning-source-version")) {
        versionReads++; listeners.forEach(listener => listener());
        return new Promise<BrowserApiJsonResult<T>>(resolve => { resolveVersion = result => resolve(result as BrowserApiJsonResult<T>); });
      }
      if (url.includes("planning-board-data")) {
        contentReads++; listeners.forEach(listener => listener());
        return Promise.resolve({ response: new Response(null), body: { model } as T });
      }
      if (url.includes("planning-header-data")) {
        if (url.includes("quickLinks")) return new Promise<BrowserApiJsonResult<T>>(resolve => { resolveLinks = result => resolve(result as BrowserApiJsonResult<T>); });
        return Promise.resolve({ response: new Response(null), body: { headerData: { ...emptyPlanningHeaderData,
          ...(url.includes("calendarEvents") ? { calendarEvents: { state: "ready", data: [] } } : {}),
          ...(url.includes("notifications") ? { notifications: { state: "ready", data: { unreadCount: 0, items: [] } } } : {}),
        } } as T });
      }
      throw new Error("Unexpected entry operation");
    },
    requestForm: async () => { throw new Error("Unexpected form"); },
    requestBlob: async () => { throw new Error("Unexpected blob"); },
  };
  return { session, hydration, client, subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; }, counts: () => `${contentReads} content / ${versionReads} version`,
    unchanged: () => resolveVersion?.({ response: new Response(null), body: { version: "source-1" } }),
    failVersion: () => resolveVersion?.({ response: new Response(null, { status: 503 }), body: {} }),
    failLinks: () => resolveLinks?.({ response: new Response(null, { status: 503 }), body: {} }),
  };
}
function EntryPage({ fixture }: { fixture: ReturnType<typeof entryFixture> }) {
  const owner = usePlanningStateOwner({ initialData: data, initialHeaderData: emptyPlanningHeaderData, initialUserId: fixture.session.userId, initialCurrentProfile: null, initialWorkspace: "planning", initialWorkspaceRead: fixture.hydration });
  useEffect(() => { owner.configure(fixture.client, "planning", null); }, [owner, fixture]);
  const remote = usePlanningRemoteChanges({ planningState: owner.planningState, enabled: true, refreshCurrentWorkspaceModel: async () => { await owner.planningState.refreshWorkspace("planning"); }, scopeRevision: owner.planningState.board().scopeRevision });
  usePlanningHeaderData({ planningState: owner.planningState, enabled: true });
  const counts = useSyncExternalStore(fixture.subscribe, fixture.counts, fixture.counts);
  return <section aria-label="Planning">
    <a href="#card">{owner.data.tasks[0]?.title}</a>
    <label>Open card draft<input defaultValue="Keep this input" /></label>
    <output aria-label="Read requests">{counts}</output>
    <p>Calendar: {owner.planningState.header().slots.calendarEvents.readStatus}</p>
    <p>Quick Links: {owner.planningState.header().slots.quickLinks.readStatus}</p>
    <p role="status">{remote.planningRemoteChangesUnverified ? "Aktualität ungeprüft" : "Planning remains usable"}</p>
  </section>;
}
function EntryStory() {
  const [fixture] = useState(entryFixture);
  const [lifetime] = useState(() => createBrowserPlanningLifetime({ current: async () => fixture.session, subscribe: () => () => {} }));
  const [shown, setShown] = useState(true);
  useEffect(() => lifetime.connect(), [lifetime]);
  return <PlanningStateLifetimeContext.Provider value={lifetime}><main>
    <button onClick={() => setShown(false)}>Leave Planning</button>
    <button onClick={() => setShown(true)}>Return to Planning</button>
    <button onClick={fixture.unchanged}>Observe unchanged source</button>
    <button onClick={fixture.failVersion}>Fail source observation</button>
    <button onClick={fixture.failLinks}>Fail Quick Links</button>
    {shown ? <EntryPage fixture={fixture} /> : <p>Independent workspace</p>}
  </main></PlanningStateLifetimeContext.Provider>;
}
const meta = { component: EntryStory, title: "Planning/Entry/AcceptedHydration" } satisfies Meta<typeof EntryStory>;
export default meta;
type Story = StoryObj<typeof meta>;
export const ReuseOnMountAndReturnWithUnavailableHeader: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await canvas.findByRole("link", { name: "Available Planning card" })).toBeVisible();
    await expect(await canvas.findByText("Calendar: current")).toBeVisible();
    await expect(canvas.getByText("Quick Links: loading")).toBeVisible();
    await expect(canvas.getByLabelText("Read requests")).toHaveTextContent("0 content / 1 version");
    const input = canvas.getByRole("textbox", { name: "Open card draft" });
    await userEvent.clear(input);
    await userEvent.type(input, "Unsaved text");
    await userEvent.click(canvas.getByRole("button", { name: "Observe unchanged source" }));
    await userEvent.click(canvas.getByRole("button", { name: "Fail Quick Links" }));
    await expect(await canvas.findByText("Quick Links: unavailable")).toBeVisible();
    await expect(input).toHaveValue("Unsaved text");
    await expect(canvas.getByRole("link", { name: "Available Planning card" })).toBeVisible();
    await userEvent.click(canvas.getByRole("button", { name: "Leave Planning" }));
    await userEvent.click(canvas.getByRole("button", { name: "Return to Planning" }));
    await expect(await canvas.findByLabelText("Read requests")).toHaveTextContent("0 content / 2 version");
    await userEvent.click(canvas.getByRole("button", { name: "Observe unchanged source" }));
    await expect(canvas.getByRole("link", { name: "Available Planning card" })).toBeVisible();
  },
};
export const FailedObservationKeepsCardAndDraft: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const input = await canvas.findByRole("textbox", { name: "Open card draft" });
    await userEvent.clear(input);
    await userEvent.type(input, "Unsaved text");
    await userEvent.click(canvas.getByRole("button", { name: "Fail source observation" }));
    await expect(await canvas.findByText("Aktualität ungeprüft")).toBeVisible();
    await expect(input).toHaveValue("Unsaved text");
    await expect(canvas.getByRole("link", { name: "Available Planning card" })).toBeVisible();
    await expect(canvas.getByLabelText("Read requests")).toHaveTextContent("0 content / 1 version");
    await userEvent.click(canvas.getByRole("button", { name: "Fail Quick Links" }));
  },
};
