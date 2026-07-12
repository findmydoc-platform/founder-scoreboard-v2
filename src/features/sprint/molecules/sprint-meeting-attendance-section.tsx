"use client";

import { Fragment, useState } from "react";
import { CustomSelect } from "@/shared/atoms/custom-select";
import { buildSprintAttendanceTableViewModel, DEFAULT_SPRINT_ATTENDANCE_FILTERS, type SprintAttendanceSignalFilter, type SprintAttendanceSort, type SprintAttendanceTableFilters } from "@/features/sprint/model/sprint-attendance-table-view-model";
import { roleLabel } from "@/lib/platform";
import type { Meeting, MeetingAttendance, MeetingAttendanceStatus, PlanningData, Profile } from "@/lib/types";
import { UiBadge, UiButton } from "@/shared/atoms/ui-primitives";
import { ColumnFilterPopover } from "@/shared/molecules/column-filter-popover";
import { DataCell, DataColumnHeader, DataEmptyRow, DataHeaderCell, DataRow, DataTableFrame, DataTableHead, type SortDirection } from "@/shared/molecules/data-surface";
import { FilterField, FilterToolbar, type ActiveFilter } from "@/shared/molecules/filter-toolbar";
import { enumUrlField, stringUrlField, useTableUrlState, type TableUrlSchema } from "@/shared/hooks/use-table-url-state";

const attendanceStatusLabels: Record<MeetingAttendanceStatus, string> = {
  pending: "Offen",
  present: "Anwesend",
  excused: "Entschuldigt",
  late_excused: "Spät entschuldigt",
  unexcused: "Nicht akzeptiert",
  no_show: "No-Show",
};

function attendanceStatusTone(status: MeetingAttendanceStatus) {
  if (status === "present") return "emerald";
  if (status === "excused" || status === "late_excused") return "blue";
  if (status === "unexcused" || status === "no_show") return "red";
  return "slate";
}

const attendanceFilterSchema: TableUrlSchema<SprintAttendanceTableFilters> = {
  query: stringUrlField(),
  founder: stringUrlField("all"),
  meeting: stringUrlField("all"),
  status: enumUrlField("all", ["all", "pending", "present", "excused", "late_excused", "unexcused", "no_show"] as const),
  signal: enumUrlField("all", ["all", "missing_update", "open_reason"] as const),
  points: enumUrlField("all", ["all", "0", "1", "2"] as const),
  sort: enumUrlField("meeting", ["founder", "meeting", "status", "points"] as const),
  direction: enumUrlField("asc", ["asc", "desc"] as const),
};

export function SprintMeetingAttendanceSection({
  data,
  meetings,
  pending,
  currentProfile,
  canManageSprint,
  onUpdateMeetingAttendance,
}: {
  data: PlanningData;
  meetings: Meeting[];
  pending: boolean;
  currentProfile: Profile | null;
  canManageSprint: boolean;
  onUpdateMeetingAttendance: (meeting: Meeting, attendance: MeetingAttendance) => void;
}) {
  const sprintMeetings = meetings.slice(0, 2);
  const [activeRowKey, setActiveRowKey] = useState("");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const { state: filters, updateState: updateFilters, resetState: resetFilters } = useTableUrlState({ namespace: "weekly", schema: attendanceFilterSchema });
  const { visibleRows, totalCount } = buildSprintAttendanceTableViewModel({ data, meetings: sprintMeetings, filters });
  const signalLabels: Record<SprintAttendanceSignalFilter, string> = { all: "Alle Hinweise", missing_update: "Update fehlt", open_reason: "Grund offen" };
  const activeFilters: ActiveFilter[] = [
    ...(filters.founder !== "all" ? [{ id: "founder", label: `Founder: ${data.profiles.find((profile) => profile.id === filters.founder)?.name || filters.founder}`, onRemove: () => updateFilters({ founder: "all" }) }] : []),
    ...(filters.meeting !== "all" ? [{ id: "meeting", label: `Weekly: ${sprintMeetings.find((meeting) => String(meeting.id) === filters.meeting)?.title || filters.meeting}`, onRemove: () => updateFilters({ meeting: "all" }) }] : []),
    ...(filters.status !== "all" ? [{ id: "status", label: `Status: ${attendanceStatusLabels[filters.status]}`, onRemove: () => updateFilters({ status: "all" }) }] : []),
    ...(filters.signal !== "all" ? [{ id: "signal", label: signalLabels[filters.signal], onRemove: () => updateFilters({ signal: "all" }) }] : []),
    ...(filters.points !== "all" ? [{ id: "points", label: `Punkte: ${filters.points}`, onRemove: () => updateFilters({ points: "all" }) }] : []),
  ];
  const toggleSort = (sort: SprintAttendanceSort) => updateFilters({ sort, direction: filters.sort === sort && filters.direction === "asc" ? "desc" : "asc" });
  const directionFor = (sort: SprintAttendanceSort): SortDirection => filters.sort === sort ? filters.direction : null;
  const founderOptions = [{ value: "all", label: "Alle Founder" }, ...data.profiles.map((profile) => ({ value: profile.id, label: profile.name }))];
  const meetingOptions = [{ value: "all", label: "Alle Weeklys" }, ...sprintMeetings.map((meeting) => ({ value: String(meeting.id), label: meeting.title }))];
  const statusFilterOptions = [{ value: "all", label: "Alle Status" }, ...Object.entries(attendanceStatusLabels).map(([value, label]) => ({ value, label }))];
  const signalOptions = (Object.keys(signalLabels) as SprintAttendanceSignalFilter[]).map((value) => ({ value, label: signalLabels[value] }));
  const pointsOptions = [{ value: "all", label: "Alle Punkte" }, ...[0, 1, 2].map((point) => ({ value: String(point), label: `${point} Punkte` }))];
  const toolbar = (
    <FilterToolbar
      variant="embedded"
      density="compact"
      searchLabel="Weekly Updates durchsuchen"
      searchPlaceholder="Founder, Weekly oder Update suchen"
      query={filters.query}
      onQueryChange={(query) => updateFilters({ query }, "replace")}
      expanded={filtersOpen}
      onExpandedChange={setFiltersOpen}
      activeFilters={activeFilters}
      isDirty={JSON.stringify(filters) !== JSON.stringify(DEFAULT_SPRINT_ATTENDANCE_FILTERS)}
      onReset={resetFilters}
      results={[{ id: "weekly", visibleCount: visibleRows.length, totalCount }]}
      panelId="weekly-table-filters"
    >
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
        <FilterField label="Founder"><CustomSelect aria-label="Weekly Updates nach Founder filtern" value={filters.founder} onChange={(founder) => updateFilters({ founder })} options={founderOptions} className="h-10 text-sm" /></FilterField>
        <FilterField label="Weekly"><CustomSelect aria-label="Weekly Updates nach Termin filtern" value={filters.meeting} onChange={(meeting) => updateFilters({ meeting })} options={meetingOptions} className="h-10 text-sm" /></FilterField>
        <FilterField label="Status"><CustomSelect aria-label="Weekly Updates nach Status filtern" value={filters.status} onChange={(status) => updateFilters({ status: status as SprintAttendanceTableFilters["status"] })} options={statusFilterOptions} className="h-10 text-sm" /></FilterField>
        <FilterField label="Hinweis"><CustomSelect aria-label="Weekly Updates nach Hinweis filtern" value={filters.signal} onChange={(signal) => updateFilters({ signal: signal as SprintAttendanceSignalFilter })} options={signalOptions} className="h-10 text-sm" /></FilterField>
        <FilterField label="Punkte"><CustomSelect aria-label="Weekly Updates nach Punkten filtern" value={filters.points} onChange={(points) => updateFilters({ points: points as SprintAttendanceTableFilters["points"] })} options={pointsOptions} className="h-10 text-sm" /></FilterField>
      </div>
    </FilterToolbar>
  );

  return (
    <DataTableFrame
      title="Weekly Updates"
      description={sprintMeetings.length ? `${sprintMeetings.length}/2 Weeklys im Sprint` : "Noch kein Weekly für diesen Sprint angelegt."}
      caption="Weekly-Teilnahme und Updates nach Founder"
      results={[{ id: "weekly", visibleCount: visibleRows.length, totalCount }]}
      filtering={{ mode: "embedded", toolbar }}
      minWidth={900}
      actions={<UiBadge tone="white" size="md">max. 2 je Weekly, 4 je Sprint</UiBadge>}
    >
      {sprintMeetings.length ? (
        <>
            <DataTableHead>
              <tr>
                <DataColumnHeader className="px-4" label="Founder" direction={directionFor("founder")} onSort={() => toggleSort("founder")} sticky filter={<ColumnFilterPopover label="Nach Founder filtern" activeCount={filters.founder === "all" ? 0 : 1} onReset={() => updateFilters({ founder: "all" })}><CustomSelect aria-label="Founder wählen" value={filters.founder} onChange={(founder) => updateFilters({ founder })} options={founderOptions} className="h-10" /></ColumnFilterPopover>} />
                <DataColumnHeader label="Status" direction={directionFor("status")} onSort={() => toggleSort("status")} filter={<ColumnFilterPopover label="Nach Anwesenheitsstatus filtern" activeCount={filters.status === "all" ? 0 : 1} onReset={() => updateFilters({ status: "all" })}><CustomSelect aria-label="Anwesenheitsstatus wählen" value={filters.status} onChange={(status) => updateFilters({ status: status as SprintAttendanceTableFilters["status"] })} options={statusFilterOptions} className="h-10" /></ColumnFilterPopover>} />
                <DataColumnHeader label="Update" filter={<ColumnFilterPopover label="Nach Update-Hinweis filtern" activeCount={filters.signal === "all" ? 0 : 1} onReset={() => updateFilters({ signal: "all" })}><CustomSelect aria-label="Update-Hinweis wählen" value={filters.signal} onChange={(signal) => updateFilters({ signal: signal as SprintAttendanceSignalFilter })} options={signalOptions} className="h-10" /></ColumnFilterPopover>} />
                <DataColumnHeader label="Punkte" direction={directionFor("points")} onSort={() => toggleSort("points")} filter={<ColumnFilterPopover label="Nach Punkten filtern" activeCount={filters.points === "all" ? 0 : 1} onReset={() => updateFilters({ points: "all" })}><CustomSelect aria-label="Punkte wählen" value={filters.points} onChange={(points) => updateFilters({ points: points as SprintAttendanceTableFilters["points"] })} options={pointsOptions} className="h-10" /></ColumnFilterPopover>} />
                <DataHeaderCell>Aktion</DataHeaderCell>
              </tr>
            </DataTableHead>
            <tbody>
              {visibleRows.map(({ rowKey, meeting, profile, attendance }) => {
                const patchAttendance = (patch: Partial<MeetingAttendance>) => onUpdateMeetingAttendance(meeting, { ...attendance, ...patch, updatedAt: new Date().toISOString() });
                const canEditAttendanceRow = canManageSprint || currentProfile?.id === profile.id;
                const canScoreAttendance = canManageSprint;
                const expanded = activeRowKey === rowKey;
                const summary = attendance.writtenUpdate.trim() || attendance.absenceReason.trim() || "Keine Rückmeldung";
                const statusOptions = canManageSprint
                  ? [
                    { value: "pending", label: "Offen" },
                    { value: "present", label: "Anwesend" },
                    { value: "excused", label: "Entschuldigt" },
                    { value: "late_excused", label: "Spät entschuldigt" },
                    { value: "unexcused", label: "Nicht akzeptiert" },
                    { value: "no_show", label: "No-Show" },
                  ]
                  : [
                    { value: "pending", label: "Offen" },
                    { value: "excused", label: "Entschuldigt" },
                    { value: "late_excused", label: "Spät entschuldigt" },
                  ];

                return (
                  <Fragment key={rowKey}>
                    <DataRow>
                      <DataCell className="px-4" sticky>
                        <div className="font-semibold text-slate-950">{profile.name}</div>
                        <div className="text-xs text-slate-500">{meeting.title} · {new Intl.DateTimeFormat("de-DE", { dateStyle: "medium", timeStyle: "short" }).format(new Date(meeting.meetingAt))}</div>
                        <div className="text-xs text-slate-500">
                          {roleLabel(profile)}
                          {!canManageSprint && currentProfile?.id === profile.id ? " · eigene Rückmeldung" : ""}
                        </div>
                      </DataCell>
                      <DataCell>
                        <div className="flex flex-wrap gap-1.5">
                          <UiBadge tone={attendanceStatusTone(attendance.status)}>{attendanceStatusLabels[attendance.status]}</UiBadge>
                          {attendance.reasonAccepted && <UiBadge tone="emerald">akzeptiert</UiBadge>}
                        </div>
                      </DataCell>
                      <DataCell className="max-w-[360px]">
                        <div className="line-clamp-2 text-sm text-slate-700">{summary}</div>
                      </DataCell>
                      <DataCell className={attendance.points ? "font-semibold text-slate-900" : "text-slate-400"}>{attendance.points}/2</DataCell>
                      <DataCell>
                        <UiButton
                          type="button"
                          size="sm"
                          variant={expanded ? "secondary" : "blue"}
                          disabled={pending || (!canEditAttendanceRow && !canScoreAttendance)}
                          onClick={() => setActiveRowKey(expanded ? "" : rowKey)}
                        >
                          {expanded ? "Schließen" : "Bearbeiten"}
                        </UiButton>
                      </DataCell>
                    </DataRow>
                    {expanded && (
                      <tr className="bg-slate-50/60">
                        <td colSpan={5} className="border-b border-slate-100 px-4 py-4">
                          <div className="grid gap-3 lg:grid-cols-[180px_minmax(220px,1fr)_140px]">
                            <label className="grid gap-1 text-xs font-semibold text-slate-500">
                              Status
                              <CustomSelect
                                value={attendance.status}
                                disabled={pending || !canEditAttendanceRow}
                                onChange={(value) => patchAttendance({ status: value as MeetingAttendance["status"], reasonAccepted: false, points: canManageSprint ? attendance.points : 0 })}
                                className="h-8 w-full text-xs"
                                options={statusOptions}
                              />
                            </label>
                            <label className="grid gap-1 text-xs font-semibold text-slate-500">
                              Triftiger Grund
                              <input
                                value={attendance.absenceReason}
                                disabled={pending || !canEditAttendanceRow}
                                onChange={(event) => patchAttendance({ absenceReason: event.target.value })}
                                className="h-8 rounded-md border border-slate-200 bg-white px-2 text-xs text-slate-700 disabled:bg-slate-50"
                                placeholder="z. B. Krankheit, Familie, nicht verschiebbar"
                              />
                            </label>
                            <label className="grid gap-1 text-xs font-semibold text-slate-500">
                              Punkte
                              <CustomSelect value={Math.min(attendance.points, 2)} disabled={pending || !canScoreAttendance} onChange={(value) => patchAttendance({ points: Number(value) })} className="h-8 w-full text-xs" options={[0, 1, 2].map((point) => ({ value: String(point), label: String(point) }))} />
                            </label>
                            <label className="grid gap-1 text-xs font-semibold text-slate-500 lg:col-span-2">
                              Update
                              <textarea
                                value={attendance.writtenUpdate}
                                disabled={pending || !canEditAttendanceRow}
                                onChange={(event) => patchAttendance({ writtenUpdate: event.target.value })}
                                className="min-h-20 resize-y rounded-md border border-slate-200 bg-white px-2 py-1 text-xs leading-5 text-slate-700 disabled:bg-slate-50"
                                placeholder="Kurzupdate, Blocker, nächster Schritt"
                              />
                            </label>
                            <label className="flex items-center gap-2 self-end text-xs font-semibold text-slate-600">
                              <input
                                type="checkbox"
                                checked={attendance.reasonAccepted}
                                disabled={pending || !canScoreAttendance}
                                onChange={(event) => patchAttendance({ reasonAccepted: event.target.checked })}
                                aria-label="Grund akzeptiert"
                              />
                              Grund akzeptiert
                            </label>
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
              {!visibleRows.length && <DataEmptyRow colSpan={5}>{totalCount ? "Keine Weekly Updates für diese Filter." : "Noch keine Weekly Updates vorhanden."}</DataEmptyRow>}
            </tbody>
        </>
      ) : (
        <tbody><DataEmptyRow colSpan={5}>Pro Sprint werden zwei Weekly-Einträge angelegt.</DataEmptyRow></tbody>
      )}
    </DataTableFrame>
  );
}
