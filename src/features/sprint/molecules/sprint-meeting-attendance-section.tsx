"use client";

import { CustomSelect } from "@/shared/atoms/custom-select";
import { roleLabel } from "@/lib/platform";
import type { Meeting, MeetingAttendance, PlanningData, Profile } from "@/lib/types";
import { UiBadge, UiEmptyState } from "@/shared/atoms/ui-primitives";
import { DataCell, DataHeaderCell, DataOverflow, DataRow, DataSurface, DataTable, DataTableHead } from "@/shared/molecules/data-surface";

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

  return (
    <DataSurface
      title="Weekly Updates"
      description={sprintMeetings.length ? `${sprintMeetings.length}/2 Weeklys im Sprint` : "Noch kein Weekly für diesen Sprint angelegt."}
      actions={<UiBadge tone="white" size="md">max. 2 je Weekly, 4 je Sprint</UiBadge>}
    >
      {sprintMeetings.length ? (
        <DataOverflow>
          <DataTable minWidth={1160}>
            <DataTableHead>
              <tr>
                <DataHeaderCell className="px-4">Founder</DataHeaderCell>
                <DataHeaderCell>Status</DataHeaderCell>
                <DataHeaderCell>Triftiger Grund</DataHeaderCell>
                <DataHeaderCell>Update</DataHeaderCell>
                <DataHeaderCell>Akzeptiert</DataHeaderCell>
                <DataHeaderCell>Punkte</DataHeaderCell>
              </tr>
            </DataTableHead>
            <tbody>
              {sprintMeetings.flatMap((meeting) => data.profiles.map((profile) => {
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
                  <DataRow key={`${meeting.id}-${profile.id}`}>
                    <DataCell className="px-4">
                      <div className="font-semibold text-slate-950">{profile.name}</div>
                      <div className="text-xs text-slate-500">{meeting.title} · {new Intl.DateTimeFormat("de-DE", { dateStyle: "medium", timeStyle: "short" }).format(new Date(meeting.meetingAt))}</div>
                      <div className="text-xs text-slate-500">
                        {roleLabel(profile)}
                        {!canManageSprint && currentProfile?.id === profile.id ? " · eigene Rückmeldung" : ""}
                      </div>
                    </DataCell>
                    <DataCell>
                      <CustomSelect
                        value={attendance.status}
                        disabled={pending || !canEditAttendanceRow}
                        onChange={(value) => patchAttendance({ status: value as MeetingAttendance["status"], reasonAccepted: false, points: canManageSprint ? attendance.points : 0 })}
                        className="h-8 w-36 text-xs"
                        options={statusOptions}
                      />
                    </DataCell>
                    <DataCell>
                      <input
                        value={attendance.absenceReason}
                        disabled={pending || !canEditAttendanceRow}
                        onChange={(event) => patchAttendance({ absenceReason: event.target.value })}
                        className="h-8 w-64 rounded-md border border-slate-200 bg-white px-2 text-xs text-slate-700 disabled:bg-slate-50"
                        placeholder="z. B. Krankheit, Familie, nicht verschiebbar"
                      />
                    </DataCell>
                    <DataCell>
                      <textarea
                        value={attendance.writtenUpdate}
                        disabled={pending || !canEditAttendanceRow}
                        onChange={(event) => patchAttendance({ writtenUpdate: event.target.value })}
                        className="min-h-12 w-80 resize-y rounded-md border border-slate-200 bg-white px-2 py-1 text-xs leading-5 text-slate-700 disabled:bg-slate-50"
                        placeholder="Kurzupdate, Blocker, nächster Schritt"
                      />
                    </DataCell>
                    <DataCell>
                      <input
                        type="checkbox"
                        checked={attendance.reasonAccepted}
                        disabled={pending || !canScoreAttendance}
                        onChange={(event) => patchAttendance({ reasonAccepted: event.target.checked })}
                        aria-label="Grund akzeptiert"
                      />
                    </DataCell>
                    <DataCell>
                      <CustomSelect value={Math.min(attendance.points, 2)} disabled={pending || !canScoreAttendance} onChange={(value) => patchAttendance({ points: Number(value) })} className="h-8 w-20 text-xs" options={[0, 1, 2].map((point) => ({ value: String(point), label: String(point) }))} />
                    </DataCell>
                  </DataRow>
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
