import { TEAM_WORKWEEK_DAYS } from "../model/team-workweek-draft";
import { projectActiveTeamWorkweekRows } from "../model/team-workweek-matrix";
import { formatDate } from "@/lib/display";
import type { PublishedTeamWorkweek } from "../model/published-team-workweek";
import type { Profile } from "@/lib/types";
import { UiBadge } from "@/shared/atoms/ui-primitives";
import {
  DataCell,
  DataHeaderCell,
  DataOverflow,
  DataTable,
  DataTableHead,
} from "@/shared/molecules/data-surface";

export function TeamWorkweekMatrix({
  compact = false,
  profiles,
  workweeks,
}: {
  compact?: boolean;
  profiles: Profile[];
  workweeks: PublishedTeamWorkweek[];
}) {
  const rows = projectActiveTeamWorkweekRows(profiles, workweeks);

  return (
    <DataOverflow
      className="rounded-xl border border-slate-200 bg-white"
      aria-label="Team-Arbeitswoche mit sieben Wochentagen"
    >
      <DataTable minWidth={compact ? 900 : 1040} className="table-fixed">
        <DataTableHead>
          <tr className="border-b border-slate-200 bg-slate-50">
            <DataHeaderCell sticky className="w-44 border-r text-xs tracking-wide">
              Team
            </DataHeaderCell>
            {TEAM_WORKWEEK_DAYS.map((day) => (
              <DataHeaderCell key={day.key} className="w-28 text-xs tracking-wide">
                {day.label}
              </DataHeaderCell>
            ))}
          </tr>
        </DataTableHead>
        <tbody>
          {rows.map(({ profile, workweek }) => (
            <tr key={profile.id} className="border-b border-slate-100 last:border-b-0">
              <th scope="row" className="sticky left-0 z-10 border-b border-r border-slate-200 bg-white px-4 py-3 text-left align-top shadow-[2px_0_0_0_rgb(241_245_249)]">
                <div className="flex items-start gap-2">
                  <span className="mt-0.5 h-3 w-3 shrink-0 rounded-full" style={{ backgroundColor: profile.color || "#64748b" }} aria-hidden="true" />
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-semibold text-slate-950">{profile.name}</span>
                    {workweek ? (
                      <span className="mt-1 block text-[11px] font-medium leading-4 text-slate-500">
                        Bestätigt {formatDate(workweek.lastSyncAt.slice(0, 10))}
                      </span>
                    ) : (
                      <UiBadge className="mt-1" tone="slate" size="xs">Nicht veröffentlicht</UiBadge>
                    )}
                  </span>
                </div>
              </th>
              {TEAM_WORKWEEK_DAYS.map((day) => {
                const windows = workweek?.windows[day.key] || [];
                return (
                  <DataCell key={day.key} className="align-top text-sm text-slate-700">
                    {!workweek ? (
                      <span className="text-slate-300" aria-label={`${profile.name}, ${day.label}: keine veröffentlichte Arbeitswoche`}>—</span>
                    ) : windows.length ? (
                      <span className="grid gap-1">
                        {windows.map((window, index) => (
                          <span key={`${window.start}-${window.end}-${index}`} className="whitespace-nowrap font-semibold text-slate-900">
                            {window.start}–{window.end}
                          </span>
                        ))}
                      </span>
                    ) : (
                      <span className="font-medium text-slate-400">Frei</span>
                    )}
                  </DataCell>
                );
              })}
            </tr>
          ))}
        </tbody>
      </DataTable>
    </DataOverflow>
  );
}
