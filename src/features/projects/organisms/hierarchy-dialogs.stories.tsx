import { useState, useSyncExternalStore } from "react";
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, userEvent, waitFor, within } from "storybook/test";
import { EpicDialog } from "./epic-dialog";
import { InitiativeDialog } from "./initiative-dialog";
import { EpicDeleteDialog } from "./epic-delete-dialog";
import { ProjectsOverview } from "./projects-overview";
import { createBrowserPlanningState } from "@/features/planning/model/internal/browser-planning-state";
import { emptyPlanningShellState } from "@/features/planning/model/planning-shell-state";
import { emptyPlanningHeaderData } from "@/lib/planning-header-data";
import { taskDetailStoryTask } from "@/features/tasks/molecules/task-detail-story-fixtures";
import type { BrowserApiClient } from "@/lib/browser-api-client";
import type { Profile, Task } from "@/lib/types";

const profile: Profile = { id: "ceo", name: "CEO", platformRole: "ceo", orgRole: "CEO", weeklyCapacity: 40, githubLogin: "ceo" };
const epic = taskDetailStoryTask({ id: "epic", taskType: "epic", title: "Original milestone", description: "Milestone goal", approvalStatus: null, updatedAt: "original/epic" });
const target = { ...epic, id: "new-epic", title: "Other milestone" };
const initiative = taskDetailStoryTask({ id: "initiative", taskType: "initiative", title: "Original initiative", description: "Original goal", ownerId: profile.id, parentTaskId: epic.id, approvalStatus: "proposed", updatedAt: "original/initiative", strategy: { goal: "Original goal", successCriteria: "Observable result", scopeConstraints: "No expansion" }, raciAssignments: [{ profileId: profile.id, role: "accountable", sortOrder: 0 }, { profileId: profile.id, role: "responsible", sortOrder: 1 }] });
const initial = { ...emptyPlanningShellState, tasks: [epic, target, initiative], profiles: [profile] };
const controls = new Map<string, { writes(): readonly { path: string; payload: unknown }[]; reads(): number; refresh(): Promise<unknown>; end(): void }>();
function Fixture({ scenario = "epic-success" }: { scenario?: string }) {
  const [network] = useState(() => {
    const writes: { path: string; payload: unknown }[] = [];
    let reads = 0;
    let serverTask: Task = scenario.startsWith("epic") || scenario.startsWith("delete") ? epic : initiative;
    const client: BrowserApiClient = {
      async requestJson<T>(path: Parameters<BrowserApiClient["requestJson"]>[0], options?: Parameters<BrowserApiClient["requestJson"]>[1]) {
        if (options?.method) {
          writes.push({ path: String(path), payload: JSON.parse(JSON.stringify(options.json)) });
          const patch = JSON.parse(JSON.stringify(options.json)) as Partial<Task> & { expectedUpdatedAt?: string };
          if (options.method === "DELETE") return { response: new Response(null, { status: scenario === "delete-unknown" ? 503 : 200 }), body: (scenario === "delete-unknown" ? { error: "Missing deletion confirmation" } : { task: epic }) as T };
          if (options.method === "POST") return { response: new Response(null, { status: 400 }), body: { code: "task_created_approval_failed", error: "Initiative konnte nicht freigegeben werden.", task: { ...initiative, id: "created", title: patch.title, updatedAt: "created/actual" } } as T };
          if (scenario.startsWith("parent")) {
            if (Object.hasOwn(patch, "parentTaskId")) {
              expect(patch).toEqual({ parentTaskId: target.id, expectedUpdatedAt: initiative.updatedAt });
              if (scenario === "parent-first-unknown") return { response: new Response(null, { status: 503 }), body: { error: "Zuordnung unbestätigt" } as T };
              serverTask = { ...initiative, parentTaskId: target.id, updatedAt: "actual/reparent" };
              return { response: new Response(null), body: { task: serverTask } as T };
            }
            expect(patch.expectedUpdatedAt).toBe("actual/reparent");
            return { response: new Response(null, { status: scenario === "parent-content-unknown" ? 503 : 400 }), body: { error: "Inhalt konnte nicht bestätigt werden." } as T };
          }
          serverTask = { ...serverTask, ...patch, updatedAt: "accepted/epic" };
          return { response: new Response(null), body: { task: serverTask } as T };
        }
        reads++;
        if (scenario === "epic-conflict") serverTask = { ...epic, title: "Server milestone", updatedAt: "server/newer" };
        return { response: new Response(null), body: { taskDetail: { revision: "read", project: initial.project, item: serverTask, ancestors: serverTask.id === epic.id ? [] : [epic], children: [], relatedItems: [], people: [profile], sprints: [], discussion: { comments: [], externalComments: [] }, blockers: [], relationships: [], activity: [], reviews: [], coverage: { discussion: "complete", relationships: "complete", timeline: "complete" } } } as T };
      },
      requestForm: async () => { throw new Error("Unexpected multipart"); },
      requestBlob: async () => { throw new Error("Unexpected blob"); },
    };
    return { client, writes: () => writes, reads: () => reads };
  });
  const [browser] = useState(() => { const value = createBrowserPlanningState({ initialData: initial, initialWorkspace: "projects", initialUserId: "user", initialCurrentProfile: profile, initialHeaderData: emptyPlanningHeaderData }); value.runtime.apiClient = network.client; return value; });
  const { planning, internal } = browser.owner;
  const data = useSyncExternalStore(planning.subscribe, internal.getSnapshot, internal.getSnapshot);
  const [open, setOpen] = useState(true);
  const [, update] = useState(0);
  const close = () => { setOpen(false); update(value => value + 1); };
  controls.set(scenario, { ...network, refresh: () => planning.loadTaskDetail(epic.id), end: () => internal.sessionChanged(null) });
  return <main className="p-4"><h1>Coordinated hierarchy</h1>
    {open ? scenario.startsWith("epic") ? <EpicDialog planningState={planning} defaults={{ id: epic.id, expectedUpdatedAt: epic.updatedAt, title: epic.title, description: epic.description }} onClose={close} />
      : scenario.startsWith("delete") ? <EpicDeleteDialog planningState={planning} target={{ epic, children: { initiatives: 0, tasks: 0 } }} onClose={close} />
        : <InitiativeDialog planningState={planning} defaults={{ id: scenario === "create-partial" ? undefined : initiative.id, expectedUpdatedAt: initiative.updatedAt, title: initiative.title, parentTaskId: epic.id, ownerId: profile.id, accountableProfileId: profile.id, responsibleProfileIds: [profile.id], goal: "Original goal", successCriteria: "Observable result", scopeConstraints: "No expansion", approveNow: scenario === "create-partial" }} data={data} pending={false} canApproveNow onClose={close} />
      : <ProjectsOverview planningState={planning} data={data} tasks={[...planning.hierarchy().tasks]} currentProfile={profile} canManageEpics canManageInitiatives pending={false} onCreateEpic={() => {}} onDeleteEpic={() => {}} onEditEpic={() => {}} onEditInitiative={() => {}} onOpenTask={() => {}} onDecideInitiative={(task, action, note) => { void planning.decideInitiativeApproval(task, action, note); }} onWithdrawInitiative={(task, reason) => { void planning.withdrawTask(task, reason); }} />}
  </main>;
}
const meta = { title: "Features/Projects/Organisms/CoordinatedHierarchy", component: Fixture, parameters: { layout: "fullscreen" } } satisfies Meta<typeof Fixture>;
export default meta;
type Story = StoryObj<typeof meta>;
export const EpicPublishesActualReceipt: Story = { play: async ({ canvasElement }) => {
  const canvas = within(canvasElement);
  await userEvent.clear(canvas.getByRole("textbox", { name: /Titel/ }));
  await userEvent.type(canvas.getByRole("textbox", { name: /Titel/ }), "Saved milestone");
  await userEvent.click(canvas.getByRole("button", { name: "Speichern" }));
  await waitFor(() => expect(canvas.queryByRole("dialog")).not.toBeInTheDocument());
  await expect(canvas.getByText("Saved milestone", { exact: true })).toBeVisible();
  expect(controls.get("epic-success")!.writes()).toHaveLength(1); expect(controls.get("epic-success")!.reads()).toBe(0);
} };
export const OriginalEpicBasisNeedsConsciousResave: Story = { args: { scenario: "epic-conflict" }, play: async ({ canvasElement }) => {
  const canvas = within(canvasElement);
  await userEvent.clear(canvas.getByRole("textbox", { name: /Titel/ })); await userEvent.type(canvas.getByRole("textbox", { name: /Titel/ }), "My retained title");
  await controls.get("epic-conflict")!.refresh();
  await userEvent.click(canvas.getByRole("button", { name: "Speichern" }));
  await waitFor(() => expect(canvas.getByRole("button", { name: "Bewusst erneut speichern" })).toBeEnabled());
  await expect(canvas.getByRole("textbox", { name: /Titel/ })).toHaveValue("My retained title");
  expect(controls.get("epic-conflict")!.writes()).toHaveLength(0);
  await userEvent.click(canvas.getByRole("button", { name: "Bewusst erneut speichern" }));
  await waitFor(() => expect(canvas.queryByRole("dialog")).not.toBeInTheDocument());
  expect(controls.get("epic-conflict")!.writes()[0].payload).toMatchObject({ expectedUpdatedAt: "server/newer", title: "My retained title" });
} };
async function changeParent(canvasElement: HTMLElement) {
  const canvas = within(canvasElement);
  await userEvent.click(canvas.getByRole("combobox", { name: "Epic *" }));
  await userEvent.click(within(canvasElement.ownerDocument.body).getByRole("option", { name: "Other milestone" }));
  await userEvent.click(canvas.getByRole("button", { name: "Speichern" }));
  return canvas;
}
export const ConfirmedParentSurvivesRejectedContent: Story = { args: { scenario: "parent-content-rejected" }, play: async ({ canvasElement }) => {
  const canvas = await changeParent(canvasElement);
  await waitFor(() => expect(canvas.getByRole("alert")).toHaveTextContent("Inhalt konnte nicht bestätigt werden."));
  await expect(canvas.getByRole("textbox", { name: "Zielbild *" })).toHaveValue("Original goal");
  expect(controls.get("parent-content-rejected")!.writes()).toHaveLength(2);
  await userEvent.click(canvas.getByRole("button", { name: "Initiative schließen" }));
  await expect(canvas.getAllByText("Original initiative", { exact: true }).find(element => element.checkVisibility())).toBeVisible();
} };
export const UnknownContentRetainsConfirmedParentAcrossNavigation: Story = { args: { scenario: "parent-content-unknown" }, play: async ({ canvasElement }) => {
  const canvas = await changeParent(canvasElement);
  await waitFor(() => expect(canvas.getByText(/Die Zuordnung wurde gespeichert/)).toBeVisible());
  await expect(canvas.getByRole("button", { name: "Speichern" })).toBeDisabled();
  await userEvent.click(canvas.getByRole("button", { name: "Initiative schließen" }));
  await expect(canvas.getByText(/Die Zuordnung wurde gespeichert/)).toBeVisible();
  await userEvent.click(canvas.getByRole("button", { name: "Vorgang prüfen" }));
  expect(controls.get("parent-content-unknown")!.writes()).toHaveLength(2); expect(controls.get("parent-content-unknown")!.reads()).toBe(1);
} };
export const UnknownParentNeverStartsContent: Story = { args: { scenario: "parent-first-unknown" }, play: async ({ canvasElement }) => {
  const canvas = await changeParent(canvasElement);
  await waitFor(() => expect(canvas.getByRole("button", { name: "Speichern" })).toBeDisabled());
  await userEvent.click(canvas.getByRole("button", { name: "Vorgang prüfen" }));
  await userEvent.click(canvas.getByRole("button", { name: "Initiative schließen" }));
  await userEvent.click(canvas.getByText("Behaltene Eingaben anzeigen"));
  await expect(canvas.getByText("Observable result", { exact: false })).toBeVisible();
  expect(controls.get("parent-first-unknown")!.writes()).toHaveLength(1);
} };
export const PartialCreationCannotBeReplayed: Story = { args: { scenario: "create-partial" }, play: async ({ canvasElement }) => {
  const canvas = within(canvasElement);
  await userEvent.click(canvas.getByRole("button", { name: "Erstellen und freigeben" }));
  await waitFor(() => expect(canvas.getByText("Initiative erstellt, Freigabe fehlgeschlagen")).toBeVisible());
  await expect(canvas.getByRole("button", { name: "Erstellen und freigeben" })).toBeDisabled();
  await userEvent.click(canvas.getByRole("button", { name: "Initiative schließen" }));
  expect(controls.get("create-partial")!.writes()).toHaveLength(1);
} };
export const UnknownEmptyEpicDeletionChecksWithoutReplay: Story = { args: { scenario: "delete-unknown" }, play: async ({ canvasElement }) => {
  const canvas = within(canvasElement);
  await userEvent.click(canvas.getByRole("button", { name: "Meilenstein löschen" }));
  await waitFor(() => expect(canvas.getByRole("button", { name: "Meilenstein löschen" })).toBeDisabled());
  await userEvent.click(canvas.getByRole("button", { name: "Vorgang prüfen" }));
  expect(controls.get("delete-unknown")!.writes()).toHaveLength(1); expect(controls.get("delete-unknown")!.reads()).toBe(1);
} };
