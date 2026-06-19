import { formatMeetingDateTime } from "@/features/meetings/model/meeting-finder";
import type { Meeting, MeetingAttendance, Sprint } from "@/lib/types";
import { UiAnchorButton, UiBadge, UiButton, UiEmptyState, UiNotice, UiPanel } from "@/shared/atoms/ui-primitives";

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
    <UiPanel className="xl:col-span-2">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-slate-950">Vorgemerkte Meetings</h2>
          <p className="mt-1 text-sm text-slate-500">Interne Termine aus dem Meeting Finder inklusive Teilnehmerstatus. Abgesagte Meetings blockieren keine Slots mehr.</p>
        </div>
        <UiBadge>{plannedMeetings.length} aktiv</UiBadge>
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
                <UiBadge tone="emeraldWhite" size="xs">{meeting.status === "done" ? "Erledigt" : "Geplant"}</UiBadge>
              </div>
              {meeting.agenda && <p className="mt-3 rounded-md bg-white px-3 py-2 text-sm leading-6 text-slate-600">{meeting.agenda}</p>}
              <div className="mt-3 flex flex-wrap gap-2 text-xs font-semibold">
                <UiBadge tone="white">{attendance.length} Teilnehmer</UiBadge>
                <UiBadge tone="emeraldWhite">{presentCount} anwesend</UiBadge>
                <UiBadge tone="amberWhite">{excusedCount} entschuldigt</UiBadge>
                <UiBadge tone="blueWhite">{openCount} offen</UiBadge>
              </div>
              <div className="mt-3 text-xs leading-5 text-slate-500">
                {attendees.length ? `Teilnehmer: ${attendees.join(", ")}` : "Noch keine Teilnehmer hinterlegt."}
              </div>
              {canManageAvailability && meeting.status === "planned" && (
                <UiButton
                  onClick={() => onUpdateMeeting(meeting, { status: "cancelled" })}
                  disabled={pending}
                  variant="red"
                  size="sm"
                  className="mt-3"
                >
                  Meeting absagen
                </UiButton>
              )}
              {meeting.googleCalendarHtmlLink && (
                <UiAnchorButton
                  href={meeting.googleCalendarHtmlLink}
                  target="_blank"
                  rel="noreferrer"
                  variant="blueOutline"
                  size="sm"
                  className="ml-2 mt-3"
                >
                  Google-Termin öffnen
                </UiAnchorButton>
              )}
              {meeting.googleCalendarSyncStatus === "failed" && (
                <UiNotice tone="warning" className="mt-3 text-xs font-semibold leading-normal">
                  Google Sync fehlgeschlagen: {meeting.googleCalendarSyncError || "Konfiguration prüfen."}
                </UiNotice>
              )}
            </article>
          );
        })}
        {!plannedMeetings.length && (
          <UiEmptyState tone="muted" className="rounded-lg border-slate-300 px-4 py-8 lg:col-span-2">
            Noch keine aktiven Meetings vorgemerkt. Wähle oben einen Slot und nutze „Intern vormerken“.
          </UiEmptyState>
        )}
      </div>
    </UiPanel>
  );
}
