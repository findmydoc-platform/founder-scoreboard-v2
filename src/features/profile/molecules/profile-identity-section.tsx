import { Check } from "lucide-react";
import type { ProfileSettingsDraft } from "@/features/profile/model/profile-settings-view-model";
import { profileColorOptions } from "@/features/profile/model/profile-settings-view-model";
import { SettingsPane, SettingsRow } from "@/features/profile/molecules/profile-settings-layout";
import type { Profile } from "@/lib/types";
import { classNames, UiBadge, UiTextArea } from "@/shared/atoms/ui-primitives";

export function ProfileIdentitySection({
  currentProfile,
  draft,
  onColorChange,
  onFocusChange,
}: {
  currentProfile: Profile;
  draft: ProfileSettingsDraft;
  onColorChange: (color: string) => void;
  onFocusChange: (focus: string) => void;
}) {
  return (
    <SettingsPane eyebrow="Mein Profil" title="Profil" description="Nur die persönlichen Angaben, die du selbst pflegen kannst. Rollen und GitHub bleiben zentral verwaltet.">
      <SettingsRow label="Identität" description="Read-only, damit operative Rollen und Sync-Felder stabil bleiben.">
        <div className="grid gap-2 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-left text-sm md:min-w-96">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="font-semibold text-slate-950">{currentProfile.name}</span>
            <UiBadge tone="blueWhite" size="xs">{currentProfile.platformRole}</UiBadge>
          </div>
          <div className="text-xs text-slate-500">
            {currentProfile.githubLogin ? `GitHub: @${currentProfile.githubLogin}` : "GitHub-Login wird zentral verwaltet"}
          </div>
        </div>
      </SettingsRow>
      <SettingsRow label="Fokus" description="Ein kurzer Kontext für dich und das Team." align="start">
        <UiTextArea
          value={draft.focus}
          onChange={(event) => onFocusChange(event.target.value)}
          maxLength={240}
          minHeight="lg"
          inputPadding="md"
          className="w-full md:min-w-96"
        />
      </SettingsRow>
      <SettingsRow label="Profilfarbe" description="Farbe ist hier ein Signal, kein Dekor.">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 md:min-w-96" aria-label="Profilfarbe">
          {profileColorOptions.map((option) => (
            <button
              key={option.value}
              type="button"
              onClick={() => onColorChange(option.value)}
              className={classNames(
                "flex h-10 items-center justify-between rounded-md border px-2 text-xs font-semibold transition",
                draft.color === option.value ? "border-blue-400 bg-blue-50 text-blue-800" : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50",
              )}
            >
              <span className="flex items-center gap-2">
                <span className="h-4 w-4 rounded-full" style={{ backgroundColor: option.value }} />
                {option.label}
              </span>
              {draft.color === option.value && <Check size={13} />}
            </button>
          ))}
        </div>
      </SettingsRow>
    </SettingsPane>
  );
}
