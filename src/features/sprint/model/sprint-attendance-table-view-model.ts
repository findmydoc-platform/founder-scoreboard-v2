import type { Meeting, MeetingAttendance, MeetingAttendanceStatus, PlanningData, Profile } from "@/lib/types";

export type SprintAttendanceSignalFilter = "all" | "missing_update" | "open_reason";
export type SprintAttendanceSort = "founder" | "meeting" | "status" | "points";

export type SprintAttendanceTableFilters = {
  query: string;
  founder: string;
  meeting: string;
  status: "all" | MeetingAttendanceStatus;
  signal: SprintAttendanceSignalFilter;
  points: "all" | "0" | "1" | "2";
  sort: SprintAttendanceSort;
  direction: "asc" | "desc";
};

export const DEFAULT_SPRINT_ATTENDANCE_FILTERS: SprintAttendanceTableFilters = {
  query: "",
  founder: "all",
  meeting: "all",
  status: "all",
  signal: "all",
  points: "all",
  sort: "meeting",
  direction: "asc",
};

export type SprintAttendanceRow = {
  rowKey: string;
  meeting: Meeting;
  profile: Profile;
  attendance: MeetingAttendance;
};

function emptyAttendance(meetingId: number, profileId: string): MeetingAttendance {
  return {
    id: 0,
    meetingId,
    profileId,
    status: "pending",
    absenceReason: "",
    reasonAccepted: false,
    writtenUpdate: "",
    points: 0,
    createdAt: "",
    updatedAt: "",
  };
}

export function buildSprintAttendanceTableViewModel({
  data,
  meetings,
  filters,
}: {
  data: Pick<PlanningData, "profiles" | "meetingAttendance">;
  meetings: Meeting[];
  filters: SprintAttendanceTableFilters;
}) {
  const rows = meetings.flatMap((meeting) => data.profiles.map((profile) => ({
    rowKey: `${meeting.id}-${profile.id}`,
    meeting,
    profile,
    attendance: data.meetingAttendance.find((item) => item.meetingId === meeting.id && item.profileId === profile.id) || emptyAttendance(meeting.id, profile.id),
  })));
  const query = filters.query.trim().toLocaleLowerCase("de");
  const direction = filters.direction === "desc" ? -1 : 1;
  const visibleRows = rows
    .filter((row) => !query || [row.profile.name, row.meeting.title, row.attendance.writtenUpdate, row.attendance.absenceReason].join(" ").toLocaleLowerCase("de").includes(query))
    .filter((row) => filters.founder === "all" || row.profile.id === filters.founder)
    .filter((row) => filters.meeting === "all" || String(row.meeting.id) === filters.meeting)
    .filter((row) => filters.status === "all" || row.attendance.status === filters.status)
    .filter((row) => filters.points === "all" || row.attendance.points === Number(filters.points))
    .filter((row) => filters.signal === "all"
      || filters.signal === "missing_update" && !row.attendance.writtenUpdate.trim()
      || filters.signal === "open_reason" && Boolean(row.attendance.absenceReason.trim()) && !row.attendance.reasonAccepted)
    .sort((left, right) => {
      let comparison = 0;
      if (filters.sort === "founder") comparison = left.profile.name.localeCompare(right.profile.name, "de");
      else if (filters.sort === "status") comparison = left.attendance.status.localeCompare(right.attendance.status, "de");
      else if (filters.sort === "points") comparison = left.attendance.points - right.attendance.points;
      else comparison = left.meeting.meetingAt.localeCompare(right.meeting.meetingAt);
      return direction * (comparison || left.profile.name.localeCompare(right.profile.name, "de"));
    });
  return { rows, visibleRows, totalCount: rows.length };
}
