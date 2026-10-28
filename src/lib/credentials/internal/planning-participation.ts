import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AuthenticatedProfile, MeetingAttendanceStatus } from "../../types";
import type { PlanningCredentialInput } from "../types";
import { ACTIVE_TASKS_TABLE } from "../../planning-read-model";
import { rolePermitsAction } from "./session-policy";

type Context = { action: PlanningCredentialInput["action"]; targetId: string; profile: AuthenticatedProfile | null; service: SupabaseClient; followup: SupabaseClient;
  current(): Promise<{ code?: string; message: string } | null> };
const denied = () => ({ data: null, error: { code: "42501", message: "Keine Berechtigung für diese Aktion." } });
export function planningParticipationOperations({ action, targetId, profile, service, followup, current }: Context) {
  const lead = profile ? rolePermitsAction("operations.lead", profile.platformRole) : false;
  let attendanceProfile = "";
  const attendanceRecipients = new Set<string>();
  return {
    async readFocusTask() {
      if (action !== "planning.focus.write" || !targetId || await current()) return denied();
      return await service.from(ACTIVE_TASKS_TABLE).select("id,assignee,owner").eq("id", targetId).single();
    },
    async readFocusEntries(profileId: string, date: string) {
      if (action !== "planning.focus.write" || !profile || (!lead && profileId !== profile.id) || await current()) return denied();
      return await service.from("task_focus_items").select("id,task_id").eq("profile_id", profileId).eq("focus_date", date);
    },
    async writeFocus(suppliedValues: { profileId: string; focusDate: string; position: number; nextStep: string; status: string }) {
      const values = structuredClone(suppliedValues);
      if (action !== "planning.focus.write" || !targetId || !profile || (!lead && values.profileId !== profile.id) || await current()) return denied();
      const task = await service.from(ACTIVE_TASKS_TABLE).select("id,assignee,owner").eq("id", targetId).single();
      if (task.error || !task.data) return { data: null, error: task.error || { code: "P0002", message: "Aufgabe wurde nicht gefunden." } };
      if (!lead && (task.data.assignee || task.data.owner) !== profile.id) return denied();
      const entries = await service.from("task_focus_items").select("id,task_id").eq("profile_id", values.profileId).eq("focus_date", values.focusDate);
      if (entries.error) return { data: null, error: entries.error };
      if (!entries.data?.some(row => row.task_id === targetId) && (entries.data || []).length >= 3) return { data: null, error: { code: "23514", message: "Heute-Fokus ist auf drei Aufgaben begrenzt." } };
      return await service.from("task_focus_items").upsert({ profile_id: values.profileId, task_id: targetId, focus_date: values.focusDate,
        position: values.position, next_step: values.nextStep, status: values.status, updated_at: new Date().toISOString() }, { onConflict: "profile_id,task_id,focus_date" })
        .select("id,profile_id,task_id,focus_date,position,next_step,status,created_at,updated_at").single();
    },
    async readFocusEntry() {
      if (action !== "planning.focus.delete" || !targetId || await current()) return denied();
      return await service.from("task_focus_items").select("id,task_id,profile_id").eq("id", Number(targetId)).single();
    },
    async deleteFocus() {
      if (action !== "planning.focus.delete" || !targetId || !profile || await current()) return denied();
      const entry = await service.from("task_focus_items").select("id,task_id,profile_id").eq("id", Number(targetId)).single();
      if (entry.error || !entry.data) return { data: null, error: entry.error || { code: "P0002", message: "Fokus-Eintrag nicht gefunden." } };
      if (!lead && entry.data.profile_id !== profile.id) return denied();
      return await service.from("task_focus_items").delete().eq("id", Number(targetId));
    },
    async readAttendanceMeeting() {
      if (action !== "planning.attendance.write" || !targetId || await current()) return denied();
      return await service.from("meetings").select("id,title").eq("id", Number(targetId)).single();
    },
    async readAttendance(profileId: string) {
      if (action !== "planning.attendance.write" || !targetId || !profile || (!lead && profileId !== profile.id) || await current()) return denied();
      return await service.from("meeting_attendance").select("id,meeting_id,profile_id,status,absence_reason,reason_accepted,written_update,points,created_at,updated_at").eq("meeting_id", Number(targetId)).eq("profile_id", profileId).maybeSingle();
    },
    async writeAttendance(suppliedValues: { profileId: string; status: MeetingAttendanceStatus; absenceReason: string; reasonAccepted: boolean; writtenUpdate: string; points: number; expectedUpdatedAt: string | null }) {
      const values = structuredClone(suppliedValues);
      if (action !== "planning.attendance.write" || !targetId || !profile || await current()
        || (!lead && (values.profileId !== profile.id || !["pending", "excused", "late_excused"].includes(values.status)
          || values.reasonAccepted || values.points !== 0 || (values.status !== "pending" && !values.absenceReason)))) return denied();
      if (values.expectedUpdatedAt !== null && (typeof values.expectedUpdatedAt !== "string" || !Number.isFinite(Date.parse(values.expectedUpdatedAt)))) return { data: null, error: { code: "22023", message: "Lade die Weekly-Rückmeldung neu, bevor du speicherst." } };
      const updatedAt = new Date(Math.max(Date.now(), values.expectedUpdatedAt ? Date.parse(values.expectedUpdatedAt) + 1 : 0)).toISOString();
      const patch = { status: values.status, absence_reason: values.absenceReason, reason_accepted: values.reasonAccepted, written_update: values.writtenUpdate, points: values.points, updated_at: updatedAt };
      const columns = "id,meeting_id,profile_id,status,absence_reason,reason_accepted,written_update,points,created_at,updated_at";
      const result = values.expectedUpdatedAt === null
        ? await service.from("meeting_attendance").insert({ meeting_id: Number(targetId), profile_id: values.profileId, ...patch }).select(columns).single()
        : await service.from("meeting_attendance").update(patch).eq("meeting_id", Number(targetId)).eq("profile_id", values.profileId).eq("updated_at", values.expectedUpdatedAt).select(columns).maybeSingle();
      if (result.error?.code === "23505" || !result.error && !result.data) return { data: null, error: { code: "attendance_revision_conflict", message: "Die Weekly-Rückmeldung wurde inzwischen geändert. Vergleiche die Änderungen." } };
      if (!result.error && result.data) { attendanceProfile = values.profileId; attendanceRecipients.clear(); if (lead && values.profileId !== profile.id) attendanceRecipients.add(values.profileId); }
      return result;
    },
    async readAttendanceLeads() {
      if (action !== "planning.attendance.write" || !attendanceProfile) return denied();
      const result = await followup.from("profiles").select("id").in("platform_role", ["ceo", "deputy"]);
      for (const row of result.data || []) if (row.id !== profile?.id) attendanceRecipients.add(row.id);
      return result;
    },
    async notifyAttendance(notifications: readonly Record<string, unknown>[]) {
      if (action !== "planning.attendance.write" || !attendanceProfile || !profile || notifications.some(row => row.actor_profile_id !== profile.id
        || String(row.entity_id) !== targetId || row.entity_type !== "meeting" || row.type !== "meeting.attendance_updated" || !attendanceRecipients.has(String(row.recipient_profile_id)))) return denied();
      return await followup.from("notification_events").insert(notifications);
    },
    async auditAttendance(suppliedValues: Record<string, unknown>, metadata: { request_ip?: string | null; user_agent?: string | null }) {
      const values = structuredClone(suppliedValues);
      if (action !== "planning.attendance.write" || !attendanceProfile || !profile) return denied();
      return await followup.from("audit_log").insert({ actor_profile_id: profile.id, action: "meeting.attendance.update", entity_type: "meeting", entity_id: targetId,
        after_data: { ...values, profileId: attendanceProfile }, request_ip: metadata.request_ip || null, user_agent: metadata.user_agent || null });
    },
  };
}
