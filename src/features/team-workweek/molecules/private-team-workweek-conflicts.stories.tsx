import { googleWorkspaceApi } from "@/features/team-workweek/model/google-workspace-api";
import { useSyncExternalStore } from "react";
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, userEvent, waitFor, within } from "storybook/test";
import { createPlanningState } from "@/features/planning/model/internal/planning-state-owner";
import { emptyPlanningShellState } from "@/features/planning/model/planning-shell-state";
import type { BrowserApiClient } from "@/lib/browser-api-client";
import type { TeamWorkweekConflict } from "../model/team-workweek-draft";
import { emptyTeamWorkweekWindows, nextMondayIso, TEAM_WORKWEEK_DAYS } from "../model/team-workweek-draft";
import { privateWorkweekApi } from "../model/private-workweek-api";
import { readPublishedWorkweekCalendar } from "../model/published-workweek-calendar-api";
import { workweekStart } from "../model/team-workweek-week";
import { PrivateTeamWorkweekCard } from "./private-team-workweek-card";
import { PublishedTeamWorkweeksCard } from "./published-team-workweeks-card";

const profile = { id: "founder", name: "Alex", platformRole: "founder" as const, orgRole: "Founder", githubLogin: "alex", weeklyCapacity: 40, color: "#2563eb" };
const response = (body: unknown, status = 200) => ({ body, response: new Response(null, { status }) });
function fixture(mode: "published" | "unknown" | "preparing") {
  let revision = 3; let posts = 0; let conflictReads = 0; let privateReads = 0; let published = false;
  let calendarReads = 0;
  let currentDecision: "google" | "founderops" | null = null;
  let input: unknown = null;
  const conflict = (): TeamWorkweekConflict => ({ id: "conflict", conflictRevision: revision, state: currentDecision ? "resolving" : "open", decision: currentDecision, observedAt: "2026-10-28T10:00:00Z",
    founderops: { effectiveFrom: nextMondayIso(), supported: true, windows: [{ weekday: 1, startMinute: 540, endMinute: 1020 }] },
    google: { effectiveFrom: nextMondayIso(), supported: true, windows: [{ weekday: 1, startMinute: revision === 3 ? 660 : 720, endMinute: 1020 }] } });
  const publication = () => ({ id: published ? "publication-after" : "publication-before", effectiveFrom: workweekStart(), status: "published" as const, syncState: "confirmed" as const, publicationRevision: published ? 1 : 4, publishedAt: "2026-10-28T10:00:00Z", lastSyncAt: "2026-10-28T10:00:00Z", googleReconciliationState: "confirmed", lastGoogleReconciliationAt: null });
  const windows = () => Object.fromEntries(TEAM_WORKWEEK_DAYS.map(day => [day.key, [{ start: published ? "12:00" : "09:00", end: "17:00" }]])) as ReturnType<typeof emptyTeamWorkweekWindows>;
  const apiClient = { requestJson: async (path: string, options?: { method?: string; json?: { decision: "google" | "founderops" } }) => {
    if (path.startsWith("/api/team-workweek/private-draft")) {
      privateReads++;
      return response({ version: null, publication: null, latestPublished: publication(), minimumEffectiveFrom: nextMondayIso(), editBase: { windows: windows() },
        weekContext: { weekStart: workweekStart(), contextToken: "a".repeat(32), effectiveUntil: null, basePublicationId: publication().id, basePublicationRevision: publication().publicationRevision, windows: TEAM_WORKWEEK_DAYS.map(day => ({ weekday: day.weekday, startMinute: published ? 720 : 540, endMinute: 1020 })) } });
    }
    if (path === "/api/team-workweek/conflict") {
      if (options?.method !== "POST") { conflictReads++; return response({ conflict: published ? null : conflict() }); }
      posts++; input = options.json;
      if (mode === "unknown") throw new Error("Konfliktantwort verloren.");
      currentDecision = options.json!.decision;
      published = mode === "published";
      return response({ publication: { ...publication(), status: published ? "published" : "preparing", syncState: published ? "confirmed" : "delayed", recovery: published ? null : "reconnect" } }, published ? 200 : 202);
    }
    if (path.startsWith("/api/team-workweek/team?")) {
      calendarReads++;
      const row = { ...publication(), ownerProfileId: profile.id, effectiveTo: null, timezone: "Europe/Berlin", windows: windows() };
      return response({ currentWorkweeks: [row], calendarWorkweeks: [row], referenceDate: workweekStart() });
    }
    if (path === "/api/google-workspace/status") return response({ connection: { state: "connected", calendarLabel: "calendar@example.test", connectedAt: null, refreshedAt: null, lastUsedAt: null, accessTokenExpiresAt: null } });
    if (path === "/api/google-workspace/disconnect") return response({ disconnect: { state: "idle", activePublicationCount: 1, futureSeriesCount: 0, pendingSeriesCount: 0, teamVisibilityWillBeDisabled: true } });
    throw new Error(`Unexpected fixture request: ${path}`);
  } } as BrowserApiClient;
  const owner = createPlanningState({ userId: "conflict-preview", initialData: { ...emptyPlanningShellState, profiles: [profile] }, adapter: {
    saveTask: async () => ({ task: {} }), readWorkspace: async () => null, ...privateWorkweekApi(apiClient), ...googleWorkspaceApi(apiClient), readWorkweekCalendar: scope => readPublishedWorkweekCalendar(apiClient, scope),
  } });
  return { apiClient, planning: owner.planning, replaceSession: () => owner.internal.sessionChanged("replacement"), advance: () => { revision++; }, posts: () => posts, calendarReads: () => calendarReads, input: () => input, reads: () => ({ private: privateReads, conflict: conflictReads }) };
}
function ConflictJourney({ value }: { value: ReturnType<typeof fixture> }) {
  useSyncExternalStore(value.planning.subscribe, value.planning.privateWorkweek, value.planning.privateWorkweek);
  return <><PublishedTeamWorkweeksCard planningState={value.planning} profiles={[profile]} /><PrivateTeamWorkweekCard apiClient={value.apiClient} planningState={value.planning} profile={profile} /></>;
}
const meta = { component: ConflictJourney, title: "Team Workweek/Molecules/PrivateTeamWorkweekConflicts", tags: ["layer:molecule", "status:stable"], parameters: { layout: "fullscreen" } } satisfies Meta<typeof ConflictJourney>;
export default meta;
type Story = StoryObj<typeof meta>;

export const PinsDisplayedRevisionUntilExplicitRefresh: Story = {
  args: { value: fixture("published") },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    await canvas.findByText(/Montag: 11:00–17:00/);
    args.value.advance(); await args.value.planning.loadWorkweekConflict();
    await expect(canvas.getByText(/Montag: 11:00–17:00/)).toBeVisible();
    await expect(canvas.getByRole("button", { name: "Google übernehmen" })).toBeDisabled();
    const check = canvas.getByRole("button", { name: "Konfliktstand prüfen" });
    await expect(check.getBoundingClientRect().height).toBeGreaterThanOrEqual(44);
    await userEvent.click(check);
    await expect(await canvas.findByText(/Montag: 12:00–17:00/)).toBeVisible();
    await userEvent.click(canvas.getByRole("button", { name: "Google übernehmen" }));
    await expect(args.value.input()).toEqual({ conflictId: "conflict", conflictRevision: 4, decision: "google" });
    await waitFor(() => expect(canvas.getAllByText("12:00–17:00").length).toBeGreaterThan(0));
    await expect(canvas.queryByRole("button", { name: "Google übernehmen" })).not.toBeInTheDocument();
    await expect(args.value.posts()).toBe(1);
    await waitFor(() => expect(args.value.calendarReads()).toBe(2));
  },
};

export const ChecksUnknownDecisionWithoutRepeatingIt: Story = {
  args: { value: fixture("unknown") },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    await userEvent.click(await canvas.findByRole("button", { name: "Google übernehmen" }));
    await expect(await canvas.findByText("Auswahl noch unklar")).toBeVisible();
    await userEvent.click(canvas.getByRole("button", { name: "Konfliktstand prüfen" }));
    await expect(canvas.getByRole("button", { name: "Google übernehmen" })).toBeDisabled();
    await expect(canvas.getByRole("button", { name: "FounderOps übernehmen" })).toBeDisabled();
    await expect(args.value.posts()).toBe(1);
    await expect(args.value.reads()).toEqual({ private: 2, conflict: 2 });
    await expect(args.value.calendarReads()).toBe(1);
    await expect(args.value.planning.privateWorkweek().conflictDecision).toMatchObject({ phase: "unconfirmed", checked: true, submitted: { conflictRevision: 3, decision: "google" } });
  },
};

export const KeepsBoundDraftAndTeamBaselineWhileDecisionNeedsReconnection: Story = {
  args: { value: fixture("preparing") },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    await userEvent.click(await canvas.findByRole("button", { name: "Arbeitswoche bearbeiten" }));
    const end = await canvas.findByLabelText("Montag, Fenster 1, Ende");
    await userEvent.clear(end); await userEvent.type(end, "18:00");
    const basis = args.value.planning.privateWorkweek().conflict!;
    await args.value.planning.resolveWorkweekConflict(basis, "google"); await args.value.planning.loadPrivateWorkweek();
    await expect(await canvas.findByText(/Verbinde Google erneut/)).toBeVisible();
    await expect(end).toHaveValue("18:00");
    await expect(args.value.planning.privateWorkweek()).toMatchObject({ conflictDecision: { phase: "preparing", submitted: { decision: "google" } }, context: { latestPublished: { id: "publication-before" } } });
    await expect(args.value.posts()).toBe(1);
    await expect(args.value.calendarReads()).toBe(1);
  },
};


export const WithholdsDisplayedConflictOnSessionReplacement: Story = {
  args: { value: fixture("published") },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    await canvas.findByText(/Montag: 11:00–17:00/);
    args.value.replaceSession();
    await waitFor(() => expect(canvas.queryByText(/Montag: 11:00–17:00/)).not.toBeInTheDocument());
    await expect(canvas.queryByRole("button", { name: "Google übernehmen" })).not.toBeInTheDocument();
    await expect(args.value.planning.privateWorkweek().conflict).toBeNull();
  },
};
