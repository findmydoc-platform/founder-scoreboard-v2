import { Check } from "lucide-react";
import type { ProfileSettingsDraft } from "@/features/profile/model/profile-settings-view-model";
import type { buildProfileColorPickerModel } from "@/features/profile/model/profile-color-policy";
import { SettingsPane, SettingsRow } from "@/features/profile/molecules/profile-settings-layout";
import type { Profile } from "@/lib/types";
import { classNames, UiBadge, UiNotice, UiTextArea } from "@/shared/atoms/ui-primitives";

export function ProfileIdentitySection({
  currentProfile,
  colorPicker,
  draft,
  onColorChange,
  onFocusChange,
}: {
  currentProfile: Profile;
  colorPicker: ReturnType<typeof buildProfileColorPickerModel>;
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
      <SettingsRow label="Profilfarbe" description="20 feste Farben. Vergebene Farben bleiben sichtbar." align="start">
        <div className="grid w-full gap-2 md:min-w-96">
          {colorPicker.duplicateMode && (
            <UiNotice tone="info" size="xs" role="status">
              Alle 20 Farben sind vergeben. Du kannst jetzt bewusst eine bereits verwendete Farbe wählen.
            </UiNotice>
          )}
          <div className="grid grid-cols-2 gap-2 xl:grid-cols-4" role="group" aria-label="Profilfarbe">
            {colorPicker.options.map((option) => (
              <button
                key={option.value}
                type="button"
                disabled={option.disabled}
                aria-label={option.ariaLabel}
                aria-pressed={option.selected}
                onClick={() => onColorChange(option.value)}
                className={classNames(
                  "flex min-h-12 items-center justify-between gap-2 rounded-md border px-2 py-1.5 text-left text-xs font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2",
                  option.selected && "border-blue-400 bg-blue-50 text-blue-800",
                  !option.selected && !option.disabled && "border-slate-200 bg-white text-slate-700 hover:bg-slate-50",
                  option.disabled && "cursor-not-allowed border-slate-200 bg-slate-100 text-slate-400",
                )}
              >
                <span className="flex min-w-0 items-center gap-2">
                  <span
                    aria-hidden="true"
                    className="h-4 w-4 shrink-0 rounded-full ring-1 ring-black/10"
                    style={{ backgroundColor: option.value }}
                  />
                  <span className="grid min-w-0 gap-0.5">
                    <span>{option.label}</span>
                    <span className="text-[10px] font-medium leading-none opacity-80">{option.statusLabel}</span>
                  </span>
                </span>
                {option.selected && <Check aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />}
              </button>
            ))}
          </div>
        </div>
      </SettingsRow>
    </SettingsPane>
  );
}
