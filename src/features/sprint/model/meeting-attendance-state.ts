import type { Meeting, MeetingAttendance } from "@/lib/types";
import type { PlanningReadStatus, PlanningTaskSaveCheck } from "@/features/planning/model/planning-state";
export type MeetingAttendancePatch = Partial<Pick<MeetingAttendance, "status" | "absenceReason" | "reasonAccepted" | "writtenUpdate" | "points">>;
export type MeetingAttendanceReceipt = { attendance: MeetingAttendance; effects: "confirmed" | "unconfirmed"; warning?: string };
export type MeetingAttendanceEditView = { id: string; meetingId: number; profileId: string; phase: "editing" | "loading" | "saving" | "confirmed" | "rejected" | "conflict" | "unconfirmed" | "blocked" | "ended"; submitted: MeetingAttendancePatch | null; serverRecord: MeetingAttendance | null; compared: boolean; error: string; warning: string; checking: boolean; readStatus: PlanningReadStatus };
export type MeetingAttendanceResult = { ok: true } | { ok: false; kind: "ended" | "rejected" | "conflict" | "unconfirmed" | "blocked"; error: string };
export type MeetingAttendanceEditor = { view(): MeetingAttendanceEditView; prepare(): Promise<MeetingAttendance | null>; save(patch: MeetingAttendancePatch): Promise<MeetingAttendanceResult>; checkOutcome(): Promise<PlanningTaskSaveCheck>; refreshConflict(): Promise<void>; resave(patch: MeetingAttendancePatch): Promise<MeetingAttendanceResult>; close(): void };
export interface MeetingAttendanceAdapter {
 readMeetingAttendance?(meetingId: number, profileId: string): Promise<{ attendance: MeetingAttendance | null }>;
 saveMeetingAttendance?(meeting: Meeting, basis: MeetingAttendance | null, input: MeetingAttendance & { profileId: string }): Promise<MeetingAttendanceReceipt>;
}
export interface PlanningMeetingAttendance {
 beginMeetingAttendance(meeting: Meeting, profileId: string, shown: MeetingAttendance | null): MeetingAttendanceEditor;
 meetingAttendance(meetingId: number, profileId: string): { record: MeetingAttendance | null; readStatus: PlanningReadStatus };
 meetingAttendanceEdits(meetingId: number, profileId: string): readonly MeetingAttendanceEditView[];
 resumeMeetingAttendance(id: string): MeetingAttendanceEditor | null;
}
