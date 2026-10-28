import { useState, useSyncExternalStore } from "react";
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, fireEvent, userEvent, waitFor, within } from "storybook/test";
import type { BrowserApiClient } from "@/lib/browser-api-client";
import { createPlanningState } from "@/features/planning/model/internal/planning-state-owner";
import { emptyPlanningShellState } from "@/features/planning/model/planning-shell-state";
import { googleWorkspaceApi } from "../model/google-workspace-api";
import { privateWorkweekApi } from "../model/private-workweek-api";
import { readPublishedWorkweekCalendar } from "../model/published-workweek-calendar-api";
import { emptyTeamWorkweekWindows, nextMondayIso } from "../model/team-workweek-draft";
import { workweekStart } from "../model/team-workweek-week";
import { GoogleWorkspaceConnectionCard } from "./google-workspace-connection-card";
import { PrivateTeamWorkweekCard } from "./private-team-workweek-card";
import { PublishedTeamWorkweeksCard } from "./published-team-workweeks-card";
const profile = { id: "owner", name: "Alex", platformRole: "founder" as const, orgRole: "Founder", githubLogin: "alex", weeklyCapacity: 40, color: "#2563eb" };
const response = (body: unknown, status = 200) => ({ body, response: new Response(null, { status }) });
function fixture(mode: "preview" | "completed" | "unknown" | "partial") {
  const calls = { status: 0, preview: 0, disconnect: 0, calendar: 0, private: 0, conflict: 0, publish: 0 };
  let count = 2; let changed = false; let finish!: () => void;
  const waiting = new Promise<void>(resolve => { finish = resolve; });
  const windows = { ...emptyTeamWorkweekWindows(), monday: [{ start: "09:00", end: "17:00" }] };
  const publication = { id: "22222222-2222-4222-8222-222222222222", status: "published", syncState: "confirmed", effectiveFrom: workweekStart(), publicationRevision: 3, publishedAt: "2026-10-28T10:00:00Z", lastSyncAt: "2026-10-28T10:00:00Z", googleReconciliationState: "confirmed", lastGoogleReconciliationAt: null };
  const apiClient = { requestJson: async (path: string, options?: { method?: string }) => {
    if (path === "/api/google-workspace/status") { calls.status++;
      if (changed && mode === "completed") return response({ error: "Status vorübergehend nicht erreichbar" }, 503);
      return response({ connection: { state: changed ? "not_connected" : "connected", calendarLabel: "calendar@example.test", connectedAt: null, refreshedAt: null, lastUsedAt: null, accessTokenExpiresAt: null }, disconnectPending: changed && mode === "partial" });
    }
    if (path === "/api/google-workspace/disconnect") {
      if (options?.method !== "POST") { calls.preview++; return response({ disconnect: { state: changed && mode === "partial" ? "remove_pending" : "idle", activePublicationCount: changed ? 0 : 1, futureSeriesCount: count, pendingSeriesCount: 0, teamVisibilityWillBeDisabled: !changed } }); }
      calls.disconnect++;
      if (mode === "completed") await waiting;
      changed = true;
      if (mode === "unknown") throw new Error("Trennungsantwort verloren");
      return response({ result: { state: mode === "partial" ? "remove_pending" : "completed", recovery: mode === "partial" ? "retry" : null } }, mode === "partial" ? 202 : 200);
    }
    if (path.startsWith("/api/team-workweek/team?")) { calls.calendar++; const row = { ...publication, ownerProfileId: profile.id, effectiveTo: null, timezone: "Europe/Berlin", windows }; return response({ currentWorkweeks: changed ? [] : [row], calendarWorkweeks: changed ? [] : [row], referenceDate: workweekStart() }); }
    if (path.startsWith("/api/team-workweek/private-draft")) { calls.private++; return response({ version: { id: "private-version", effectiveFrom: workweekStart(), activationMode: "immediate", status: "preparing", timezone: "Europe/Berlin", createdAt: "2026-10-28T10:00:00Z", windows }, latestPublished: publication, publication: null, minimumEffectiveFrom: nextMondayIso(), editBase: { windows } }); }
    if (path === "/api/team-workweek/conflict") { calls.conflict++; return response({ conflict: null }); }
    if (path === "/api/team-workweek/publish") { calls.publish++; throw new Error("Private input must not be published during cleanup"); }
    throw new Error(`Unexpected fixture request: ${path}`);
  } } as BrowserApiClient;
  const { planning, internal } = createPlanningState({ userId: "disconnect-owner", initialData: { ...emptyPlanningShellState, profiles: [profile] }, adapter: { saveTask: async () => ({ task: {} }), readWorkspace: async () => null, ...googleWorkspaceApi(apiClient), ...privateWorkweekApi(apiClient), readWorkweekCalendar: scope => readPublishedWorkweekCalendar(apiClient, scope) } });
  return { apiClient, planning, mode, calls, finish, replaceSession: () => internal.sessionChanged("replacement"), advance: () => { count = 4; } };
}
function DisconnectJourney({ value }: { value: ReturnType<typeof fixture> }) {
  const [away, setAway] = useState(false);
  useSyncExternalStore(value.planning.subscribe, value.planning.googleWorkspace, value.planning.googleWorkspace);
  return <><button onClick={() => setAway(!away)}>{away ? "Zurück zum Team" : "Anderen Bereich öffnen"}</button><button onClick={value.finish}>Antwort bestätigen</button><PublishedTeamWorkweeksCard planningState={value.planning} profiles={[profile]} />{!away && (value.mode === "partial" ? <PrivateTeamWorkweekCard apiClient={value.apiClient} planningState={value.planning} profile={profile} editorRequested /> : <GoogleWorkspaceConnectionCard planningState={value.planning} profile={profile} />)}</>;
}
const meta = { component: DisconnectJourney, title: "Team Workweek/Molecules/GoogleWorkspaceDisconnectState", tags: ["layer:molecule", "status:stable"], parameters: { layout: "fullscreen" } } satisfies Meta<typeof DisconnectJourney>;
export default meta;
type Story = StoryObj<typeof meta>;
async function openPreview(canvas: ReturnType<typeof within>) { await userEvent.click(await canvas.findByRole("button", { name: "Verbindung trennen" })); const dialog = within(await canvas.findByRole("alertdialog")); await waitFor(() => expect(dialog.getByRole("button", { name: "Verbindung trennen" })).toBeEnabled()); return dialog; }

export const RetainsOriginalPreviewDuringBackgroundRefresh: Story = {
  args: { value: fixture("preview") },
  play: async ({ canvasElement, args }) => { const canvas = within(canvasElement); const dialog = await openPreview(canvas);
    await expect(dialog.getByText(/2 zukünftige eindeutig markierte/)).toBeVisible(); args.value.advance(); await args.value.planning.loadGoogleDisconnectPreview();
    await expect(dialog.getByText(/2 zukünftige eindeutig markierte/)).toBeVisible(); await expect(dialog.queryByText(/4 zukünftige eindeutig markierte/)).not.toBeInTheDocument();
    await expect(dialog.getByRole("button", { name: "Verbindung trennen" })).toBeDisabled(); await expect(args.value.calls.disconnect).toBe(0);
  },
};
export const KeepsCompletedDisconnectAcrossNavigationAndFailedStatus: Story = {
  args: { value: fixture("completed") },
  play: async ({ canvasElement, args }) => { const canvas = within(canvasElement); const dialog = await openPreview(canvas); await userEvent.click(dialog.getByRole("button", { name: "Verbindung trennen" }));
    await expect(args.value.planning.googleWorkspace().operation.phase).toBe("disconnecting"); await userEvent.click(canvas.getByRole("button", { name: "Anderen Bereich öffnen" }));
    await userEvent.click(canvas.getByRole("button", { name: "Antwort bestätigen" })); await waitFor(() => expect(args.value.planning.googleWorkspace().operation.phase).toBe("completed"));
    await userEvent.click(canvas.getByRole("button", { name: "Zurück zum Team" })); await expect(await canvas.findByText(/Google-Verbindung getrennt.*Status vorübergehend/)).toBeVisible();
    await waitFor(() => expect(args.value.calls.status).toBe(3)); await waitFor(() => expect(args.value.calls.calendar).toBe(2));
    await expect(args.value.calls).toEqual({ status: 3, preview: 1, disconnect: 1, calendar: 2, private: 0, conflict: 0, publish: 0 });
    await expect(args.value.planning.googleWorkspace().connection?.state).toBe("not_connected");
  },
};
export const ChecksUnknownDisconnectWithoutProviderReplay: Story = {
  args: { value: fixture("unknown") },
  play: async ({ canvasElement, args }) => { const canvas = within(canvasElement); const dialog = await openPreview(canvas); await userEvent.click(dialog.getByRole("button", { name: "Verbindung trennen" }));
    await expect(await canvas.findByText(/Die Trennungsbestätigung ist ausstehend/)).toBeVisible(); await userEvent.click(canvas.getByRole("button", { name: "Erneut prüfen" }));
    await expect(await canvas.findByText("Nicht verbunden")).toBeVisible(); await expect(args.value.planning.googleWorkspace()).toMatchObject({ operation: { phase: "unconfirmed", checked: true }, canContinue: false });
    await expect(canvas.queryByText(/Google-Verbindung getrennt/)).not.toBeInTheDocument(); await waitFor(() => expect(args.value.calls.calendar).toBe(2));
    await expect(args.value.calls).toEqual({ status: 2, preview: 1, disconnect: 1, calendar: 2, private: 0, conflict: 0, publish: 0 });
  },
};
export const RetainsPrivateDraftWhileConnectionRemovalIsPending: Story = {
  args: { value: fixture("partial") },
  play: async ({ canvasElement, args }) => { const canvas = within(canvasElement); const end = await canvas.findByLabelText("Montag, Fenster 1, Ende"); await fireEvent.change(end, { target: { value: "18:00" } });
    const dialog = await openPreview(canvas); await userEvent.click(dialog.getByRole("button", { name: "Verbindung trennen" }));
    await expect(await canvas.findByRole("button", { name: "Bereinigung fortsetzen" })).toBeEnabled(); await expect(end).toHaveValue("18:00");
    await expect(canvas.getByRole("button", { name: "Änderung in Google & Team veröffentlichen" })).toBeDisabled();
    await expect(args.value.planning.googleWorkspace()).toMatchObject({ operation: { phase: "partial", result: { state: "remove_pending" } }, connection: { state: "not_connected" } });
    await expect(args.value.planning.privateWorkweek().context?.version?.id).toBe("private-version");
    await waitFor(() => expect(args.value.calls.preview).toBe(2)); await waitFor(() => expect(args.value.calls.calendar).toBe(2));
    await expect(args.value.calls).toEqual({ status: 2, preview: 2, disconnect: 1, calendar: 2, private: 1, conflict: 1, publish: 0 });
  },
};


export const WithholdsDisplayedPreviewOnAccountReplacement: Story = {
  args: { value: fixture("preview") },
  play: async ({ canvasElement, args }) => { const canvas = within(canvasElement); const dialog = await openPreview(canvas);
    await expect(dialog.getByText(/2 zukünftige eindeutig markierte/)).toBeVisible(); args.value.replaceSession();
    await waitFor(() => expect(dialog.queryByText(/2 zukünftige eindeutig markierte/)).not.toBeInTheDocument());
    await expect(dialog.getByRole("button", { name: /Verbindung trennen|Trennung läuft/ })).toBeDisabled();
  },
};
