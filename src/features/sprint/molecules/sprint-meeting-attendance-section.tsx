"use client";

import { Fragment, useState } from "react";
import { CustomSelect } from "@/shared/atoms/custom-select";
import { roleLabel } from "@/lib/platform";
import type { Meeting, MeetingAttendance, MeetingAttendanceStatus, PlanningData, Profile } from "@/lib/types";
import { UiBadge, UiButton, UiEmptyState } from "@/shared/atoms/ui-primitives";
import { DataCell, DataHeaderCell, DataOverflow, DataRow, DataSurface, DataTable, DataTableHead } from "@/shared/molecules/data-surface";

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

  return (
    <DataSurface
      title="Weekly Updates"
      description={sprintMeetings.length ? `${sprintMeetings.length}/2 Weeklys im Sprint` : "Noch kein Weekly für diesen Sprint angelegt."}
      actions={<UiBadge tone="white" size="md">max. 2 je Weekly, 4 je Sprint</UiBadge>}
    >
      {sprintMeetings.length ? (
        <DataOverflow>
          <DataTable minWidth={900}>
            <DataTableHead>
              <tr>
                <DataHeaderCell className="px-4">Founder</DataHeaderCell>
                <DataHeaderCell>Status</DataHeaderCell>
                <DataHeaderCell>Update</DataHeaderCell>
                <DataHeaderCell>Punkte</DataHeaderCell>
                <DataHeaderCell>Aktion</DataHeaderCell>
              </tr>
            </DataTableHead>
            <tbody>
              {sprintMeetings.flatMap((meeting) => data.profiles.map((profile) => {
                const rowKey = `${meeting.id}-${profile.id}`;
                const existing = data.meetingAttendance.find((item) => item.meetingId === meeting.id && item.profileId === profile.id);
                const attendance: MeetingAttendance = existing || {
                  id: 0,
                  meetingId: meeting.id,
                  profileId: profile.id,
                  status: "pending",
                  absenceReason: "",
                  reasonAccepted: false,
                  writtenUpdate: "",
                  points: 0,
                  createdAt: "",
                  updatedAt: "",
                };
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
                      <DataCell className="px-4">
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
              }))}
            </tbody>
          </DataTable>
        </DataOverflow>
      ) : (
        <UiEmptyState className="m-4">Pro Sprint werden zwei Weekly-Einträge angelegt.</UiEmptyState>
      )}
    </DataSurface>
  );
}
