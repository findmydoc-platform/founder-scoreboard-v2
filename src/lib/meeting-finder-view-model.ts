import {
  addDaysKey,
  calendarMonthGridDates,
  clampMeetingDuration,
  dateKey,
  findMeetingSlots,
  formatCalendarMonthLabel,
  formatCalendarSingleMonthLabel,
  formatDateLabel,
  monthEndKey,
  monthStartKey,
  timeToMinutes,
} from "@/lib/meeting-finder";
import type { PlanningData, Profile } from "@/lib/types";

export function buildMeetingFinderDefaults({
  data,
  currentProfile,
  canManageAvailability,
}: {
  data: PlanningData;
  currentProfile: Profile | null;
  canManageAvailability: boolean;
}) {
  const today = dateKey(new Date());
  const defaultEnd = addDaysKey(today, 14);
  const selectableProfiles = data.profiles.filter((profile) => profile.platformRole !== "viewer");
  const editableProfiles = canManageAvailability
    ? selectableProfiles
    : selectableProfiles.filter((profile) => profile.id === currentProfile?.id);
  const defaultEditableProfileId = currentProfile?.id && editableProfiles.some((profile) => profile.id === currentProfile.id)
    ? currentProfile.id
    : editableProfiles[0]?.id || "";
  const defaultSelectedProfileIds = currentProfile?.id && selectableProfiles.some((profile) => profile.id === currentProfile.id)
    ? [currentProfile.id]
    : selectableProfiles.slice(0, 1).map((profile) => profile.id);

  return {
    today,
    defaultEnd,
    selectableProfiles,
    editableProfiles,
    defaultEditableProfileId,
    defaultSelectedProfileIds,
  };
}

export function buildMeetingFinderViewModel({
  data,
  selectedProfileIds,
  selectableProfiles,
  editableProfiles,
  fromDate,
  toDate,
  duration,
  customDuration,
  searchStartTime,
  searchEndTime,
  calendarWeekStart,
  calendarView,
  canCreateMeeting,
}: {
  data: PlanningData;
  selectedProfileIds: string[];
  selectableProfiles: Profile[];
  editableProfiles: Profile[];
  fromDate: string;
  toDate: string;
  duration: string;
  customDuration: string;
  searchStartTime: string;
  searchEndTime: string;
  calendarWeekStart: string;
  calendarView: "week" | "month";
  canCreateMeeting: boolean;
}) {
  const workingHours = data.availability.filter((entry) => entry.type === "working_hours");
  const blockers = data.availability.filter((entry) => entry.type === "vacation" || entry.type === "sick" || entry.type === "busy");
  const googleCalendarBlocks = blockers.filter((entry) => entry.source === "google_calendar");
  const googleCalendarProfiles = selectableProfiles.filter((profile) => profile.googleCalendarSyncEnabled && profile.googleCalendarEmail);
  const lastGoogleSync = googleCalendarProfiles
    .map((profile) => profile.googleCalendarLastSyncedAt)
    .filter(Boolean)
    .sort()
    .at(-1) || "";
  const profileNameById = new Map(data.profiles.map((profile) => [profile.id, profile.name]));
  const profileById = new Map(data.profiles.map((profile) => [profile.id, profile]));
  const durationMinutes = duration === "custom" ? clampMeetingDuration(Number(customDuration)) : clampMeetingDuration(Number(duration));
  const searchStartMinutes = timeToMinutes(searchStartTime);
  const searchEndMinutes = timeToMinutes(searchEndTime);
  const slots = selectedProfileIds.length && searchStartMinutes < searchEndMinutes
    ? findMeetingSlots(data, selectedProfileIds, fromDate, toDate, durationMinutes, searchStartMinutes, searchEndMinutes)
    : [];
  const calendarDates = Array.from({ length: 7 }, (_, index) => addDaysKey(calendarWeekStart, index));
  const calendarWeekEnd = calendarDates[6] || calendarWeekStart;
  const calendarMonthLabel = formatCalendarMonthLabel(calendarWeekStart, calendarWeekEnd);
  const calendarTitle = calendarView === "week" ? calendarMonthLabel : formatCalendarSingleMonthLabel(calendarWeekStart);
  const calendarSubtitle = calendarView === "week"
    ? `${formatDateLabel(calendarWeekStart)} bis ${formatDateLabel(calendarWeekEnd)}`
    : `${formatDateLabel(monthStartKey(calendarWeekStart))} bis ${formatDateLabel(monthEndKey(calendarWeekStart))}`;
  const calendarMonthDates = calendarMonthGridDates(calendarWeekStart);
  const calendarActiveMonth = new Date(`${calendarWeekStart}T00:00:00`).getMonth();
  const calendarHours = Array.from({ length: 14 }, (_, index) => 8 * 60 + index * 60);
  const activeSprint = data.sprints.find((sprint) => sprint.status === "active") || data.sprints[0];
  const canReserveMeetingSlot = canCreateMeeting && Boolean(selectedProfileIds.length && activeSprint);
  const plannedMeetings = data.meetings
    .filter((meeting) => meeting.status !== "cancelled")
    .sort((a, b) => new Date(a.meetingAt).getTime() - new Date(b.meetingAt).getTime())
    .slice(0, 8);
  const profileOptions = editableProfiles.map((profile) => ({ value: profile.id, label: profile.name }));

  return {
    workingHours,
    blockers,
    googleCalendarBlocks,
    googleCalendarProfiles,
    lastGoogleSync,
    profileNameById,
    profileById,
    durationMinutes,
    searchStartMinutes,
    searchEndMinutes,
    slots,
    calendarDates,
    calendarWeekEnd,
    calendarMonthLabel,
    calendarTitle,
    calendarSubtitle,
    calendarMonthDates,
    calendarActiveMonth,
    calendarHours,
    activeSprint,
    canReserveMeetingSlot,
    plannedMeetings,
    profileOptions,
  };
}
