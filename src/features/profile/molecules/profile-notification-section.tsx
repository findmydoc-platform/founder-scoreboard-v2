import { googleChatDigestEventTypes, notificationEventLabel } from "@/lib/notification-policy";
import type { ProfileSettingsDraft } from "@/features/profile/model/profile-settings-view-model";
import { SettingsPane, SettingsRow, ToggleSwitch } from "@/features/profile/molecules/profile-settings-layout";
import { classNames } from "@/shared/atoms/ui-primitives";

export function NotificationSettingsSection({
  draft,
  pending,
  onMasterChange,
  onEventChange,
}: {
  draft: ProfileSettingsDraft;
  pending: boolean;
  onMasterChange: (enabled: boolean) => void;
  onEventChange: (eventType: string, enabled: boolean) => void;
}) {
  const enabledEvents = googleChatDigestEventTypes.filter((eventType) => draft.notificationEvents[eventType] !== false);

  return (
    <SettingsPane eyebrow="Zustellung" title="Benachrichtigungen" description="Google-Chat-Hinweise bleiben persönlich, aber bewusst leise konfiguriert.">
      <SettingsRow label="Google-Chat-Hinweise" description={draft.notificationsEnabled ? `${enabledEvents.length} Ereignisse aktiv` : "Alle Ereignisse pausiert"}>
        <ToggleSwitch checked={draft.notificationsEnabled} disabled={pending} label="Google-Chat-Hinweise aktiv" onChange={onMasterChange} />
      </SettingsRow>
      <SettingsRow label="Ereignisse" description="Nur sichtbar einstellen, was wirklich relevant ist." align="start">
        <div className={classNames("grid gap-2 text-left md:min-w-96", !draft.notificationsEnabled && "opacity-50")}>
          {googleChatDigestEventTypes.map((eventType) => (
            <div key={eventType} className="flex min-h-10 items-center justify-between gap-3 rounded-md border border-slate-200 bg-white px-3">
              <span className="min-w-0 truncate text-sm font-semibold text-slate-700">{notificationEventLabel(eventType)}</span>
              <ToggleSwitch
                checked={draft.notificationEvents[eventType] !== false}
                disabled={pending || !draft.notificationsEnabled}
                label={`${notificationEventLabel(eventType)} aktiv`}
                onChange={(enabled) => onEventChange(eventType, enabled)}
              />
            </div>
          ))}
        </div>
      </SettingsRow>
    </SettingsPane>
  );
}
