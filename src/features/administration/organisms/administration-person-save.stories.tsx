import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { useEffect, useState, useSyncExternalStore } from "react";
import { expect, userEvent, waitFor, within } from "storybook/test";
import { createPlanningState } from "@/features/planning/model/internal/planning-state-owner";
import { emptyPlanningShellState } from "@/features/planning/model/planning-shell-state";
import { sessionAuthority } from "@/features/administrator-access/model/administrator-access";
import { AdministrationWorkspaceHost } from "./administration-workspace-host";
import { administrationStoryModel } from "./administration-workspace.stories";
import { usePlanningStateOwner } from "@/features/planning/hooks/use-planning-state-owner";
import { useAdministratorAccessController } from "@/features/administrator-access/hooks/use-administrator-access-controller";
import { AdministratorModeIndicator } from "@/features/administrator-access/molecules/administrator-mode-indicator";
import { PlanningStateLifetimeContext } from "@/features/planning/model/internal/planning-state-lifetime-context";
import { createBrowserPlanningLifetime } from "@/features/planning/model/internal/browser-planning-lifetime";
import { emptyPlanningHeaderData } from "@/lib/planning-header-data";
import { taskDetailStoryTask } from "@/features/tasks/molecules/task-detail-story-fixtures";
import type { BrowserApiClient } from "@/lib/browser-api-client";
const ignoreAccessInvalid = () => { };
function SaveStory() {
    const [owner] = useState(() => { let reads = 0; const authority = sessionAuthority({ platformRole: "ceo", credentialKind: "session", administratorAccess: { eligible: true, active: true, expiresAt: new Date(Date.now() + 3600000).toISOString() } }); return createPlanningState({ userId: "story", initialData: emptyPlanningShellState, initialAdministrationAuthority: authority, adapter: { saveTask: async () => ({ task: {} }), readWorkspace: async () => null, readAdministration: async () => { if (reads++)
                throw Object.assign(new Error("Nachladen nicht verfügbar"), { status: 503 }); return { ...administrationStoryModel, coverage: { people: "complete", technical: true, notificationEvents: "partial", notificationDeliveries: "partial" }, people: administrationStoryModel.people.map(person => ({ ...person, technicalBasis: { githubLogin: person.githubLogin, googleChatUserId: person.googleChatUserId, googleChatDmSpace: person.googleChatDmSpace } })) }; }, saveAdministrationTechnical: async (id, patch) => ({ profile: { id, ...patch } }), saveAdministrationEligibility: async () => { throw Object.assign(new Error("Berechtigung abgelehnt"), { status: 400 }); } } }); });
    return <main className="min-h-screen bg-slate-50 p-4"><AdministrationWorkspaceHost planningState={owner.planning} apiClient={{} as BrowserApiClient} capabilities={administrationStoryModel.capabilities} onAdministratorAccessInvalid={ignoreAccessInvalid}/></main>;
}
const meta = { title: "Administration/People/CoordinatedSave", component: SaveStory, parameters: { layout: "fullscreen" } } satisfies Meta<typeof SaveStory>;
export default meta;
type Story = StoryObj<typeof meta>;
export const TechnicalConfirmationSurvivesEligibilityAndReloadFailure: Story = { play: async ({ canvasElement }) => { const canvas = within(canvasElement); await userEvent.click(await canvas.findByRole("tab", { name: "Personen & Zugänge" })); const login = await canvas.findByLabelText("GitHub-Login"); await userEvent.clear(login); await userEvent.type(login, "new-confirmed-login"); await userEvent.click(canvas.getByRole("switch", { name: "Admin-Zugang berechtigt" })); await userEvent.click(canvas.getByRole("button", { name: "Speichern" })); await expect(await canvas.findByText("Technische Identität gespeichert")).toBeVisible(); await expect(canvas.getByText("Adminberechtigung abgelehnt")).toBeVisible(); await expect(login).toHaveValue("new-confirmed-login"); await expect(canvas.getByText("Die Ergebnisdaten konnten nicht nachgeladen werden.")).toBeVisible(); } };
function authorityNetwork() {
    const initial = { eligible: true, active: true, expiresAt: new Date(Date.now() + 3600000).toISOString() };
    let access: import("@/features/administrator-access/model/administrator-access").AdministratorAccessSnapshot = initial;
    let hold = false;
    let finishRead: ((value: unknown) => void) | undefined, finishWrite: ((value: unknown) => void) | undefined;
    let technicalWrites = 0, eligibilityWrites = 0;
    const full = { ...administrationStoryModel, coverage: { people: "complete" as const, technical: true, notificationEvents: "partial" as const, notificationDeliveries: "partial" as const }, people: administrationStoryModel.people.map(person => ({ ...person, technicalBasis: { githubLogin: person.githubLogin, googleChatUserId: person.googleChatUserId, googleChatDmSpace: person.googleChatDmSpace } })) };
    const client: BrowserApiClient = { requestJson: <T,>(input: Parameters<BrowserApiClient["requestJson"]>[0], options?: Parameters<BrowserApiClient["requestJson"]>[1]) => {
            if (String(input) === "/api/administrator-access") {
                if (options?.method === "DELETE")
                    access = { eligible: true, active: false, expiresAt: null };
                return Promise.resolve({ response: new Response(null), body: { administratorAccess: access } as T });
            }
            if (String(input) === "/api/administration-data") {
                if (hold) {
                    hold = false;
                    return new Promise<import("@/lib/browser-api-client").BrowserApiJsonResult<T>>(resolve => { finishRead = value => resolve(value as import("@/lib/browser-api-client").BrowserApiJsonResult<T>); });
                }
                return Promise.resolve({ response: new Response(null), body: { administration: full } as T });
            }
            if (String(input).includes("/technical")) {
                technicalWrites++;
                return new Promise<import("@/lib/browser-api-client").BrowserApiJsonResult<T>>(resolve => { finishWrite = value => resolve(value as import("@/lib/browser-api-client").BrowserApiJsonResult<T>); });
            }
            if (String(input).includes("/administrator-access/profiles/")) {
                eligibilityWrites++;
                return Promise.resolve({ response: new Response(null), body: { administratorAccess: { profileId: "sebastian", eligible: false, active: false, expiresAt: null } } as T });
            }
            return Promise.resolve({ response: new Response(null, { status: 503 }), body: null });
        }, requestForm: async () => { throw new Error("Unexpected upload"); }, requestBlob: async () => { throw new Error("Unexpected blob"); } };
    return { client, initial, holdRead: () => { hold = true; }, finish: () => { finishRead?.({ response: new Response(null), body: { administration: full } }); finishWrite?.({ response: new Response(null), body: { ok: true, profile: { id: "sebastian", githubLogin: "late-private", googleChatUserId: "late-chat", googleChatDmSpace: "late-space" } } }); }, counts: () => ({ technicalWrites, eligibilityWrites }) };
}
const actor = { id: "actor", name: "Current Admin", platformRole: "founder" as const, githubLogin: "admin" };
const retainedTask = taskDetailStoryTask({ id: "independent", title: "Independent task", updatedAt: "retained" });
function AuthorityPage({ page, network }: {
    page: "administration" | "planning";
    network: ReturnType<typeof authorityNetwork>;
}) {
    const access = useAdministratorAccessController({ apiClient: network.client, initialAccess: network.initial, platformRole: actor.platformRole });
    const owner = usePlanningStateOwner({ initialData: { ...emptyPlanningShellState, tasks: [retainedTask], profiles: [{ ...actor, orgRole: "Founder", weeklyCapacity: 10 }] }, initialHeaderData: emptyPlanningHeaderData, initialUserId: "authority-user", initialCurrentProfile: actor, initialWorkspace: page, initialAdministratorAccess: network.initial });
    useEffect(() => { owner.configure(network.client, page, actor, access.administratorAccess); }, [owner, network, page, access.administratorAccess]);
    const state = owner.planningState.administration();
    return <section aria-label={page}>
  <AdministratorModeIndicator busy={access.busy} remainingSeconds={access.remainingSeconds} onEnd={() => { void access.end(); }}/>
  <p>Restricted people: {state.model?.people.length || 0}</p><p>Retained input: {owner.planningState.administrationPersonEdits("sebastian").some(edit => Boolean(edit.submitted)) ? "yes" : "no"}</p><p>Independent: {owner.planningState.taskDetail(retainedTask.id).task?.title}</p><p>Eligibility writes: {network.counts().eligibilityWrites}</p>
  {page === "administration" && <><button onClick={() => { network.holdRead(); void owner.planningState.loadAdministration(); }}>Hold old full read</button><AdministrationWorkspaceHost planningState={owner.planningState} apiClient={network.client} capabilities={access.authority.capabilities} onAdministratorAccessInvalid={ignoreAccessInvalid}/></>}
 </section>;
}
function AuthorityNavigationStory() {
    const [network] = useState(authorityNetwork);
    const [page, setPage] = useState<"administration" | "planning">("administration");
    const [lifetime] = useState(() => createBrowserPlanningLifetime({ current: async () => ({ userId: "authority-user", user: { id: "authority-user" }, revision: "session", expiresAt: Math.floor(Date.now() / 1000) + 3600 }), subscribe: () => () => { } }));
    const [ready,setReady]=useState(false);
    useEffect(() => {const disconnect=lifetime.connect();queueMicrotask(()=>setReady(true));return disconnect;}, [lifetime]);
    if(!ready)return <p>Sitzung wird geprüft.</p>;
    return <PlanningStateLifetimeContext.Provider value={lifetime}><main className="p-4"><button onClick={() => setPage("planning")}>Navigate Planning</button><button onClick={network.finish}>Complete old Admin results</button><AuthorityPage key={page} page={page} network={network}/></main></PlanningStateLifetimeContext.Provider>;
}
export const HeaderDeactivationAfterAdministrationUnmountRejectsLateResults: Story = { render: () => <AuthorityNavigationStory />, play: async ({ canvasElement }) => { const canvas = within(canvasElement); await userEvent.click(await canvas.findByRole("tab", { name: "Personen & Zugänge" })); const login = canvas.getByLabelText("GitHub-Login"); await userEvent.clear(login); await userEvent.type(login, "private-before-navigation"); await userEvent.click(canvas.getByRole("button", { name: "Speichern" })); await userEvent.click(canvas.getByRole("button", { name: "Hold old full read" })); await userEvent.click(canvas.getByRole("button", { name: "Navigate Planning" })); await expect(await canvas.findByText("Retained input: yes")).toBeVisible(); await userEvent.click(canvas.getByRole("button", { name: "Admin-Modus beenden" })); await waitFor(() => expect(canvas.getByText("Restricted people: 0")).toBeVisible()); await expect(canvas.getByText("Retained input: no")).toBeVisible(); await userEvent.click(canvas.getByRole("button", { name: "Complete old Admin results" })); await expect(canvas.getByText("Restricted people: 0")).toBeVisible(); await expect(canvas.getByText("Independent: Independent task")).toBeVisible(); await expect(canvas.getByText("Eligibility writes: 0")).toBeVisible(); } };
function PersonOutcomeStory({ unknown = false }: {
    unknown?: boolean;
}) {
    const [open, setOpen] = useState(true);
    const [fixture] = useState(() => {
        let writes = 0;
        let server = { ...administrationStoryModel, coverage: { people: "complete" as const, technical: true, notificationEvents: "partial" as const, notificationDeliveries: "partial" as const }, people: administrationStoryModel.people.map(person => ({ ...person, technicalBasis: { githubLogin: person.githubLogin, googleChatUserId: person.googleChatUserId, googleChatDmSpace: person.googleChatDmSpace } })) };
        const authority = sessionAuthority({ platformRole: "ceo", credentialKind: "session", administratorAccess: { eligible: true, active: true, expiresAt: new Date(Date.now() + 3600000).toISOString() } });
        const owner = createPlanningState({ userId: "story", initialData: emptyPlanningShellState, initialAdministrationAuthority: authority, adapter: { saveTask: async () => ({ task: {} }), readWorkspace: async () => null, readAdministration: async () => server, saveAdministrationTechnical: async (id, patch) => { writes++; server = { ...server, people: server.people.map(person => person.id === id ? { ...person, ...patch, technicalBasis: { ...patch } } : person) }; if (unknown)
                    throw new Error("Antwort verloren"); return { profile: { id, ...patch } }; } } });
        return { owner, writes: () => writes, background: async () => { server = { ...server, people: server.people.map((person, index) => index ? person : { ...person, githubLogin: "foreign-login", technicalBasis: { ...person.technicalBasis, githubLogin: "foreign-login" } }) }; await owner.planning.loadAdministration(); } };
    });
    useSyncExternalStore(fixture.owner.planning.subscribe, fixture.owner.internal.getSnapshot, fixture.owner.internal.getSnapshot);
    return <main className="p-4"><output aria-label="Technical writes">{fixture.writes()}</output><button onClick={() => setOpen(value => !value)}>Ansicht wechseln</button><button onClick={() => { void fixture.background(); }}>Background change</button>{open && <AdministrationWorkspaceHost planningState={fixture.owner.planning} apiClient={{} as BrowserApiClient} capabilities={administrationStoryModel.capabilities} onAdministratorAccessInvalid={ignoreAccessInvalid}/>}</main>;
}
export const UnknownTechnicalInputSurvivesNavigationAndReadonlyCheck: Story = { render: () => <PersonOutcomeStory unknown/>, play: async ({ canvasElement }) => { const canvas = within(canvasElement); await userEvent.click(await canvas.findByRole("tab", { name: "Personen & Zugänge" })); const login = canvas.getByLabelText("GitHub-Login"); await userEvent.clear(login); await userEvent.type(login, "unconfirmed-login"); await userEvent.click(canvas.getByRole("button", { name: "Speichern" })); await expect(await canvas.findByText("Technische Identität noch nicht bestätigt")).toBeVisible(); await userEvent.click(canvas.getByRole("button", { name: "Ansicht wechseln" })); await userEvent.click(canvas.getByRole("button", { name: "Ansicht wechseln" })); await userEvent.click(await canvas.findByRole("tab", { name: "Personen & Zugänge" })); await expect(canvas.getByLabelText("GitHub-Login")).toHaveValue("unconfirmed-login"); await userEvent.click(canvas.getByRole("button", { name: "Serverstand prüfen" })); await expect(canvas.getByText("Technische Identität noch nicht bestätigt")).toBeVisible(); await expect(canvas.getByLabelText("Technical writes")).toHaveTextContent("1"); await expect(canvas.getByRole("button", { name: "Speichern" })).toBeDisabled(); } };
export const BackgroundReadKeepsDraftUntilConsciousComparison: Story = { render: () => <PersonOutcomeStory />, play: async ({ canvasElement }) => { const canvas = within(canvasElement); await userEvent.click(await canvas.findByRole("tab", { name: "Personen & Zugänge" })); const login = canvas.getByLabelText("GitHub-Login"); await userEvent.clear(login); await userEvent.type(login, "retained-login"); await userEvent.click(canvas.getByRole("button", { name: "Background change" })); await expect(login).toHaveValue("retained-login"); await userEvent.click(canvas.getByRole("button", { name: "Speichern" })); await expect(await canvas.findByText("Die Person wurde zwischenzeitlich geändert. Deine Eingaben bleiben erhalten.")).toBeVisible(); await expect(canvas.getByLabelText("Technical writes")).toHaveTextContent("0"); await expect(canvas.getByRole("button", { name: "Bewusst erneut speichern" })).toBeDisabled(); await userEvent.click(canvas.getByRole("button", { name: "Serverstand vergleichen" })); await expect(await canvas.findByText("Serverstand")).toBeVisible(); await expect(canvas.getByText("foreign-login", { selector: "dd" })).toBeVisible(); await expect(canvas.getByText("Admin-Zugang berechtigt", { selector: "p" })).toBeVisible(); await userEvent.click(canvas.getByRole("button", { name: "Bewusst erneut speichern" })); await expect(await canvas.findByText("Technische Identität gespeichert")).toBeVisible(); await expect(canvas.getByLabelText("Technical writes")).toHaveTextContent("1"); } };
