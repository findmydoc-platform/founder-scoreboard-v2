import { useState, useSyncExternalStore } from "react";
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, userEvent, within } from "storybook/test";
import { createPlanningState } from "@/features/planning/model/internal/planning-state-owner";
import { emptyPlanningShellState } from "@/features/planning/model/planning-shell-state";
import { useOwnProfileSettingsCommands } from "../hooks/use-own-profile-settings-commands";
import { defaultFilters } from "../model/profile-settings-view-model";
import type { Profile, ProfileUiPreference } from "@/lib/types";
import { ProfileSettingsOverview } from "./profile-settings-overview";

const profile = { id: "profile-a", name: "Ada", focus: "Gespeicherter Fokus", color: "#64748b", platformRole: "founder", notificationsEnabled: true } as Profile;
const preference: ProfileUiPreference = { profileId: profile.id, defaultWorkspace: "planning", defaultTaskView: "board", planningFilters: defaultFilters(), expandedInitiativeIds: [], createdAt: "before", updatedAt: "before" };
const initial = { ...emptyPlanningShellState, profiles: [profile], profileUiPreferences: [preference] };
function Fixture({ lost = false }: { lost?: boolean }) {
  const [counts] = useState(() => ({ writes: 0, reads: 0 }));
  const [bundle] = useState(() => createPlanningState({ userId: "account-a", initialData: initial, initialWorkspace: "profile", adapter: {
    saveTask: async () => ({ task: {} }),
    readWorkspace: async () => { counts.reads++; return { data: { ...initial, profileUiPreferences: [{ ...preference, updatedAt: "background" }] } }; },
    saveOwnProfileSettings: async patch => { counts.writes++; if (lost) throw new Error("Antwort verloren"); return { profile: { ...profile, ...patch.profilePatch }, uiPreference: { ...preference, ...patch.uiPreferences, updatedAt: "saved" }, notificationPreferences: [] }; },
  } }));
  const data = useSyncExternalStore(bundle.planning.subscribe, bundle.internal.getSnapshot, bundle.internal.getSnapshot);
  const [error, setSaveError] = useState("");
  const { saveOwnProfileSettings } = useOwnProfileSettingsCommands({ planningState: bundle.planning, currentProfile: profile, setSaveError });
  return <div className="p-4"><p role="status">{error}</p><p>Writes: {counts.writes}; reads: {counts.reads}</p><button onClick={() => { void bundle.planning.refreshWorkspace("profile"); }}>Hintergrund laden</button><ProfileSettingsOverview planningState={bundle.planning} currentProfile={data.profiles[0] || profile} data={data} pending={false} source="supabase" onSaveOwnProfileSettings={saveOwnProfileSettings} /></div>;
}
const meta = { title: "Features/Profile/ProfileSettingsOverview", component: Fixture, parameters: { layout: "fullscreen" } } satisfies Meta<typeof Fixture>;
export default meta;
type Story = StoryObj<typeof meta>;
export const KeepsLocalDraftWhenPreferencesRefresh: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const input = canvas.getByRole("textbox");
    await userEvent.clear(input);
    await userEvent.type(input, "Mein Entwurf");
    await userEvent.click(canvas.getByRole("button", { name: "Hintergrund laden" }));
    await expect(input).toHaveValue("Mein Entwurf");
    await userEvent.click(canvas.getByRole("button", { name: "Speichern" }));
    await expect(canvas.getByText("Gespeichert.")).toBeVisible();
    await expect(canvas.getByRole("textbox")).toHaveValue("Mein Entwurf");
    await expect(canvas.getByText("Writes: 1; reads: 1")).toBeVisible();
  },
};
export const KeepsUnconfirmedInputAndChecksWithoutReplay: Story = {
  args: { lost: true },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.clear(canvas.getByRole("textbox"));
    await userEvent.type(canvas.getByRole("textbox"), "Nicht bestätigter Entwurf");
    await userEvent.click(canvas.getByRole("button", { name: "Speichern" }));
    await expect(canvas.getByRole("button", { name: "Speichern" })).toBeDisabled();
    await expect(canvas.getByRole("textbox")).toHaveValue("Nicht bestätigter Entwurf");
    await userEvent.click(canvas.getByRole("button", { name: "Serverstand prüfen" }));
    await expect(canvas.getByText("Serverstand geprüft. Die Bestätigung bleibt offen.")).toBeVisible();
    await expect(canvas.getByText("Writes: 1; reads: 1")).toBeVisible();
    await expect(canvas.getByRole("button", { name: "Speichern" })).toBeDisabled();
  },
};
