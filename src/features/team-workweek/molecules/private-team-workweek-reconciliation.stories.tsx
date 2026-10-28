import { useEffect, useState, useSyncExternalStore } from "react";
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, userEvent, waitFor, within } from "storybook/test";
import { createPlanningState } from "@/features/planning/model/internal/planning-state-owner";
import { emptyPlanningShellState } from "@/features/planning/model/planning-shell-state";
import { HeaderCalendarAction } from "@/features/planning/molecules/header-calendar-action";
import type { BrowserApiClient } from "@/lib/browser-api-client";
import { readPublishedWorkweekCalendar } from "../model/published-workweek-calendar-api";
import { privateWorkweekApi } from "../model/private-workweek-api";
import { emptyTeamWorkweekWindows, nextMondayIso, TEAM_WORKWEEK_DAYS } from "../model/team-workweek-draft";
import { workweekStart } from "../model/team-workweek-week";
import { PrivateTeamWorkweekCard } from "./private-team-workweek-card";
import { PublishedTeamWorkweeksCard } from "./published-team-workweeks-card";

const profile = { id: "founder", name: "Alex", platformRole: "founder" as const, orgRole: "Founder", githubLogin: "alex", weeklyCapacity: 40, color: "#2563eb" };
function response(body: unknown, status = 200) { return { body, response: new Response(null, { status }) }; }
function fixture(mode: "unknown" | "navigation" | "delayed") {
  let posts = 0; let updated = false; let calendarReads = 0; let privateReads = 0; let conflictReads = 0; let navigate = () => {};
  let release!: () => void;
  const held = new Promise<void>(yes => { release = yes; });
  const publication = () => ({ id: updated ? "publication-after" : "publication-before", effectiveFrom: workweekStart(), status: "published" as const, syncState: "confirmed" as const, publicationRevision: updated ? 1 : 4, publishedAt: "2026-10-01T07:00:00Z", lastSyncAt: "2026-10-01T07:00:00Z", googleReconciliationState: mode === "delayed" && posts ? "delayed" : "confirmed", lastGoogleReconciliationAt: "2026-10-01T07:00:00Z" });
  const windows = () => Object.fromEntries(TEAM_WORKWEEK_DAYS.map(day => [day.key, [{ start: updated ? "11:00" : "09:00", end: "17:00" }]])) as ReturnType<typeof emptyTeamWorkweekWindows>;
  const apiClient = { requestJson: async (input: string, options?: { method?: string }) => {
    if (input.startsWith("/api/team-workweek/private-draft")) {
      privateReads++;
      if (mode === "navigation" && updated) return response({ error: "Bearbeitungskontext nicht erreichbar." }, 503);
      return response({ version: null, publication: null, latestPublished: publication(), minimumEffectiveFrom: nextMondayIso(), editBase: { windows: windows() },
        weekContext: { weekStart: workweekStart(), contextToken: "a".repeat(32), effectiveUntil: null, basePublicationId: publication().id, basePublicationRevision: publication().publicationRevision,
          windows: TEAM_WORKWEEK_DAYS.map(day => ({ weekday: day.weekday, startMinute: updated ? 660 : 540, endMinute: 1020 })) } });
    }
    if (input === "/api/team-workweek/conflict") { conflictReads++; return response({ conflict: null }); }
    if (input.startsWith("/api/team-workweek/team?")) {
      calendarReads++;
      const row = { ...publication(), ownerProfileId: profile.id, effectiveTo: null, timezone: "Europe/Berlin", windows: windows() };
      return response({ currentWorkweeks: [row], calendarWorkweeks: [row], referenceDate: workweekStart() });
    }
    if (input === "/api/team-workweek/reconcile" && options?.method === "POST") {
      posts++;
      if (mode === "navigation") { navigate(); await held; }
      if (mode !== "delayed") updated = true;
      if (mode === "unknown") throw new Error("Abgleichsantwort verloren.");
      return response({ reconciliation: { state: mode === "delayed" ? "delayed" : "updated", lastSuccessfulSyncAt: "2026-10-28T10:00:00Z", recovery: mode === "delayed" ? "reconnect" : null } }, mode === "delayed" ? 202 : 200);
    }
    if (input === "/api/google-workspace/status") return response({ connection: { state: "connected", calendarLabel: "calendar@example.test", connectedAt: null, refreshedAt: null, lastUsedAt: null, accessTokenExpiresAt: null } });
    if (input === "/api/google-workspace/disconnect") return response({ disconnect: { state: "idle", activePublicationCount: 1, futureSeriesCount: 0, pendingSeriesCount: 0, teamVisibilityWillBeDisabled: true } });
    throw new Error(`Unexpected fixture request: ${input}`);
  } } as BrowserApiClient;
  const owner = createPlanningState({ userId: "reconciliation-preview", initialData: { ...emptyPlanningShellState, profiles: [profile] }, adapter: {
    saveTask: async () => ({ task: {} }), readWorkspace: async () => null, ...privateWorkweekApi(apiClient),
    readWorkweekCalendar: scope => readPublishedWorkweekCalendar(apiClient, scope),
  } });
  return { apiClient, planning: owner.planning, posts: () => posts, privateReads: () => privateReads, conflictReads: () => conflictReads, calendarReads: () => calendarReads, release: () => release(), navigate: (callback: () => void) => { navigate = callback; } };
}
function ReconciliationJourney({ value }: { value: ReturnType<typeof fixture> }) {
  const [teamOpen, setTeamOpen] = useState(true);
  const state = useSyncExternalStore(value.planning.subscribe, value.planning.privateWorkweek, value.planning.privateWorkweek);
  useEffect(() => { value.navigate(() => setTeamOpen(false)); }, [value]);
  return <>
    <HeaderCalendarAction planningState={value.planning} events={{ data: [], state: "ready", error: "" }} profiles={[profile]} onOpenTeam={() => setTeamOpen(true)} />
    <PublishedTeamWorkweeksCard planningState={value.planning} profiles={[profile]} />
    {!teamOpen && <><p role="status">Abgleich: {state.reconciliation.phase}</p><button onClick={value.release}>Abgleich bestätigen</button><button onClick={() => setTeamOpen(true)}>Zum Team zurück</button></>}
    {teamOpen && <PrivateTeamWorkweekCard apiClient={value.apiClient} planningState={value.planning} profile={profile} />}
  </>;
}
const meta = { component: ReconciliationJourney, title: "Team Workweek/Molecules/PrivateTeamWorkweekReconciliation", tags: ["layer:molecule", "status:stable"], parameters: { layout: "fullscreen" } } satisfies Meta<typeof ReconciliationJourney>;
export default meta;
type Story = StoryObj<typeof meta>;

export const ChecksUnknownReconciliationWithoutProviderReplay: Story = {
  args: { value: fixture("unknown") },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    await canvas.findAllByText("09:00–17:00");
    await userEvent.click(await canvas.findByRole("button", { name: "App-Termine in Google prüfen" }));
    await expect(await canvas.findByText("Abgleichsbestätigung ausstehend")).toBeVisible();
    await userEvent.click(canvas.getByRole("button", { name: "Arbeitswoche bearbeiten" }));
    await userEvent.click(await canvas.findByRole("button", { name: "Aktuellen Stand laden" }));
    await expect(await canvas.findByText(/Die Abgleichsbestätigung bleibt ausstehend/)).toBeVisible();
    await expect(canvas.getByRole("button", { name: "Änderung in Google & Team veröffentlichen" })).toBeDisabled();
    await expect(args.value.posts()).toBe(1);
    await expect(args.value.planning.privateWorkweek().reconciliation.phase).toBe("unconfirmed");
    await expect(args.value.privateReads()).toBe(2);
    await expect(args.value.conflictReads()).toBe(2);
  },
};

export const RetainsUpdatedReconciliationAcrossNavigationAndFailedContextRefresh: Story = {
  args: { value: fixture("navigation") },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement); const body = within(document.body);
    await canvas.findAllByText("09:00–17:00");
    await userEvent.click(canvas.getByRole("button", { name: "Kalender öffnen" }));
    await userEvent.click(await body.findByRole("tab", { name: "Arbeitswoche" }));
    await within(body.getByRole("dialog", { name: "Kalender" })).findAllByText("09:00–17:00");
    await userEvent.keyboard("{Escape}");
    await userEvent.click(await canvas.findByRole("button", { name: "App-Termine in Google prüfen" }));
    await expect(await canvas.findByText("Abgleich: reconciling")).toBeVisible();
    await userEvent.click(canvas.getByRole("button", { name: "Abgleich bestätigen" }));
    await expect(await canvas.findByText("Abgleich: confirmed")).toBeVisible();
    await waitFor(() => expect(canvas.getAllByText("11:00–17:00").length).toBeGreaterThan(0));
    await userEvent.click(canvas.getByRole("button", { name: "Zum Team zurück" }));
    await expect(await canvas.findByText(/Der Google-Abgleich ist bestätigt.*Bearbeitungskontext nicht erreichbar/)).toBeVisible();
    await expect(args.value.planning.privateWorkweek()).toMatchObject({ reconciliation: { phase: "confirmed", result: { state: "updated" } }, contextRefreshRequired: true });
    await userEvent.click(canvas.getByRole("button", { name: "Kalender öffnen" }));
    await userEvent.click(await body.findByRole("tab", { name: "Arbeitswoche" }));
    const visibleTimes = (await within(body.getByRole("dialog", { name: "Kalender" })).findAllByText("11:00–17:00")).find(element => element.checkVisibility());
    await expect(visibleTimes).toBeVisible();
    await expect(args.value.posts()).toBe(1);
    await expect(args.value.calendarReads()).toBe(4);
    await expect(args.value.privateReads()).toBe(3);
    await expect(args.value.conflictReads()).toBe(3);
  },
};

export const KeepsTheOpenDraftWhileSharedReconciliationNeedsReconnection: Story = {
  args: { value: fixture("delayed") },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    await userEvent.click(await canvas.findByRole("button", { name: "Arbeitswoche bearbeiten" }));
    const end = await canvas.findByLabelText("Montag, Fenster 1, Ende");
    await userEvent.clear(end); await userEvent.type(end, "18:00");
    await args.value.planning.reconcileWorkweek(); await args.value.planning.loadPrivateWorkweek();
    await expect(await canvas.findByText(/Verbinde Google erneut/)).toBeVisible();
    await expect(end).toHaveValue("18:00");
    await expect(args.value.planning.privateWorkweek().reconciliation).toMatchObject({ phase: "delayed", result: { recovery: "reconnect" } });
    await expect(args.value.posts()).toBe(1);
  },
};
