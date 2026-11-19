import { useEffect, useState, useSyncExternalStore } from "react";
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, userEvent, waitFor, within } from "storybook/test";
import { createPlanningState } from "@/features/planning/model/internal/planning-state-owner";
import { emptyPlanningShellState } from "@/features/planning/model/planning-shell-state";
import { useOwnProfileSettingsCommands } from "../hooks/use-own-profile-settings-commands";
import { defaultFilters } from "../model/profile-settings-view-model";
import { ProfileSettingsOverview } from "./profile-settings-overview";
import type { OwnProfileSettingsPatch } from "../hooks/use-own-profile-settings-commands";
import type { PlanningItemCandidateReceipt } from "@/features/planning-items/model/planning-item-candidates";
import type { Profile, ProfileUiPreference } from "@/lib/types";

const profile: Profile = { id: "profile-options-owner", name: "Ada", focus: "Saved focus", color: "#64748b", platformRole: "founder", notificationsEnabled: true, weeklyCapacity: 37 };
const preference: ProfileUiPreference = { profileId: profile.id, defaultWorkspace: "planning", defaultTaskView: "board",
  planningFilters: { ...defaultFilters(), initiativeId: "saved-filter-outside-page" }, expandedInitiativeIds: ["saved-expanded-outside-page"], createdAt: "before", updatedAt: "before" };
const initial = { ...emptyPlanningShellState, profiles: [profile], profileUiPreferences: [preference] };

function ProfileOptionsFixture() {
  const [saved, setSaved] = useState<OwnProfileSettingsPatch>();
  const [candidateReads, setCandidateReads] = useState(0);
  const [bundle] = useState(() => {
    const now = Date.now(), deadline = now + 60_000;
    const session = { userId: "profile-options-account", user: { id: "profile-options-account" }, revision: "original-profile-options-session", expiresAt: (now + 3_600_000) / 1000 };
    let release!: (value: PlanningItemCandidateReceipt) => void;
    const held = new Promise<PlanningItemCandidateReceipt>(resolve => { release = resolve; });
    const page: PlanningItemCandidateReceipt = { candidates: { kind: "initiative", items: Array.from({ length: 20 }, (_, index) => ({
      id: `discovered-initiative-${index}`, title: `Discovered initiative ${index}`, taskType: "initiative" as const, parentTaskId: "", approvalStatus: "approved", updatedAt: "2026-11-19T00:00:00Z",
    })), total: 21, coverage: "partial", continuation: "next-profile-options-page", sourceRevision: "profile-options-source", observedAt: new Date(now).toISOString(), validUntil: new Date(deadline).toISOString() },
      readAuthority: { userId: session.userId, deadline }, readActor: { profileId: profile.id, platformRole: profile.platformRole } };
    const owner = createPlanningState({ userId: session.userId, initialSession: session, initialCurrentProfile: profile,
      initialData: initial, initialWorkspace: "profile", adapter: {
        saveTask: async () => ({ task: {} }), readWorkspace: async () => { throw new Error("Profile options must not enumerate a Workspace"); },
        readCandidates: async query => {
          if (query.kind !== "initiative" || query.limit !== 20) throw new Error("Unexpected Profile discovery scope");
          setCandidateReads(count => count + 1);
          return held;
        },
        saveOwnProfileSettings: async patch => {
          setSaved(patch);
          return { profile: { ...profile, ...patch.profilePatch }, uiPreference: { ...preference, ...patch.uiPreferences, updatedAt: "saved" }, notificationPreferences: [] };
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
    <output aria-label="Saved Initiative filter">{saved?.uiPreferences?.planningFilters?.initiativeId || "not-saved"}</output>
    <output aria-label="Saved expanded Initiatives">{saved?.uiPreferences?.expandedInitiativeIds?.join(",") || "not-saved"}</output>
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
    await userEvent.click(canvas.getByRole("button", { name: "Speichern", exact: true }));
    await expect(canvas.getByText("Gespeichert.")).toBeVisible();
    await expect(focus).toHaveValue("Independent focus draft");
    await expect(canvas.getByLabelText("Saved Initiative filter")).toHaveTextContent(/^saved-filter-outside-page$/);
    await expect(canvas.getByLabelText("Saved expanded Initiatives")).toHaveTextContent(/^saved-expanded-outside-page$/);
    await userEvent.click(canvas.getByRole("button", { name: /Planung.*Start und Standardansicht/ }));
    await userEvent.click(canvas.getByRole("button", { name: "Öffnen", exact: true }));
    await waitFor(() => expect(canvas.getByLabelText("Initiative discovery reads")).toHaveTextContent(/^1$/));
    await expect(canvas.queryByText("Keine Initiativen vorhanden.")).not.toBeInTheDocument();
    await userEvent.click(canvas.getByRole("button", { name: "Erste Initiativenseite freigeben" }));
    await expect(await canvas.findByRole("button", { name: "Discovered initiative 0", exact: true })).toBeVisible();
    await userEvent.click(canvas.getByRole("button", { name: /Profil.*Identität, Fokus und Farbe/ }));
    const refreshedFocus = canvas.getByRole("textbox");
    await userEvent.clear(refreshedFocus);
    await userEvent.type(refreshedFocus, "Focus after partial options");
    await userEvent.click(canvas.getByRole("button", { name: "Speichern", exact: true }));
    await expect(canvas.getByText("Gespeichert.")).toBeVisible();
    await expect(refreshedFocus).toHaveValue("Focus after partial options");
    await expect(canvas.getByLabelText("Saved Initiative filter")).toHaveTextContent(/^saved-filter-outside-page$/);
    await expect(canvas.getByLabelText("Saved expanded Initiatives")).toHaveTextContent(/^saved-expanded-outside-page$/);
  },
};
