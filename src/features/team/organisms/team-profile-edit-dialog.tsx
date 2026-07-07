import { X } from "lucide-react";
import { CustomDatePicker } from "@/shared/atoms/custom-date-picker";
import { CustomSelect } from "@/shared/atoms/custom-select";
import { platformRoleOptions, roleOptionLabel } from "@/features/team/model/team-profile-view-model";
import type { PlatformRole, Profile } from "@/lib/types";
import { UiButton, UiField, UiTextInput } from "@/shared/atoms/ui-primitives";

export function TeamProfileEditDialog({
  canManageTeam,
  dirty,
  draftProfile,
  pending,
  profiles,
  saving,
  onClose,
  onPatch,
  onReset,
  onSave,
}: {
  canManageTeam: boolean;
  dirty: boolean;
  draftProfile: Profile;
  pending: boolean;
  profiles: Profile[];
  saving: boolean;
  onClose: () => void;
  onPatch: (patch: Partial<Profile>) => void;
  onReset: () => void;
  onSave: () => Promise<void>;
}) {
  if (!canManageTeam) return null;

  const isDeputy = draftProfile.platformRole === "deputy";
  const deputyTargetOptions = [
    { value: "", label: "Keine Vertretung" },
    ...profiles
      .filter((profile) => profile.platformRole === "ceo" || profile.id === draftProfile.deputyFor)
      .map((profile) => ({ value: profile.id, label: profile.name })),
  ];
  const controlDisabled = pending || saving;

  const updatePlatformRole = (value: string) => {
    const platformRole = value as PlatformRole;
    onPatch({
      platformRole,
      orgRole: roleOptionLabel(platformRole),
      deputyFor: platformRole === "deputy" ? draftProfile.deputyFor || profiles.find((profile) => profile.platformRole === "ceo")?.id || "" : "",
      deputyActiveFrom: platformRole === "deputy" ? draftProfile.deputyActiveFrom : "",
      deputyActiveUntil: platformRole === "deputy" ? draftProfile.deputyActiveUntil : "",
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/35 px-4 py-6" role="dialog" aria-modal="true" aria-label={`${draftProfile.name} bearbeiten`}>
      <div className="w-full max-w-2xl rounded-lg border border-slate-200 bg-white p-4 shadow-2xl">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-slate-500">Personeneinstellungen</div>
            <h3 className="mt-1 text-lg font-semibold text-slate-950">{draftProfile.name}</h3>
            <p className="mt-1 text-sm leading-6 text-slate-500">CEO-Verwaltung für Rolle, Kapazität, GitHub-Zuordnung und Vertretung.</p>
          </div>
          <UiButton type="button" onClick={onClose} size="iconXs" className="text-slate-500" aria-label="Dialog schließen">
            <X className="h-4 w-4" />
          </UiButton>
        </div>

        <div className="mt-5 grid gap-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <UiField as="div">
              Plattformrolle
              <CustomSelect
                value={draftProfile.platformRole}
                disabled={controlDisabled}
                onChange={updatePlatformRole}
                className="h-9 text-sm"
                options={platformRoleOptions.map((role) => ({ value: role, label: roleOptionLabel(role) }))}
              />
            </UiField>
            <UiField>
              Org-Rolle
              <UiTextInput
                value={draftProfile.orgRole}
                disabled={controlDisabled}
                onChange={(event) => onPatch({ orgRole: event.target.value })}
                textTone="muted"
              />
            </UiField>
            <UiField>
              GitHub-Login
              <UiTextInput
                value={draftProfile.githubLogin}
                disabled={controlDisabled}
                onChange={(event) => onPatch({ githubLogin: event.target.value })}
                textTone="muted"
              />
            </UiField>
            <UiField>
              Kapazität
              <UiTextInput
                type="number"
                min={0}
                max={80}
                value={draftProfile.weeklyCapacity}
                disabled={controlDisabled}
                onChange={(event) => onPatch({ weeklyCapacity: Number(event.target.value) })}
                textTone="muted"
              />
            </UiField>
          </div>

          <div className="rounded-md border border-slate-100 bg-slate-50 p-3">
            <div className="mb-3 text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Deputy-Vertretung</div>
            <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_120px_120px]">
              <UiField as="div">
                Vertreter für
                <CustomSelect
                  value={draftProfile.deputyFor || ""}
                  disabled={controlDisabled || !isDeputy}
                  onChange={(value) => onPatch({ deputyFor: value })}
                  className="h-9 text-sm"
                  options={deputyTargetOptions}
                />
              </UiField>
              <UiField>
                Von
                <CustomDatePicker value={draftProfile.deputyActiveFrom || ""} disabled={controlDisabled || !isDeputy} onChange={(value) => onPatch({ deputyActiveFrom: value })} className="h-9 text-sm" />
              </UiField>
              <UiField>
                Bis
                <CustomDatePicker value={draftProfile.deputyActiveUntil || ""} disabled={controlDisabled || !isDeputy} onChange={(value) => onPatch({ deputyActiveUntil: value })} className="h-9 text-sm" />
              </UiField>
            </div>
            {!isDeputy && <p className="mt-2 text-xs leading-5 text-slate-500">Deputy-Felder werden aktiv, wenn die Plattformrolle auf Deputy gesetzt ist.</p>}
          </div>
        </div>

        <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-4">
          <div className="text-xs font-semibold text-slate-500">{dirty ? "Ungespeicherte Änderungen" : "Keine Änderungen"}</div>
          <div className="flex gap-2">
            <UiButton type="button" onClick={onReset} disabled={!dirty || saving}>
              Zurücksetzen
            </UiButton>
            <UiButton type="button" onClick={onClose} disabled={saving}>
              Schließen
            </UiButton>
            <UiButton type="button" onClick={() => void onSave()} disabled={!dirty || saving || pending} variant="primary">
              {saving ? "Speichert..." : "Speichern"}
            </UiButton>
          </div>
        </div>
      </div>
    </div>
  );
}
