import type { UiTone } from "@/shared/atoms/ui-primitives";
import type { ProfileSettingsDraft } from "@/features/profile/model/profile-settings-view-model";
import { SettingsPane, SettingsRow, ToggleSwitch } from "@/features/profile/molecules/profile-settings-layout";
import { UiBadge, UiTextInput } from "@/shared/atoms/ui-primitives";

export function CalendarSettingsSection({
  draft,
  pending,
  onEmailChange,
  onSyncChange,
}: {
  draft: ProfileSettingsDraft;
  pending: boolean;
  onEmailChange: (email: string) => void;
  onSyncChange: (enabled: boolean) => void;
}) {
  const syncReady = draft.googleCalendarSyncEnabled && draft.googleCalendarEmail.trim();
  const statusTone: UiTone = !draft.googleCalendarSyncEnabled ? "slate" : syncReady ? "emeraldWhite" : "amberWhite";
  const statusLabel = !draft.googleCalendarSyncEnabled ? "Aus" : syncReady ? "Aktiv" : "E-Mail fehlt";

  return (
    <SettingsPane eyebrow="Kalender" title="Kalender" description="Persönliche Kalenderzustellung, ohne Systemstatus und Admin-Wartung.">
      <SettingsRow label="Google-Kalender-E-Mail" description="Die Adresse, die für deine Kalenderzuordnung verwendet wird.">
        <UiTextInput
          value={draft.googleCalendarEmail}
          onChange={(event) => onEmailChange(event.target.value)}
          inputPadding="md"
          className="w-full md:min-w-96"
          placeholder="name@example.com"
        />
      </SettingsRow>
      <SettingsRow label="Kalender-Sync" description="Schaltet deine persönliche Kalender-Synchronisierung ein oder aus.">
        <ToggleSwitch checked={draft.googleCalendarSyncEnabled} disabled={pending} label="Kalender-Sync aktiv" onChange={onSyncChange} />
      </SettingsRow>
      <SettingsRow label="Status" description="Schnelle Lesbarkeit statt leerer Kalenderfläche.">
        <div className="flex justify-start md:justify-end">
          <UiBadge tone={statusTone} size="md">{statusLabel}</UiBadge>
        </div>
      </SettingsRow>
    </SettingsPane>
  );
}
