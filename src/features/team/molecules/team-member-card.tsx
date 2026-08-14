import { Info } from "lucide-react";
import { roleLabel } from "@/lib/platform";
import type { Profile } from "@/lib/types";
import type { TeamMemberStats } from "@/features/team/model/team-profile-view-model";
import { UiBadge, UiButton, UiPanel } from "@/shared/atoms/ui-primitives";

const metricDefinitions = {
  openTasks: {
    label: "Offene Aufgaben",
    description: "Aufgaben dieser Person, die noch nicht erledigt sind.",
  },
  highPriorityTasks: {
    label: "P0/P1 offen",
    description: "Offene P0- und P1-Aufgaben dieser Person.",
  },
  loadHours: {
    label: "Geplante Last",
    description: "Summe der geschätzten Stunden aus Aufgaben dieser Person.",
  },
  weeklyCapacity: {
    label: "Wochenkapazität",
    description: "Operativ gesetzte Wochenkapazität für Planung und Lastvergleich.",
  },
};

export function TeamMemberCard({
  canManageTeam,
  deputyText,
  profile,
  stats,
  onEdit,
}: {
  canManageTeam: boolean;
  deputyText: string;
  profile: Profile;
  stats: TeamMemberStats;
  onEdit: () => void;
}) {
  const memberColor = profile.color || "#e2e8f0";

  return (
    <UiPanel as="article" padding="sm" className="relative min-w-0">
      <div className="absolute inset-y-0 left-0 w-1" style={{ backgroundColor: memberColor }} aria-hidden="true" />
      <div className="grid gap-4 pl-1 xl:grid-cols-[minmax(220px,0.8fr)_minmax(520px,2fr)_auto] xl:items-center">
        <div className="flex min-w-0 items-start gap-3">
          <div
            className="grid h-11 w-11 shrink-0 place-items-center rounded-md border bg-slate-50 text-sm font-semibold text-slate-700 xl:h-9 xl:w-9"
            style={{ borderColor: memberColor }}
          >
            {profile.name.slice(0, 1)}
          </div>
          <div className="min-w-0">
            <div className="flex min-w-0 items-center gap-2">
              <h2 className="min-w-0 truncate text-base font-semibold text-slate-950">{profile.name}</h2>
              <UiBadge tone="white">{roleLabel(profile)}</UiBadge>
            </div>
            {deputyText && <div className="mt-1 text-xs font-semibold text-blue-700">{deputyText}</div>}
          </div>
        </div>
        <div className="grid min-w-0 grid-cols-2 gap-x-3 gap-y-1 text-sm sm:grid-cols-4 xl:flex xl:flex-nowrap xl:items-center xl:gap-x-6">
          <TeamMetric definition={metricDefinitions.openTasks} value={stats.openTasks} />
          <TeamMetric definition={metricDefinitions.highPriorityTasks} value={stats.highPriorityTasks} />
          <TeamMetric definition={metricDefinitions.loadHours} value={`${stats.loadHours}h`} />
          <TeamMetric definition={metricDefinitions.weeklyCapacity} value={`${profile.weeklyCapacity}h`} />
        </div>
        {canManageTeam && (
          <UiButton type="button" onClick={onEdit} size="sm" variant="secondary" className="w-full justify-self-start sm:w-auto xl:justify-self-end">
            Bearbeiten
          </UiButton>
        )}
      </div>
    </UiPanel>
  );
}

function TeamMetric({
  definition,
  value,
}: {
  definition: { label: string; description: string };
  value: string | number;
}) {
  return (
    <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_24px] items-center gap-x-1 py-1 xl:flex xl:gap-1.5 xl:whitespace-nowrap">
      <span className="text-xs leading-4 text-slate-500">{definition.label}</span>
      <span
        className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-slate-400 outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
        title={definition.description}
        aria-label={definition.description}
        tabIndex={0}
      >
        <Info size={12} />
      </span>
      <span className="col-span-2 font-semibold text-slate-900 xl:col-span-1">{value}</span>
    </div>
  );
}
