import { act, useEffect, useState, useSyncExternalStore } from "react";
import { vi, expect as schedulingExpect } from "vitest";
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, userEvent, waitFor, within } from "storybook/test";
import { createPlanningState } from "@/features/planning/model/internal/planning-state-owner";
import { emptyPlanningShellState } from "@/features/planning/model/planning-shell-state";
import { useOwnProfileSettingsCommands } from "../hooks/use-own-profile-settings-commands";
import { defaultFilters } from "../model/profile-settings-view-model";
import { ProfileSettingsOverview } from "./profile-settings-overview";
import type { PlanningItemCandidateReceipt } from "@/features/planning-items/model/planning-item-candidates";
import type { Profile, ProfileUiPreference } from "@/lib/types";

const profile: Profile = { id: "profile-options-owner", name: "Ada", focus: "Saved focus", color: "#64748b", platformRole: "founder", orgRole: "Founder", githubLogin: "", notificationsEnabled: true, weeklyCapacity: 37 };
const preference: ProfileUiPreference = { profileId: profile.id, defaultWorkspace: "planning", defaultTaskView: "board",
  planningFilters: { ...defaultFilters(), initiativeId: "saved-filter-outside-page" }, expandedInitiativeIds: ["saved-expanded-outside-page"], createdAt: "before", updatedAt: "before" };
const initial = { ...emptyPlanningShellState, profiles: [profile], profileUiPreferences: [preference] };

function ProfileOptionsFixture({ mode = "held" }: { mode?: "held" | "retry" | "query" | "empty" | "scheduling" }) {
  const [saved, setSaved] = useState<ProfileUiPreference>();
  const [candidateReads, setCandidateReads] = useState(0);
  const [queries, setQueries] = useState<string[]>([]);
  const [bundle] = useState(() => {
    const now = Date.now(), deadline = now + 60_000;
    const session = { userId: "profile-options-account", user: { id: "profile-options-account" }, revision: "original-profile-options-session", expiresAt: (now + 3_600_000) / 1000 };
    let release!: (value: PlanningItemCandidateReceipt) => void;
    const held = new Promise<PlanningItemCandidateReceipt>(resolve => { release = resolve; });
    const page: PlanningItemCandidateReceipt = { candidates: { kind: "initiative", items: Array.from({ length: 20 }, (_, index) => ({
      id: `discovered-initiative-${index}`, title: `Discovered initiative ${index}`, taskType: "initiative" as const, parentTaskId: "", approvalStatus: "approved", updatedAt: "2026-11-19T00:00:00Z",
    })), total: mode === "retry" ? 22 : 21, coverage: "partial", continuation: "next-profile-options-page", sourceRevision: "profile-options-source", observedAt: new Date(now).toISOString(), validUntil: new Date(deadline).toISOString() },
      readAuthority: { userId: session.userId, deadline }, readActor: { profileId: profile.id, platformRole: profile.platformRole } };
    let attempts = 0;
    const owner = createPlanningState({ userId: session.userId, initialSession: session, initialCurrentProfile: profile,
      initialData: initial, initialWorkspace: "profile", adapter: {
        saveTask: async () => ({ task: {} }), readWorkspace: async () => { throw new Error("Profile options must not enumerate a Workspace"); },
        readCandidates: async query => {
          if (query.kind !== "initiative" || query.limit !== 20) throw new Error("Unexpected Profile discovery scope");
          setCandidateReads(count => count + 1);
          setQueries(current => [...current, query.query]);
          attempts++;
          if (mode === "scheduling") return { ...page, candidates: { ...page.candidates, items: [], total: 0, coverage: "complete", continuation: null, observedAt: new Date().toISOString(), validUntil: new Date(Date.now() + 500).toISOString() } };
          if (mode === "retry") {
            if (attempts === 1) throw Object.assign(new Error("Initiative discovery unavailable"), { status: 503 });
            if (query.continuation) return { ...page, candidates: { ...page.candidates, coverage: "complete", continuation: null, items: [
              { id: preference.planningFilters.initiativeId, title: "Saved filter Initiative", taskType: "initiative", parentTaskId: "", approvalStatus: "approved", updatedAt: "2026-11-19T00:00:00Z" },
              { id: preference.expandedInitiativeIds[0], title: "Saved expanded Initiative", taskType: "initiative", parentTaskId: "", approvalStatus: "approved", updatedAt: "2026-11-19T00:00:00Z" },
            ] } };
            return page;
          }
          if (mode === "empty") return { ...page, candidates: { ...page.candidates, items: [], total: 0, coverage: "complete", continuation: null } };
          if (mode === "query" && query.query) return { ...page, candidates: { ...page.candidates, items: [{ id: "current-query-initiative", title: "Current query Initiative", taskType: "initiative", parentTaskId: "", approvalStatus: "approved", updatedAt: "2026-11-19T00:00:00Z" }], total: 1, coverage: "complete", continuation: null } };
          return held;
        },
        saveOwnProfileSettings: async patch => {
          const uiPreference = { ...preference, ...patch.uiPreferences, updatedAt: "saved" };
          setSaved(uiPreference);
          return { profile: { ...profile, ...patch.profilePatch }, uiPreference, notificationPreferences: [] };
        },
      } });
    return { ...owner, release: () => release(page) };
  });
  useEffect(() => () => { bundle.release(); bundle.internal.dispose(); }, [bundle]);
  const data = useSyncExternalStore(bundle.planning.subscribe, bundle.internal.getSnapshot, bundle.internal.getSnapshot);
  const [error, setSaveError] = useState("");
  const { saveOwnProfileSettings } = useOwnProfileSettingsCommands({ planningState: bundle.planning, currentProfile: profile, setSaveError });
  return <div className="p-4">
    <p role="status">{error}</p>
    <output aria-label="Initiative discovery reads">{candidateReads}</output>
    <output aria-label="Initiative discovery queries">{JSON.stringify(queries)}</output>
    <output aria-label="Saved Initiative filter">{saved?.planningFilters.initiativeId || "not-saved"}</output>
    <output aria-label="Saved expanded Initiatives">{saved?.expandedInitiativeIds.join(",") || "not-saved"}</output>
    <button type="button" onClick={bundle.release}>Erste Initiativenseite freigeben</button>
    <ProfileSettingsOverview planningState={bundle.planning} currentProfile={data.profiles[0] || profile} data={data} pending={false} source="supabase" onSaveOwnProfileSettings={saveOwnProfileSettings} />
  </div>;
}
const meta = { title: "Features/Profile/Independent Initiative options", component: ProfileOptionsFixture, parameters: { layout: "fullscreen" } } satisfies Meta<typeof ProfileOptionsFixture>;
export default meta;
type Story = StoryObj<typeof meta>;

export const SavesFocusWithoutLosingOffPageInitiativePreferences: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const focus = canvas.getByRole("textbox");
    await userEvent.clear(focus);
    await userEvent.type(focus, "Independent focus draft");
    await userEvent.click(canvas.getByRole("button", { name: /^Speichern$/ }));
    await expect(canvas.getByText("Gespeichert.")).toBeVisible();
    await expect(focus).toHaveValue("Independent focus draft");
    await expect(canvas.getByLabelText("Saved Initiative filter")).toHaveTextContent(/^saved-filter-outside-page$/);
    await expect(canvas.getByLabelText("Saved expanded Initiatives")).toHaveTextContent(/^saved-expanded-outside-page$/);
    await userEvent.click(within(canvas.getByRole("navigation", { name: "Profilbereiche" })).getByRole("button", { name: /^Planung$/ }));
    await userEvent.click(canvas.getByRole("button", { name: /^Öffnen$/ }));
    await waitFor(() => expect(canvas.getByLabelText("Initiative discovery reads")).toHaveTextContent(/^1$/));
    await expect(canvas.queryByText("Keine Initiativen vorhanden.")).not.toBeInTheDocument();
    await userEvent.click(canvas.getByRole("button", { name: "Erste Initiativenseite freigeben" }));
    await expect(await canvas.findByRole("button", { name: /^Discovered initiative 0$/ })).toBeVisible();
    await userEvent.click(within(canvas.getByRole("navigation", { name: "Profilbereiche" })).getByRole("button", { name: /^Profil$/ }));
    const refreshedFocus = canvas.getByRole("textbox");
    await userEvent.clear(refreshedFocus);
    await userEvent.type(refreshedFocus, "Focus after partial options");
    await userEvent.click(canvas.getByRole("button", { name: /^Speichern$/ }));
    await expect(canvas.getByText("Gespeichert.")).toBeVisible();
    await expect(refreshedFocus).toHaveValue("Focus after partial options");
    await expect(canvas.getByLabelText("Saved Initiative filter")).toHaveTextContent(/^saved-filter-outside-page$/);
    await expect(canvas.getByLabelText("Saved expanded Initiatives")).toHaveTextContent(/^saved-expanded-outside-page$/);
  },
};

async function openOptions(canvas: ReturnType<typeof within>) {
  await userEvent.click(within(canvas.getByRole("navigation", { name: "Profilbereiche" })).getByRole("button", { name: /^Planung$/ }));
  await userEvent.click(canvas.getByRole("button", { name: /^Öffnen$/ }));
}
async function saveFocusAndCheckRetainedPreferences(canvas: ReturnType<typeof within>) {
  await userEvent.click(within(canvas.getByRole("navigation", { name: "Profilbereiche" })).getByRole("button", { name: /^Profil$/ }));
  const focus = canvas.getByRole("textbox");
  await userEvent.clear(focus);
  await userEvent.type(focus, "Focus independent of options");
  await userEvent.click(canvas.getByRole("button", { name: /^Speichern$/ }));
  await expect(canvas.getByText("Gespeichert.")).toBeVisible();
  await expect(canvas.getByLabelText("Saved Initiative filter")).toHaveTextContent(/^saved-filter-outside-page$/);
  await expect(canvas.getByLabelText("Saved expanded Initiatives")).toHaveTextContent(/^saved-expanded-outside-page$/);
}
export const RetriesDiscoveryAndFindsSavedIdentitiesOnTheNextPage: Story = {
  args: { mode: "retry" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await openOptions(canvas);
    await expect(await canvas.findByRole("button", { name: "Initiativen erneut laden" })).toBeVisible();
    await expect(canvas.queryByText("Keine Initiativen vorhanden.")).not.toBeInTheDocument();
    await expect(canvas.getByRole("button", { name: "Gespeicherte Initiative (saved-expanded-outside-page)" })).toBeVisible();
    await userEvent.click(canvas.getByRole("button", { name: "Initiativen erneut laden" }));
    await expect(await canvas.findByRole("button", { name: /^Discovered initiative 0$/ })).toBeVisible();
    await userEvent.click(canvas.getByRole("button", { name: "Weitere Initiativen laden" }));
    await expect(await canvas.findByRole("button", { name: /^Saved expanded Initiative$/ })).toBeVisible();
    await expect(canvas.getByRole("button", { name: /^Saved filter Initiative$/ })).toBeVisible();
    await expect(canvas.getByRole("button", { name: /^Discovered initiative 0$/ })).toBeVisible();
    await expect(canvas.queryByRole("button", { name: "Weitere Initiativen laden" })).not.toBeInTheDocument();
    await saveFocusAndCheckRetainedPreferences(canvas);
    await expect(canvas.getByLabelText("Initiative discovery reads")).toHaveTextContent(/^3$/);
  },
};
export const OldQueryCannotReplaceTheCurrentOptionsOrDraft: Story = {
  args: { mode: "query" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await openOptions(canvas);
    await waitFor(() => expect(canvas.getByLabelText("Initiative discovery reads")).toHaveTextContent(/^1$/));
    const search = canvas.getByRole("textbox", { name: "Initiativen suchen" });
    await userEvent.type(search, "Current");
    await userEvent.keyboard("{Enter}");
    await expect(await canvas.findByRole("button", { name: /^Current query Initiative$/ })).toBeVisible();
    await userEvent.click(canvas.getByRole("button", { name: "Erste Initiativenseite freigeben" }));
    await expect(canvas.getByRole("button", { name: /^Current query Initiative$/ })).toBeVisible();
    await expect(canvas.queryByRole("button", { name: /^Discovered initiative 0$/ })).not.toBeInTheDocument();
    await expect(search).toHaveValue("Current");
    await saveFocusAndCheckRetainedPreferences(canvas);
  },
};
export const ProvenEmptyOptionsDoNotEraseStoredSelections: Story = {
  args: { mode: "empty" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await openOptions(canvas);
    await expect(await canvas.findByText("Keine Initiativen vorhanden.")).toBeVisible();
    await expect(canvas.getByRole("button", { name: "Gespeicherte Initiative (saved-filter-outside-page)" })).toBeVisible();
    await expect(canvas.getByRole("button", { name: "Gespeicherte Initiative (saved-expanded-outside-page)" })).toBeVisible();
    await saveFocusAndCheckRetainedPreferences(canvas);
  },
};

export const ExplicitAllFilterKeepsTheSavedExpandedSelection: Story = {
  args: { mode: "empty" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await openOptions(canvas);
    await expect(await canvas.findByText("Keine Initiativen vorhanden.")).toBeVisible();
    await userEvent.click(canvas.getByRole("combobox", { name: /^Initiative$/ }));
    await userEvent.click(within(document.body).getByRole("option", { name: /^Alle$/ }));
    await userEvent.click(canvas.getByRole("button", { name: /^Speichern$/ }));
    await expect(canvas.getByText("Gespeichert.")).toBeVisible();
    await expect(canvas.getByLabelText("Saved Initiative filter")).toHaveTextContent(/^Alle$/);
    await expect(canvas.getByLabelText("Saved expanded Initiatives")).toHaveTextContent(/^saved-expanded-outside-page$/);
  },
};

export const ReopeningExpiredInitiativeOptionsStartsImmediately: Story = {
  args: { mode: "scheduling" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const dispatched = () => JSON.parse(canvas.getByLabelText("Initiative discovery queries").textContent || "[]");
    const input = (element: HTMLInputElement, value: string) => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(element, value);
      element.dispatchEvent(new Event("input", { bubbles: true }));
    };
    vi.useFakeTimers();
    try {
      await act(async () => { within(canvas.getByRole("navigation", { name: "Profilbereiche" })).getByRole("button", { name: /^Planung$/ }).click(); });
      await act(async () => { canvas.getByRole("button", { name: /^Öffnen$/ }).click(); });
      schedulingExpect(dispatched()).toEqual([""]);
      const search = canvas.getByRole("textbox", { name: "Initiativen suchen" }) as HTMLInputElement;
      await act(async () => { input(search, "Fern"); });
      await act(async () => { await vi.advanceTimersByTimeAsync(249); });
      schedulingExpect(dispatched()).toEqual([""]);
      await act(async () => { await vi.advanceTimersByTimeAsync(1); });
      schedulingExpect(dispatched()).toEqual(["", "fern"]);
      await act(async () => { input(search, "Weiter"); });
      await act(async () => { search.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true })); });
      schedulingExpect(dispatched()).toEqual(["", "fern", "weiter"]);
      await act(async () => { canvas.getByRole("button", { name: /^Schließen$/ }).click(); });
      await act(async () => { await vi.advanceTimersByTimeAsync(501); });
      await act(async () => { canvas.getByRole("button", { name: /^Öffnen$/ }).click(); });
      schedulingExpect(dispatched()).toEqual(["", "fern", "weiter", "weiter"]);
    } finally { vi.clearAllTimers(); vi.useRealTimers(); }
  },
};
