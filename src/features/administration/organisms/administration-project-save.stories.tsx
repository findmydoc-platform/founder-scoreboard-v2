import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { useState, useSyncExternalStore } from "react";
import { expect, userEvent, waitFor, within } from "storybook/test";
import type { BrowserApiClient, BrowserApiJsonResult } from "@/lib/browser-api-client";
import { createBrowserPlanningState } from "@/features/planning/model/internal/browser-planning-state";
import { emptyPlanningShellState } from "@/features/planning/model/planning-shell-state";
import { emptyPlanningHeaderData } from "@/lib/planning-header-data";
import { administrationStoryModel } from "./administration-workspace.stories";
import { AdministrationWorkspaceHost } from "./administration-workspace-host";
const ignored = () => { };
function ProjectStory({ mode = "confirmed" }: {
    mode?: "confirmed" | "conflict" | "unknown";
}) {
    const [open, setOpen] = useState(true);
    const [fixture] = useState(() => {
        let reads = 0, writes = 0;
        let expected = "";
        let model = { ...administrationStoryModel, coverage: { people: "complete" as const, technical: true, notificationEvents: "partial" as const, notificationDeliveries: "partial" as const } };
        const access = { eligible: true, active: true, expiresAt: new Date(Date.now() + 3600000).toISOString() };
        const bundle = createBrowserPlanningState({ initialData: { ...emptyPlanningShellState, project: { ...emptyPlanningShellState.project, id: model.githubProject!.id } }, initialHeaderData: emptyPlanningHeaderData, initialCurrentProfile: { id: "actor", name: "Admin", platformRole: "ceo", githubLogin: "admin" }, initialUserId: "project-story", initialWorkspace: "administration", initialAdministratorAccess: access });
        const client: BrowserApiClient = { requestJson: async <T,>(input: Parameters<BrowserApiClient["requestJson"]>[0], options?: Parameters<BrowserApiClient["requestJson"]>[1]): Promise<BrowserApiJsonResult<T>> => {
                if (String(input) === "/api/administration-data") {
                    reads++;
                    if (mode === "confirmed" && reads > 1)
                        return { response: new Response(null, { status: 503 }), body: { error: "Statusdaten nicht verfügbar" } as T };
                    return { response: new Response(null), body: { administration: model } as T };
                }
                if (String(input) === "/api/founderops-settings/github-project") {
                    writes++;
                    const payload = options?.json as Record<string, unknown>;
                    expected = JSON.stringify([payload.expectedGithubProjectOwner, payload.expectedGithubProjectNumber, payload.expectedGithubMentionTeamSlug]);
                    const project = { id: model.githubProject!.id, owner: String(payload.githubProjectOwner), number: Number(payload.githubProjectNumber), mentionTeamSlug: String(payload.githubMentionTeamSlug) };
                    model = { ...model, githubProject: project };
                    if (mode === "unknown")
                        throw new Error("Antwort verloren");
                    return { response: new Response(null), body: { ok: true, project: { id: project.id, githubProjectOwner: project.owner, githubProjectNumber: project.number, githubMentionTeamSlug: project.mentionTeamSlug } } as T };
                }
                throw new Error("Unexpected Project story request");
            }, requestForm: async () => { throw new Error("Unexpected form"); }, requestBlob: async () => { throw new Error("Unexpected blob"); } };
        Object.assign(bundle.runtime, { apiClient: client });
        return { bundle, client, counts: () => ({ reads, writes, expected }), background: async () => { model = { ...model, githubProject: { ...model.githubProject!, owner: "foreign-org", number: 9, mentionTeamSlug: "foreign-team" } }; await bundle.owner.planning.loadAdministration(); } };
    });
    useSyncExternalStore(fixture.bundle.owner.planning.subscribe, fixture.bundle.owner.internal.getSnapshot, fixture.bundle.owner.internal.getSnapshot);
    return <main className="min-h-screen bg-slate-50 p-4"><button onClick={() => setOpen(value => !value)}>Ansicht wechseln</button><button onClick={() => { void fixture.background(); }}>Background Project change</button><output aria-label="Project writes">{fixture.counts().writes}</output><output aria-label="Expected Project tuple">{fixture.counts().expected}</output>{open && <AdministrationWorkspaceHost planningState={fixture.bundle.owner.planning} apiClient={fixture.client} capabilities={administrationStoryModel.capabilities} onAdministratorAccessInvalid={ignored}/>}</main>;
}
const meta = { title: "Administration/Integrations/CoordinatedProjectSave", component: ProjectStory, parameters: { layout: "fullscreen" } } satisfies Meta<typeof ProjectStory>;
export default meta;
type Story = StoryObj<typeof meta>;
export const ConfirmedSettingsSurviveProviderRefreshFailure: Story = { play: async ({ canvasElement }) => {
        const canvas = within(canvasElement);
        await userEvent.click(await canvas.findByRole("tab", { name: "Integrationen & Zustellung" }));
        const number = canvas.getByLabelText("Project-Nummer");
        await userEvent.clear(number);
        await userEvent.type(number, "8");
        await userEvent.click(canvas.getByRole("button", { name: "Speichern und prüfen" }));
        await expect(await canvas.findByText("GitHub-Project-Einstellung gespeichert")).toBeVisible();
        await expect(canvas.getByText("Die Statusdaten konnten nicht nachgeladen werden.")).toBeVisible();
        await expect(number).toHaveValue(8);
        await expect(canvas.getByLabelText("Project writes")).toHaveTextContent("1");
    } };
export const OriginalTupleRequiresConsciousConflictResave: Story = { args: { mode: "conflict" }, play: async ({ canvasElement }) => {
        const canvas = within(canvasElement);
        await userEvent.click(await canvas.findByRole("tab", { name: "Integrationen & Zustellung" }));
        const number = canvas.getByLabelText("Project-Nummer");
        await userEvent.clear(number);
        await userEvent.type(number, "8");
        await userEvent.click(canvas.getByRole("button", { name: "Background Project change" }));
        await expect(number).toHaveValue(8);
        await userEvent.click(canvas.getByRole("button", { name: "Speichern und prüfen" }));
        await expect(await canvas.findByText("GitHub-Project-Einstellung zwischenzeitlich geändert")).toBeVisible();
        await expect(canvas.getByLabelText("Project writes")).toHaveTextContent("0");
        await expect(canvas.getByRole("button", { name: "Bewusst erneut speichern" })).toBeDisabled();
        await userEvent.click(canvas.getByRole("button", { name: "Serverstand vergleichen" }));
        await expect(await canvas.findByText("foreign-team", { selector: "dd" })).toBeVisible();
        await userEvent.click(canvas.getByRole("button", { name: "Bewusst erneut speichern" }));
        await expect(await canvas.findByText("GitHub-Project-Einstellung gespeichert")).toBeVisible();
        await expect(canvas.getByLabelText("Expected Project tuple")).toHaveTextContent('["foreign-org",9,"foreign-team"]');
    } };
export const UnknownSettingsRemainPendingAfterNavigationAndReadonlyCheck: Story = { args: { mode: "unknown" }, play: async ({ canvasElement }) => {
        const canvas = within(canvasElement);
        await userEvent.click(await canvas.findByRole("tab", { name: "Integrationen & Zustellung" }));
        const number = canvas.getByLabelText("Project-Nummer");
        await userEvent.clear(number);
        await userEvent.type(number, "8");
        await userEvent.click(canvas.getByRole("button", { name: "Speichern und prüfen" }));
        await expect(await canvas.findByText("GitHub-Project-Speicherung noch nicht bestätigt")).toBeVisible();
        await userEvent.click(canvas.getByRole("button", { name: "Ansicht wechseln" }));
        await userEvent.click(canvas.getByRole("button", { name: "Ansicht wechseln" }));
        await userEvent.click(await canvas.findByRole("tab", { name: "Integrationen & Zustellung" }));
        await expect(canvas.getByLabelText("Project-Nummer")).toHaveValue(8);
        await userEvent.click(canvas.getByRole("button", { name: "Serverstand prüfen" }));
        await waitFor(() => expect(canvas.getByLabelText("Project writes")).toHaveTextContent("1"));
        await expect(canvas.getByText("GitHub-Project-Speicherung noch nicht bestätigt")).toBeVisible();
        await expect(canvas.getByRole("button", { name: "Speichern und prüfen" })).toBeDisabled();
    } };
