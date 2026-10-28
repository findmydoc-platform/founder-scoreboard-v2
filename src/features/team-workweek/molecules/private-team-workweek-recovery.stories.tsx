import { googleWorkspaceApi } from "@/features/team-workweek/model/google-workspace-api";
import { useState, useSyncExternalStore } from "react";
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, fireEvent, userEvent, waitFor, within } from "storybook/test";
import { createPlanningState } from "@/features/planning/model/internal/planning-state-owner";
import { emptyPlanningShellState } from "@/features/planning/model/planning-shell-state";
import type { BrowserApiClient } from "@/lib/browser-api-client";
import { privateWorkweekApi } from "../model/private-workweek-api";
import { readPublishedWorkweekCalendar } from "../model/published-workweek-calendar-api";
import { emptyTeamWorkweekWindows, nextMondayIso } from "../model/team-workweek-draft";
import { addCalendarDays } from "../model/team-workweek-calendar";
import { workweekLabel, workweekStart } from "../model/team-workweek-week";
import { PrivateTeamWorkweekCard } from "./private-team-workweek-card";
import { PublishedTeamWorkweeksCard } from "./published-team-workweeks-card";

const profile = { id: "owner", name: "Alex", platformRole: "founder" as const, orgRole: "Founder", githubLogin: "alex", weeklyCapacity: 40, color: "#2563eb" };
const response = (body: unknown, status = 200) => ({ body, response: new Response(null, { status }) });
const viewedWeek = () => addCalendarDays(nextMondayIso(), 7);
function fixture(mode: "resume" | "delayed" | "unknown") {
  const calls = { private: 0, conflict: 0, calendar: 0, resume: 0, restart: 0, save: 0 };
  let restarted = false; let published = false; let failContext = false; let savedInput: Record<string, unknown> | null = null;
  const windows = { ...emptyTeamWorkweekWindows(), monday: [{ start: "09:00", end: "17:00" }] };
  const source = () => ({ id: restarted ? "restarted-private" : "original-private", effectiveFrom: workweekStart(), timezone: "Europe/Berlin", activationMode: "immediate", status: "preparing", createdAt: "2026-10-28T09:00:00Z", windows });
  const publication = () => ({ id: published ? "earlier-publication" : "22222222-2222-4222-8222-222222222222", effectiveFrom: workweekStart(), status: "published", syncState: "confirmed", publicationRevision: published ? 3 : 2, publishedAt: "2026-10-28T10:00:00Z", lastSyncAt: "2026-10-28T10:00:00Z", googleReconciliationState: "confirmed", lastGoogleReconciliationAt: null });
  const apiClient = { requestJson: async (path: string, options?: { method?: string; json?: Record<string, unknown> }) => {
    if (path.startsWith("/api/team-workweek/private-draft")) {
      if (options?.method === "POST") { calls.save++; savedInput = options.json!; return response({ version: { ...source(), id: "newly-saved-private", ...savedInput } }, 201); }
      calls.private++;
      if (failContext) { failContext = false; return response({ error: "Bearbeitungskontext nicht erreichbar" }, 503); }
      const week = new URL(path, "http://localhost:3000").searchParams.get("week") || viewedWeek();
      return response({ version: source(), publication: null, latestPublished: publication(), minimumEffectiveFrom: nextMondayIso(), immediateAllowed: true,
        restartAvailable: mode !== "resume" && !restarted, editBase: { windows },
        pendingPublication: mode === "resume" && !published ? { id: "earlier-publication", sourceVersionId: "earlier-private", effectiveFrom: nextMondayIso(), resumeAllowed: true } : null,
        weekContext: { weekStart: week, contextToken: restarted ? "fresh-current-token" : "original-current-token", effectiveUntil: null, basePublicationId: publication().id, basePublicationRevision: publication().publicationRevision, windows: [{ weekday: 1, startMinute: 540, endMinute: 1020 }] } });
    }
    if (path === "/api/team-workweek/conflict") { calls.conflict++; return response({ conflict: null }); }
    if (path === "/api/team-workweek/restart") {
      calls.restart++;
      if (mode === "delayed") return response({ restart: { state: "delayed", recovery: "retry", reason: "uncertain" } }, 202);
      restarted = true; throw new Error("Neustartantwort verloren");
    }
    if (path === "/api/team-workweek/publish") {
      calls.resume++; published = true; failContext = true;
      await expect(options?.json).toEqual({ versionId: "earlier-private" });
      return response({ publication: { ...publication(), recovery: null } });
    }
    if (path.startsWith("/api/team-workweek/team?")) {
      calls.calendar++;
      const row = { ...publication(), ownerProfileId: profile.id, effectiveTo: null, timezone: "Europe/Berlin", windows: { ...windows, monday: [{ start: published ? "11:00" : "09:00", end: "17:00" }] } };
      return response({ currentWorkweeks: [row], calendarWorkweeks: [row], referenceDate: workweekStart() });
    }
    if (path === "/api/google-workspace/status") return response({ connection: { state: "connected", calendarLabel: "calendar@example.test" } });
    if (path === "/api/google-workspace/disconnect") return response({ disconnect: { state: "idle", activePublicationCount: 1, futureSeriesCount: 0, pendingSeriesCount: 0, teamVisibilityWillBeDisabled: true } });
    throw new Error(`Unexpected fixture request: ${path}`);
  } } as BrowserApiClient;
  const { planning } = createPlanningState({ userId: "recovery-owner", initialData: { ...emptyPlanningShellState, profiles: [profile] }, adapter: {
    saveTask: async () => ({ task: {} }), readWorkspace: async () => null, ...privateWorkweekApi(apiClient), ...googleWorkspaceApi(apiClient), readWorkweekCalendar: scope => readPublishedWorkweekCalendar(apiClient, scope),
  } });
  return { apiClient, planning, calls, savedInput: () => savedInput };
}
function RecoveryJourney({ value }: { value: ReturnType<typeof fixture> }) {
  const [away, setAway] = useState(false);
  useSyncExternalStore(value.planning.subscribe, value.planning.privateWorkweek, value.planning.privateWorkweek);
  return <><button onClick={() => setAway(!away)}>{away ? "Zurück zum Team" : "Anderen Bereich öffnen"}</button><PublishedTeamWorkweeksCard planningState={value.planning} profiles={[profile]} />{!away && <PrivateTeamWorkweekCard apiClient={value.apiClient} planningState={value.planning} profile={profile} editorRequested editorWeek={viewedWeek()} />}</>;
}
const meta = { component: RecoveryJourney, title: "Team Workweek/Molecules/PrivateTeamWorkweekRecovery", tags: ["layer:molecule", "status:stable"], parameters: { layout: "fullscreen" } } satisfies Meta<typeof RecoveryJourney>;
export default meta;
type Story = StoryObj<typeof meta>;

export const RetainsEarlierConfirmationWhenContextRefreshFails: Story = {
  args: { value: fixture("resume") },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    const end = await canvas.findByLabelText("Montag, Fenster 1, Ende"); await fireEvent.change(end, { target: { value: "18:00" } });
    await expect(end).toHaveValue("18:00");
    await userEvent.click(canvas.getByRole("button", { name: "Offene Veröffentlichung fortsetzen" }));
    await expect(await canvas.findByText(/Die frühere Veröffentlichung ist bestätigt. Lade den aktuellen Stand/)).toBeVisible();
    await expect(end).toHaveValue("18:00");
    await expect(canvas.getByRole("combobox", { name: "Arbeitswoche auswählen" })).toHaveAttribute("title", workweekLabel(viewedWeek()));
    await expect(args.value.planning.privateWorkweek()).toMatchObject({ resume: { phase: "confirmed", submitted: { publicationId: "earlier-publication", versionId: "earlier-private" } }, confirmedPublication: { id: "earlier-publication", publicationRevision: 3 }, context: { version: { id: "original-private" } }, contextRefreshRequired: true });
    await waitFor(() => expect(args.value.calls.calendar).toBe(2));
    await expect(args.value.calls).toEqual({ private: 2, conflict: 2, calendar: 2, resume: 1, restart: 0, save: 0 });
  },
};

export const RetainsDelayedRestartAcrossNavigation: Story = {
  args: { value: fixture("delayed") },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    const end = await canvas.findByLabelText("Montag, Fenster 1, Ende"); await fireEvent.change(end, { target: { value: "18:00" } });
    await expect(end).toHaveValue("18:00");
    await userEvent.click(canvas.getByRole("button", { name: "Mit aktuellem Stand neu beginnen" }));
    await expect(await canvas.findByText(/Google hat die letzte Anfrage noch nicht eindeutig bestätigt/)).toBeVisible(); await expect(end).toHaveValue("18:00");
    await userEvent.click(canvas.getByRole("button", { name: "Anderen Bereich öffnen" })); await userEvent.click(canvas.getByRole("button", { name: "Zurück zum Team" }));
    await expect(await canvas.findByText(/Google hat die letzte Anfrage noch nicht eindeutig bestätigt/)).toBeVisible();
    await expect(args.value.planning.privateWorkweek()).toMatchObject({ restart: { phase: "delayed", submitted: { versionId: "original-private" }, result: { restart: { reason: "uncertain" } } }, context: { latestPublished: { id: "22222222-2222-4222-8222-222222222222" } } });
    await expect(args.value.calls.restart).toBe(1); await expect(args.value.calls.resume).toBe(0); await expect(args.value.calls.calendar).toBe(1);
  },
};

export const ChecksUnknownRestartThenSavesNewBoundInputWithoutReplay: Story = {
  args: { value: fixture("unknown") },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    const end = await canvas.findByLabelText("Montag, Fenster 1, Ende"); await fireEvent.change(end, { target: { value: "18:00" } });
    await expect(end).toHaveValue("18:00");
    await userEvent.click(canvas.getByRole("button", { name: "Mit aktuellem Stand neu beginnen" }));
    await expect(await canvas.findByText("Neustartbestätigung ausstehend")).toBeVisible();
    await userEvent.click(canvas.getByRole("button", { name: "Aktuellen Stand laden" }));
    await expect(end).toHaveValue("18:00");
    await expect(canvas.getByRole("combobox", { name: "Arbeitswoche auswählen" })).toHaveAttribute("title", workweekLabel(viewedWeek()));
    await expect(args.value.planning.privateWorkweek()).toMatchObject({ restart: { phase: "unconfirmed", checked: true }, currentContextReady: true });
    await expect(canvas.getByRole("button", { name: "Entwurf speichern" })).toBeEnabled();
    await userEvent.click(canvas.getByRole("button", { name: "Entwurf speichern" }));
    await expect(args.value.calls.save).toBe(1);
    await expect(await canvas.findByText("Entwurf gespeichert. Noch nicht veröffentlicht.")).toBeVisible();
    await expect(args.value.savedInput()).toMatchObject({ selectedWeekStart: viewedWeek(), contextToken: "fresh-current-token", windows: { monday: [{ start: "09:00", end: "18:00" }] } });
    await expect(args.value.calls).toEqual({ private: 2, conflict: 2, calendar: 1, restart: 1, resume: 0, save: 1 });
    await expect(args.value.planning.privateWorkweek().restart.phase).toBe("unconfirmed");
  },
};
