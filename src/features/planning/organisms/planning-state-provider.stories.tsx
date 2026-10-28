import { useEffect, useState } from "react";
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, userEvent, waitFor, within } from "storybook/test";
import { PlanningStateProvider } from "./planning-state-provider";
import { PlanningStateLifetimeContext } from "../model/internal/planning-state-lifetime-context";
import { createBrowserPlanningLifetime } from "../model/internal/browser-planning-lifetime";
import type { BrowserSessionSnapshot } from "@/lib/credentials/browser";
import { usePlanningStateOwner } from "../hooks/use-planning-state-owner";
import { emptyPlanningShellState } from "../model/planning-shell-state";
import { emptyPlanningHeaderData } from "@/lib/planning-header-data";
import { taskDetailStoryTask } from "@/features/tasks/molecules/task-detail-story-fixtures";
import type { BrowserApiClient, BrowserApiJsonResult } from "@/lib/browser-api-client";
import { getProtectedPlanningShellStateCache } from "@/features/planning/model/internal/planning-protected-cache";

const task = taskDetailStoryTask({ id: "navigation-task", title: "Before navigation", updatedAt: "r1" });
const initial = { ...emptyPlanningShellState, tasks: [task] };
function networkFixture() {
  let finishHeader: ((result: BrowserApiJsonResult<unknown>) => void) | undefined;
  let finish: ((result: BrowserApiJsonResult<unknown>) => void) | undefined;
  const server = { ...task, title: "Current server task", updatedAt: "foreign-r2" };
  const client: BrowserApiClient = {
    requestJson: <T,>(input: Parameters<BrowserApiClient["requestJson"]>[0], options?: Parameters<BrowserApiClient["requestJson"]>[1]) => options?.method === "PATCH"
      ? new Promise<BrowserApiJsonResult<T>>(resolve => { finish = result => resolve(result as BrowserApiJsonResult<T>); })
      : String(input).includes("planning-board-data") ? new Promise<BrowserApiJsonResult<T>>(resolve => { finishHeader = result => resolve(result as BrowserApiJsonResult<T>); })
      : Promise.resolve({ response: new Response(null), body: { taskDetail: { revision: "detail", project: initial.project, item: server, ancestors: [], children: [], relatedItems: [], people: [], sprints: [], discussion: { comments: [], externalComments: [] }, blockers: [], relationships: [], activity: [], reviews: [] } } as T }),
    requestForm: async () => { throw new Error("Unexpected upload"); },
    requestBlob: async () => { throw new Error("Unexpected blob"); },
  };
  return { client, completeHeader: () => finishHeader?.({ response: new Response(null), body: { model: { revision: "header", project: initial.project, items: initial.tasks, people: [], sprints: [], relationships: [], preferences: [] }, headerData: { ...emptyPlanningHeaderData, notifications: { state: "ready", data: { unreadCount: 7, items: [] } } } } }), conflict: () => finish?.({ response: new Response(null, { status: 409 }), body: { error: "Geänderte Aufgabe", conflictReason: "revision" } }), lose: () => finish?.({ response: new Response(null, { status: 503 }), body: null }), confirm: () => finish?.({ response: new Response(null), body: { task: { ...task, title: "Submitted before navigation", updatedAt: "r2" } } }) };
}
function Page({ workspace, network, account = "navigation-user" }: { workspace: "planning" | "team"; account?: string; network: ReturnType<typeof networkFixture> }) {
  const [header, setHeaderData] = useState(emptyPlanningHeaderData);
  const owner = usePlanningStateOwner({ initialData: initial, initialHeaderData: header, initialUserId: account, initialCurrentProfile: null, initialWorkspace: workspace, setHeaderData });
  useEffect(() => { owner.configure(network.client, workspace, header, null); }, [owner, network, workspace, header]);
  const [draft, setDraft] = useState("");
  return <section aria-label={workspace}>
    <label>Local draft<input value={draft} onChange={event => setDraft(event.target.value)} /></label>
    <p>Header count: {header.notifications.data.unreadCount}</p>
    <p>Editor: {owner.planningState.taskEdits(task.id)[0]?.phase || "none"}</p>
    <p>Task: {owner.planningState.taskDetail(task.id).task?.title || "cleared"}</p>
    <p>Status: {owner.planningState.taskDetail(task.id).saveStatus}</p>
    <p>Submitted: {owner.planningState.taskSaves(task.id)[0]?.submitted?.title || "none"}</p>
    <p>Cache: {getProtectedPlanningShellStateCache("planning")?.data.tasks[0]?.title || "cleared"}</p>
    <button onClick={() => { void owner.planningState.refreshWorkspace("planning"); }}>Refresh Planning</button>
    <button onClick={() => { void owner.planningState.beginTaskEdit(task).save({ title: "Submitted before navigation" }); }}>Save task</button>
  </section>;
}
function NavigationStory() {
  const [workspace, setWorkspace] = useState<"planning" | "team" | "releases">("planning");
  const [network] = useState(networkFixture);
  return <PlanningStateProvider>
    <main>
      <button onClick={() => setWorkspace("team")}>Navigate Team</button>
      <button onClick={() => setWorkspace("releases")}>Navigate Releases</button>
      <button onClick={() => setWorkspace("planning")}>Navigate Planning</button>
      <button onClick={network.completeHeader}>Complete original Header read</button>
      <button onClick={network.confirm}>Confirm save</button>
      <button onClick={network.conflict}>Conflict response</button>
      <button onClick={network.lose}>Lose response</button>
      {workspace === "releases" ? <p>Release archive</p> : <Page key={workspace} workspace={workspace} network={network} />}
    </main>
  </PlanningStateProvider>;
}
const meta = { component: NavigationStory, title: "Planning/Lifetime/Navigation" } satisfies Meta<typeof NavigationStory>;
export default meta;
type Story = StoryObj<typeof meta>;
export const PendingTaskSurvivesWorkspaceAndReleaseNavigation: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: "Save task" }));
    await expect(canvas.getByText("Status: saving")).toBeVisible();
    await userEvent.click(canvas.getByRole("button", { name: "Navigate Team" }));
    await expect(canvas.getByText("Task: Submitted before navigation")).toBeVisible();
    await expect(canvas.getByText("Submitted: Submitted before navigation")).toBeVisible();
    await userEvent.click(canvas.getByRole("button", { name: "Navigate Releases" }));
    await userEvent.click(canvas.getByRole("button", { name: "Confirm save" }));
    await userEvent.click(canvas.getByRole("button", { name: "Navigate Planning" }));
    await waitFor(() => expect(canvas.getByText("Status: saved")).toBeVisible());
    await expect(canvas.getByText("Task: Submitted before navigation")).toBeVisible();
    await expect(canvas.getByText("Cache: Submitted before navigation")).toBeVisible();
  },
};

export const ConflictRemainsAvailableAfterNavigation: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: "Save task" }));
    await userEvent.click(canvas.getByRole("button", { name: "Navigate Team" }));
    await userEvent.click(canvas.getByRole("button", { name: "Conflict response" }));
    await waitFor(() => expect(canvas.getByText("Editor: conflict")).toBeVisible());
    await expect(canvas.getByText("Task: Current server task")).toBeVisible();
    await userEvent.click(canvas.getByRole("button", { name: "Navigate Planning" }));
    await expect(canvas.getByText("Editor: conflict")).toBeVisible();
    await expect(canvas.getByText("Task: Current server task")).toBeVisible();
  },
};
export const UnknownSubmissionRemainsAvailableAfterNavigation: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.type(canvas.getByRole("textbox", { name: "Local draft" }), "Unsubmitted local form");
    await userEvent.click(canvas.getByRole("button", { name: "Save task" }));
    await userEvent.click(canvas.getByRole("button", { name: "Navigate Releases" }));
    await userEvent.click(canvas.getByRole("button", { name: "Lose response" }));
    await userEvent.click(canvas.getByRole("button", { name: "Navigate Planning" }));
    await waitFor(() => expect(canvas.getByText("Status: unconfirmed")).toBeVisible());
    await expect(canvas.getByText("Submitted: Submitted before navigation")).toBeVisible();
    await expect(canvas.getByRole("textbox", { name: "Local draft" })).toHaveValue("");
    await expect(canvas.getByText("Cache: Before navigation")).toBeVisible();
  },
};
function sessionFixture() {
  let current: BrowserSessionSnapshot | null = { userId: "navigation-user", user: { id: "navigation-user" }, revision: "credential-1", expiresAt: Math.floor(Date.now() / 1000) + 3600 };
  const listeners = new Set<(value: BrowserSessionSnapshot | null) => void>();
  const publish = (value: BrowserSessionSnapshot | null) => { current = value; listeners.forEach(listener => listener(value)); };
  const source = { current: async () => current, subscribe: (listener: (value: BrowserSessionSnapshot | null) => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; } };
  return { source, logout: () => publish(null), replace: () => publish({ userId: "replacement-user", user: { id: "replacement-user" }, revision: "credential-2", expiresAt: Math.floor(Date.now() / 1000) + 3600 }), expire: () => publish({ userId: "navigation-user", user: { id: "navigation-user" }, revision: "expired", expiresAt: 1 }) };
}
function SessionNavigationStory() {
  const [sessions] = useState(sessionFixture);
  const [lifetime] = useState(() => createBrowserPlanningLifetime(sessions.source));
  const [network] = useState(networkFixture);
  const [account, setAccount] = useState("navigation-user");
  const [page, setPage] = useState(0);
  useEffect(() => lifetime.connect(), [lifetime]);
  return <PlanningStateLifetimeContext.Provider value={lifetime}>
    <main>
      <button onClick={() => setPage(value => value + 1)}>Navigate same account</button>
      <button onClick={sessions.logout}>Logout</button>
      <button onClick={() => { sessions.replace(); setAccount("replacement-user"); }}>Replace account</button>
      <button onClick={sessions.expire}>Expire session</button>
      <button onClick={network.confirm}>Confirm old save</button>
      <Page key={`${page}-${account}`} workspace="planning" account={account} network={network} />
    </main>
  </PlanningStateLifetimeContext.Provider>;
}
export const LogoutIgnoresOldConfirmation: Story = {
  render: () => <SessionNavigationStory />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: "Save task" }));
    await userEvent.click(canvas.getByRole("button", { name: "Logout" }));
    await expect(canvas.getByText("Task: cleared")).toBeVisible();
    await userEvent.click(canvas.getByRole("button", { name: "Confirm old save" }));
    await userEvent.click(canvas.getByRole("button", { name: "Navigate same account" }));
    await expect(canvas.getByText("Task: cleared")).toBeVisible();
    await expect(canvas.getByText("Submitted: none")).toBeVisible();
    await expect(canvas.getByText("Cache: cleared")).toBeVisible();
  },
};
export const ReplacementAccountRejectsOldConfirmation: Story = {
  render: () => <SessionNavigationStory />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: "Save task" }));
    await userEvent.click(canvas.getByRole("button", { name: "Replace account" }));
    await expect(canvas.getByText("Task: Before navigation")).toBeVisible();
    await userEvent.click(canvas.getByRole("button", { name: "Confirm old save" }));
    await userEvent.click(canvas.getByRole("button", { name: "Navigate same account" }));
    await expect(canvas.getByText("Task: Before navigation")).toBeVisible();
    await expect(canvas.getByText("Submitted: none")).toBeVisible();
    await expect(canvas.getByText("Cache: Before navigation")).toBeVisible();
  },
};
export const ExpiredSessionCannotRehydrateOldPage: Story = {
  render: () => <SessionNavigationStory />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: "Save task" }));
    await userEvent.click(canvas.getByRole("button", { name: "Expire session" }));
    await expect(canvas.getByText("Task: cleared")).toBeVisible();
    await userEvent.click(canvas.getByRole("button", { name: "Confirm old save" }));
    await userEvent.click(canvas.getByRole("button", { name: "Navigate same account" }));
    await expect(canvas.getByText("Task: cleared")).toBeVisible();
    await expect(canvas.getByText("Cache: cleared")).toBeVisible();
  },
};

export const LateReadPublishesIntoTheCurrentlyMountedHeader: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: "Refresh Planning" }));
    await userEvent.click(canvas.getByRole("button", { name: "Navigate Team" }));
    await expect(canvas.getByText("Header count: 0")).toBeVisible();
    await userEvent.click(canvas.getByRole("button", { name: "Complete original Header read" }));
    await waitFor(() => expect(canvas.getByText("Header count: 7")).toBeVisible());
  },
};
