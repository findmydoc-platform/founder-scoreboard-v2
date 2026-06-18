import { formatMeetingDateTime } from "@/features/meetings/model/meeting-finder";
import type { Meeting, MeetingAttendance, Sprint } from "@/lib/types";

export function PlannedMeetingsSection({
  plannedMeetings,
  sprints,
  meetingAttendance,
  profileNameById,
  canManageAvailability,
  pending,
  onUpdateMeeting,
}: {
  plannedMeetings: Meeting[];
  sprints: Sprint[];
  meetingAttendance: MeetingAttendance[];
  profileNameById: Map<string, string>;
  canManageAvailability: boolean;
  pending: boolean;
  onUpdateMeeting: (meeting: Meeting, patch: Partial<Pick<Meeting, "title" | "agenda" | "meetingAt" | "status">>) => void;
}) {
  const attendanceForMeeting = (meeting: Meeting) => meetingAttendance.filter((attendance) => attendance.meetingId === meeting.id);

  return (
    <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm xl:col-span-2">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-slate-950">Vorgemerkte Meetings</h2>
          <p className="mt-1 text-sm text-slate-500">Interne Termine aus dem Meeting Finder inklusive Teilnehmerstatus. Abgesagte Meetings blockieren keine Slots mehr.</p>
        </div>
        <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-1 text-xs font-semibold text-slate-600">{plannedMeetings.length} aktiv</span>
      </div>
      <div className="mt-4 grid gap-3 lg:grid-cols-2">
        {plannedMeetings.map((meeting) => {
          const attendance = attendanceForMeeting(meeting);
          const presentCount = attendance.filter((item) => item.status === "present").length;
          const excusedCount = attendance.filter((item) => item.status === "excused" || item.status === "late_excused").length;
          const openCount = attendance.filter((item) => item.status === "pending").length;
          const sprint = sprints.find((item) => item.id === meeting.sprintId);
          const attendees = attendance.map((item) => profileNameById.get(item.profileId) || item.profileId);
          return (
            <article key={meeting.id} className="rounded-lg border border-slate-100 bg-slate-50 p-3 text-sm">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="font-semibold text-slate-950">{meeting.title}</div>
                  <div className="mt-1 text-xs text-slate-500">{formatMeetingDateTime(meeting.meetingAt)} · {sprint?.name || meeting.sprintId}</div>
                </div>
                <span className="rounded-full border border-emerald-200 bg-white px-2 py-0.5 text-xs font-semibold text-emerald-700">{meeting.status === "done" ? "Erledigt" : "Geplant"}</span>
              </div>
              {meeting.agenda && <p className="mt-3 rounded-md bg-white px-3 py-2 text-sm leading-6 text-slate-600">{meeting.agenda}</p>}
              <div className="mt-3 flex flex-wrap gap-2 text-xs font-semibold">
                <span className="rounded-full border border-slate-200 bg-white px-2 py-1 text-slate-600">{attendance.length} Teilnehmer</span>
                <span className="rounded-full border border-emerald-200 bg-white px-2 py-1 text-emerald-700">{presentCount} anwesend</span>
                <span className="rounded-full border border-amber-200 bg-white px-2 py-1 text-amber-700">{excusedCount} entschuldigt</span>
                <span className="rounded-full border border-blue-200 bg-white px-2 py-1 text-blue-700">{openCount} offen</span>
              </div>
              <div className="mt-3 text-xs leading-5 text-slate-500">
                {attendees.length ? `Teilnehmer: ${attendees.join(", ")}` : "Noch keine Teilnehmer hinterlegt."}
              </div>
              {canManageAvailability && meeting.status === "planned" && (
                <button
                  type="button"
                  onClick={() => onUpdateMeeting(meeting, { status: "cancelled" })}
                  disabled={pending}
                  className="mt-3 h-8 rounded-md border border-red-200 bg-white px-3 text-xs font-semibold text-red-700 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Meeting absagen
                </button>
              )}
              {meeting.googleCalendarHtmlLink && (
                <a
                  href={meeting.googleCalendarHtmlLink}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-3 ml-2 inline-flex h-8 items-center rounded-md border border-blue-200 bg-white px-3 text-xs font-semibold text-blue-700 hover:bg-blue-50"
                >
                  Google-Termin öffnen
                </a>
              )}
              {meeting.googleCalendarSyncStatus === "failed" && (
                <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-800">
                  Google Sync fehlgeschlagen: {meeting.googleCalendarSyncError || "Konfiguration prüfen."}
                </div>
              )}
            </article>
          );
        })}
        {!plannedMeetings.length && (
          <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 px-4 py-8 text-center text-sm text-slate-500 lg:col-span-2">
            Noch keine aktiven Meetings vorgemerkt. Wähle oben einen Slot und nutze „Intern vormerken“.
          </div>
        )}
      </div>
    </section>
  );
}
