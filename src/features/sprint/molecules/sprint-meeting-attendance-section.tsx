"use client";

import { CustomSelect } from "@/shared/atoms/custom-select";
import { roleLabel } from "@/lib/platform";
import type { Meeting, MeetingAttendance, PlanningData, Profile } from "@/lib/types";

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
    <section className="min-w-0 overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-4 py-3">
        <div>
          <h2 className="text-base font-semibold text-slate-950">Weekly Updates</h2>
          <p className="text-xs text-slate-500">
            {sprintMeetings.length ? `${sprintMeetings.length}/2 Weeklys im Sprint` : "Noch kein Weekly für diesen Sprint angelegt."}
          </p>
        </div>
        <span className="rounded-full border border-slate-200 px-3 py-1 text-xs font-semibold text-slate-600">max. 2 je Weekly, 4 je Sprint</span>
      </div>
      {sprintMeetings.length ? (
        <div className="overflow-x-auto">
          <table className="min-w-[1160px] w-full border-separate border-spacing-0 text-left text-sm">
            <thead className="bg-slate-50 text-xs uppercase text-slate-500">
              <tr>
                <th className="border-b border-slate-200 px-4 py-3 font-semibold">Founder</th>
                <th className="border-b border-slate-200 px-3 py-3 font-semibold">Status</th>
                <th className="border-b border-slate-200 px-3 py-3 font-semibold">Triftiger Grund</th>
                <th className="border-b border-slate-200 px-3 py-3 font-semibold">Update</th>
                <th className="border-b border-slate-200 px-3 py-3 font-semibold">Akzeptiert</th>
                <th className="border-b border-slate-200 px-3 py-3 font-semibold">Punkte</th>
              </tr>
            </thead>
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
                  <tr key={`${meeting.id}-${profile.id}`} className="hover:bg-slate-50">
                    <td className="border-b border-slate-100 px-4 py-3">
                      <div className="font-semibold text-slate-950">{profile.name}</div>
                      <div className="text-xs text-slate-500">{meeting.title} · {new Intl.DateTimeFormat("de-DE", { dateStyle: "medium", timeStyle: "short" }).format(new Date(meeting.meetingAt))}</div>
                      <div className="text-xs text-slate-500">
                        {roleLabel(profile)}
                        {!canManageSprint && currentProfile?.id === profile.id ? " · eigene Rückmeldung" : ""}
                      </div>
                    </td>
                    <td className="border-b border-slate-100 px-3 py-3">
                      <CustomSelect
                        value={attendance.status}
                        disabled={pending || !canEditAttendanceRow}
                        onChange={(value) => patchAttendance({ status: value as MeetingAttendance["status"], reasonAccepted: false, points: canManageSprint ? attendance.points : 0 })}
                        className="h-8 w-36 text-xs"
                        options={statusOptions}
                      />
                    </td>
                    <td className="border-b border-slate-100 px-3 py-3">
                      <input
                        value={attendance.absenceReason}
                        disabled={pending || !canEditAttendanceRow}
                        onChange={(event) => patchAttendance({ absenceReason: event.target.value })}
                        className="h-8 w-64 rounded-md border border-slate-200 bg-white px-2 text-xs text-slate-700 disabled:bg-slate-50"
                        placeholder="z. B. Krankheit, Familie, nicht verschiebbar"
                      />
                    </td>
                    <td className="border-b border-slate-100 px-3 py-3">
                      <textarea
                        value={attendance.writtenUpdate}
                        disabled={pending || !canEditAttendanceRow}
                        onChange={(event) => patchAttendance({ writtenUpdate: event.target.value })}
                        className="min-h-12 w-80 resize-y rounded-md border border-slate-200 bg-white px-2 py-1 text-xs leading-5 text-slate-700 disabled:bg-slate-50"
                        placeholder="Kurzupdate, Blocker, nächster Schritt"
                      />
                    </td>
                    <td className="border-b border-slate-100 px-3 py-3">
                      <input
                        type="checkbox"
                        checked={attendance.reasonAccepted}
                        disabled={pending || !canScoreAttendance}
                        onChange={(event) => patchAttendance({ reasonAccepted: event.target.checked })}
                        aria-label="Grund akzeptiert"
                      />
                    </td>
                    <td className="border-b border-slate-100 px-3 py-3">
                      <CustomSelect value={Math.min(attendance.points, 2)} disabled={pending || !canScoreAttendance} onChange={(value) => patchAttendance({ points: Number(value) })} className="h-8 w-20 text-xs" options={[0, 1, 2].map((point) => ({ value: String(point), label: String(point) }))} />
                    </td>
                  </tr>
                );
              }))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="px-4 py-8 text-center text-sm text-slate-500">Nach Migration 0029 werden pro Sprint zwei Weekly-Meetings angelegt.</div>
      )}
    </section>
  );
}
