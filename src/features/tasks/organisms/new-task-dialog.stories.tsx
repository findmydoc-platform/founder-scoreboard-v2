import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { useState, useSyncExternalStore } from "react";
import { expect, userEvent, within } from "storybook/test";
import { createBrowserPlanningState } from "@/features/planning/model/internal/browser-planning-state";
import { emptyPlanningShellState } from "@/features/planning/model/planning-shell-state";
import { PlanningBusinessStateContext } from "@/features/planning/hooks/use-planning-business-state";
import { emptyPlanningHeaderData } from "@/lib/planning-header-data";
import type { BrowserApiClient } from "@/lib/browser-api-client";
import { useTaskCreateCommand } from "../hooks/use-task-create-command";
import { taskDetailStoryTask } from "../molecules/task-detail-story-fixtures";
import { NewTaskDialog } from "./new-task-dialog";

const profile = { id: "ceo", name: "CEO", platformRole: "ceo" as const, orgRole: "CEO", githubLogin: "", weeklyCapacity: 40 };
const parent = taskDetailStoryTask({ id: "initiative", title: "Freigegebene Initiative", taskType: "initiative", approvalStatus: "approved", updatedAt: "opaque/parent" });
const initial = { ...emptyPlanningShellState, profiles: [profile], tasks: [parent] };
function CreateStory({ partial = false }: { partial?: boolean }) {
  const [writes, setWrites] = useState(0);
  const [reads, setReads] = useState(0);
  const [open, setOpen] = useState(true);
  const [, setError] = useState("");
  const [bundle] = useState(() => {
    const state = createBrowserPlanningState({ initialData: initial, initialHeaderData: emptyPlanningHeaderData, initialCurrentProfile: profile, initialUserId: "story-user", initialWorkspace: "planning" });
    const readAuthority = { userId: state.runtime.userId, deadline: Date.now() + 60_000 };
    const client: BrowserApiClient = {
      async requestJson<T>(_: Parameters<BrowserApiClient["requestJson"]>[0], options?: Parameters<BrowserApiClient["requestJson"]>[1]) {
        if (options?.method === "POST") {
          setWrites(count => count + 1);
          if (!partial) throw new Error("Antwort verloren");
          return { response: new Response(null, { status: 400 }), body: { code: "task_created_approval_failed", error: "Deliverable konnte nicht freigegeben werden.", task: taskDetailStoryTask({ id: "created", title: "Mein neuer Vorschlag", approvalStatus: "proposed", updatedAt: "opaque/created", sprintId: "" }) } as T };
        }
        setReads(count => count + 1);
        return { response: new Response(null), body: { readAuthority, model: { revision: "workspace", project: initial.project, items: [parent], people: [profile], sprints: [], relationships: [], preferences: [] } } as T };
      },
      requestForm: async () => { throw new Error("Unexpected form"); }, requestBlob: async () => { throw new Error("Unexpected blob"); },
    };
    state.runtime.session = {userId:state.runtime.userId,revision:"story-session",expiresAt:4102444800,user:{id:state.runtime.userId}}; state.runtime.apiClient = client;
    return state;
  });
  const data = useSyncExternalStore(bundle.owner.planning.subscribe, bundle.owner.internal.getSnapshot, bundle.owner.internal.getSnapshot);
  const { createTask } = useTaskCreateCommand({ planningState: bundle.owner.planning, currentProfile: profile, data, setSaveError: setError, startTransition: action => action(), setTaskDialogDefaults: value => { if (value === null) setOpen(false); }, syncTaskToGitHub: () => {} });
  return <>
    <output aria-label="Create requests">{writes}</output><output aria-label="Check reads">{reads}</output>
    <output aria-label="Confirmed task count">{bundle.owner.planning.protectedCache()?.tasks.length}</output>
    {open ? <NewTaskDialog defaults={{ creationRequestId: "11111111-1111-4111-8111-111111111111", title: "Mein neuer Vorschlag", parentTaskId: parent.id, approveNow: partial }} data={data} pending={false} canApproveNow currentProfileId={profile.id} onClose={() => setOpen(false)} onCreate={createTask} taskLifecycle={bundle.owner.planning.taskLifecycle()} onCheckTaskLifecycle={id => bundle.owner.planning.checkTaskLifecycle(id)} /> : null}
  </>;
}
const meta = { component: CreateStory, title: "Features/Tasks/Organisms/NewTaskDialog", parameters: { layout: "fullscreen" } } satisfies Meta<typeof CreateStory>;
export default meta;
type Story = StoryObj<typeof meta>;

function InitiativeDiscoveryStory({ paging = false }: { paging?: boolean }) {
  const [selected, setSelected] = useState("");
  const [queries, setQueries] = useState<string[]>([]);
  const [bundle] = useState(() => {
    const state = createBrowserPlanningState({ initialData: initial, initialHeaderData: emptyPlanningHeaderData, initialCurrentProfile: profile, initialUserId: "candidate-story-user", initialWorkspace: "planning" });
    const deadline = Date.now() + 60_000;
    const observedAt = new Date().toISOString();
    state.runtime.session = { userId: state.runtime.userId, revision: "candidate-story-session", expiresAt: deadline / 1000, user: { id: state.runtime.userId } };
    state.runtime.apiClient = {
      async requestJson<T>(input: Parameters<BrowserApiClient["requestJson"]>[0]) {
        const url = new URL(String(input), "http://localhost:3000");
        const scope = JSON.parse(url.searchParams.get("scope") || "{}");
        if (url.pathname !== "/api/planning-board-data" || scope.view !== "candidates") throw new Error("Unexpected candidate story read");
        setQueries(previous => [...previous, scope.query]);
        const target = { id: "off-page-initiative", title: "Säulen außerhalb des Boards", taskType: "initiative", parentTaskId: "", approvalStatus: "approved", updatedAt: "2026-11-01T12:00:00Z" };
        const firstPage = Array.from({ length: 20 }, (_, index) => ({ ...target, id: `candidate-page-${index + 1}`, title: `Säulen Beispiel ${index + 1}` }));
        const items = scope.query !== "säulen" ? [] : paging && !scope.continuation ? firstPage : [target];
        const further = paging && scope.query === "säulen" && !scope.continuation;
        return { response: new Response(null), body: { candidates: { items, total: scope.query === "säulen" && paging ? 21 : items.length, coverage: further ? "partial" : "complete", continuation: further ? "candidate-story-next" : null,
          sourceRevision: "candidate-story-source", observedAt, validUntil: new Date(deadline).toISOString() },
        readAuthority: { userId: state.runtime.userId, deadline }, readActor: { profileId: profile.id, platformRole: profile.platformRole } } as T };
      },
      requestForm: async () => { throw new Error("Unexpected form"); }, requestBlob: async () => { throw new Error("Unexpected blob"); },
    } satisfies BrowserApiClient;
    return state;
  });
  const data = useSyncExternalStore(bundle.owner.planning.subscribe, bundle.owner.internal.getSnapshot, bundle.owner.internal.getSnapshot);
  return <PlanningBusinessStateContext.Provider value={bundle.owner.planning}>
    <output aria-label="Candidate searches">{queries.join(",")}</output><output aria-label="Submitted Initiative">{selected}</output>
    <NewTaskDialog defaults={{ title: "Unveränderter Entwurf", parentTaskId: parent.id }} data={data} pending={false} currentProfileId={profile.id}
      onClose={() => undefined} onCreate={draft => setSelected(draft.parentTaskId)} />
  </PlanningBusinessStateContext.Provider>;
}

export const InitiativeDiscoveryRetainsSelectionAcrossSearch: Story = {
  render: () => <InitiativeDiscoveryStory />,
  play: async () => {
    const canvas = within(document.body);
    await userEvent.click(canvas.getByRole("combobox", { name: "Initiative" }));
    const search = await canvas.findByRole("searchbox", { name: "Initiative suchen" });
    await userEvent.type(search, "Säulen"); await userEvent.keyboard("{Enter}");
    await userEvent.click(await canvas.findByRole("option", { name: /Säulen außerhalb des Boards/ }));
    await expect(canvas.getByRole("combobox", { name: "Initiative" })).toHaveTextContent("Säulen außerhalb des Boards");
    await userEvent.click(canvas.getByRole("combobox", { name: "Initiative" }));
    const replacement = canvas.getByRole("searchbox", { name: "Initiative suchen" });
    await userEvent.clear(replacement); await userEvent.type(replacement, "Kein Treffer"); await userEvent.keyboard("{Enter}");
    await expect(await canvas.findByText("Keine Initiativen gefunden.")).toBeVisible();
    await expect(canvas.getByRole("combobox", { name: "Initiative" })).toHaveTextContent("Säulen außerhalb des Boards");
    await expect(canvas.getByRole("textbox", { name: /Titel/ })).toHaveValue("Unveränderter Entwurf");
    await userEvent.keyboard("{Escape}");
    await userEvent.click(canvas.getByRole("button", { name: "Deliverable vorschlagen" }));
    await expect(canvas.getByLabelText("Submitted Initiative")).toHaveTextContent("off-page-initiative");
  },
};

export const InitiativeFurtherPageRetainsSelectionAcrossSearch: Story = {
  render: () => <InitiativeDiscoveryStory paging />,
  play: async () => {
    const canvas = within(document.body);
    await userEvent.click(canvas.getByRole("combobox", { name: "Initiative" }));
    const search = await canvas.findByRole("searchbox", { name: "Initiative suchen" });
    await userEvent.type(search, "Säulen"); await userEvent.keyboard("{Enter}");
    await expect(await canvas.findByRole("option", { name: "Säulen Beispiel 1" })).toBeVisible();
    await userEvent.click(await canvas.findByRole("button", { name: "Weitere Initiativen laden" }));
    await userEvent.click(await canvas.findByRole("option", { name: "Säulen außerhalb des Boards" }));
    await expect(canvas.getByRole("combobox", { name: "Initiative" })).toHaveTextContent("Säulen außerhalb des Boards");
    await userEvent.click(canvas.getByRole("combobox", { name: "Initiative" }));
    const replacement = canvas.getByRole("searchbox", { name: "Initiative suchen" });
    await userEvent.clear(replacement); await userEvent.type(replacement, "Kein Treffer"); await userEvent.keyboard("{Enter}");
    await expect(await canvas.findByText("Keine Initiativen gefunden.")).toBeVisible();
    await expect(canvas.getByRole("combobox", { name: "Initiative" })).toHaveTextContent("Säulen außerhalb des Boards");
    await expect(canvas.getByRole("textbox", { name: /Titel/ })).toHaveValue("Unveränderter Entwurf");
    await userEvent.keyboard("{Escape}"); await userEvent.click(canvas.getByRole("button", { name: "Deliverable vorschlagen" }));
    await expect(canvas.getByLabelText("Submitted Initiative")).toHaveTextContent("off-page-initiative");
  },
};
export const LostCreationResponseRetainsDraftWithoutReplay: Story = {
  play: async () => {
    const canvas = within(document.body);
    await userEvent.click(canvas.getByRole("button", { name: "Deliverable vorschlagen" }));
    await expect(await canvas.findByText("Erstellung unklar")).toBeVisible();
    await expect(canvas.getByRole("button", { name: "Deliverable vorschlagen" })).toBeDisabled();
    await expect(canvas.getByRole("textbox", { name: /Titel/ })).toHaveValue("Mein neuer Vorschlag");
    await userEvent.click(canvas.getByRole("button", { name: "Ergebnis prüfen" }));
    await expect(await canvas.findByText(/Ob die Änderung vollständig ausgeführt wurde, bleibt unklar/)).toBeVisible();
    await expect(canvas.getByRole("button", { name: "Deliverable vorschlagen" })).toBeDisabled();
    await expect(canvas.getByRole("textbox", { name: /Titel/ })).toHaveValue("Mein neuer Vorschlag");
    await expect(canvas.getByLabelText("Create requests")).toHaveTextContent("1");
    await expect(canvas.getByLabelText("Check reads")).toHaveTextContent("1");
    await expect(canvas.getByLabelText("Confirmed task count")).toHaveTextContent("1");
  },
};
export const CreationConfirmedApprovalFailed: Story = {
  args: { partial: true },
  play: async () => {
    const canvas = within(document.body);
    await userEvent.click(canvas.getByRole("button", { name: "Erstellen und freigeben" }));
    await expect(await canvas.findByText("Aufgabe erstellt, Freigabe fehlgeschlagen")).toBeVisible();
    await expect(canvas.getByRole("button", { name: "Erstellen und freigeben" })).toBeDisabled();
    await expect(canvas.getByLabelText("Create requests")).toHaveTextContent("1");
    await expect(canvas.getByLabelText("Confirmed task count")).toHaveTextContent("2");
  },
};
