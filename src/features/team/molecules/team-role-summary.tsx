import { activeDeputyProfiles, platformRoleOptions, roleOptionLabel } from "@/features/team/model/team-profile-view-model";
import { formatDate } from "@/lib/display";
import type { Profile } from "@/lib/types";
import { UiBadge, UiPanel } from "@/shared/atoms/ui-primitives";

export function TeamRoleSummary({
  profiles,
  today,
}: {
  profiles: Profile[];
  today: string;
}) {
  const activeDeputies = activeDeputyProfiles(profiles, today);
  const ceoProfiles = profiles.filter((profile) => profile.platformRole === "ceo");

  return (
    <UiPanel>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-slate-950">Rollen & Vertretung</h2>
          <p className="mt-1 max-w-3xl text-sm leading-6 text-slate-500">
            Operative Übersicht für Rollen, Kapazität und aktive Vertretungen.
          </p>
        </div>
        <div className="flex flex-wrap justify-end gap-2">
          {ceoProfiles.map((profile) => (
            <UiBadge key={profile.id} tone="emerald" size="md">
              CEO · {profile.name}
            </UiBadge>
          ))}
        </div>
      </div>
      <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        {platformRoleOptions.map((role) => {
          const count = profiles.filter((profile) => profile.platformRole === role).length;
          return (
            <div key={role} className="rounded-md border border-slate-100 bg-slate-50 px-3 py-2">
              <div className="text-xs font-semibold text-slate-500">{roleOptionLabel(role)}</div>
              <div className="mt-1 text-lg font-semibold text-slate-950">{count}</div>
            </div>
          );
        })}
      </div>
      <div className="mt-4 rounded-md border border-slate-100 bg-slate-50 px-3 py-2 text-sm leading-6 text-slate-600">
        {activeDeputies.length ? (
          activeDeputies.map((profile) => {
            const represented = profiles.find((item) => item.id === profile.deputyFor);
            return (
              <div key={profile.id}>
                <span className="font-semibold text-slate-800">{profile.name}</span> vertritt {represented?.name || profile.deputyFor} {profile.deputyActiveUntil ? `bis ${formatDate(profile.deputyActiveUntil)}` : "ohne Enddatum"}.
              </div>
            );
          })
        ) : (
          "Aktuell ist keine aktive Deputy-Vertretung gesetzt."
        )}
      </div>
    </UiPanel>
  );
}
