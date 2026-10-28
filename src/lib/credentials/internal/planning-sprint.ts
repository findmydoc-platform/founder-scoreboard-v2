import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AuthenticatedProfile } from "../../types";
import type { PlanningCredentialInput } from "../types";
import { ACTIVE_TASKS_TABLE } from "../../planning-read-model";
import { rolePermitsAction } from "./session-policy";

type PlanningSprintContext = {
  action: PlanningCredentialInput["action"]; targetId: string; profile: AuthenticatedProfile | null; service: SupabaseClient; followup: SupabaseClient;
  current(): Promise<{ code?: string; message: string } | null>;
};
const forbidden = () => ({ code: "42501", message: "Keine Berechtigung für diese Aktion." });

export function planningSprintOperations({ action, targetId, profile, service, followup, current }: PlanningSprintContext) {
  let lockProjectId = "";
  let lockStartDate = "";
  let nextSprintId = "";
  const sprintTaskIds = new Set<string>();
  let savedCommitment: Record<string, unknown> | null = null;
  return {
    async createScoreObjection(comment: string, metadata: { request_ip?: string | null; user_agent?: string | null }) {
      if (action !== "planning.sprint.objection.create" || !targetId || !profile || await current()) return { data: null, error: forbidden() };
      return await service.rpc("create_score_objection_transaction", { p_sprint_id: targetId, p_profile_id: profile.id, p_comment: comment,
        p_request_ip: metadata.request_ip || null, p_user_agent: metadata.user_agent || null });
    },
    async processScoreObjection(suppliedValues: { action: "assign_second_review" | "resolve" | "second_review"; objectionId: number; status?: string | null;
      resolutionComment?: string; deliveryPoints?: number; formPoints?: number; weeklyPoints?: number; secondReviewerProfileId?: string; secondReviewDecision?: string; expectedObjection: import("../../planning-row-types").DbScoreObjection; expectedScore: import("../../planning-row-types").DbFounderSprintScore | null },
      metadata: { request_ip?: string | null; user_agent?: string | null }) {
      const values = structuredClone(suppliedValues);
      if (action !== "planning.sprint.objection.process" || !targetId || !profile
        || (values.action !== "second_review" && !rolePermitsAction("governance.ceo", profile.platformRole)) || await current()) return { data: null, error: forbidden() };
      return await service.rpc("process_score_objection_with_basis_transaction", { p_sprint_id: targetId, p_objection_id: values.objectionId, p_actor_profile_id: profile.id,
        p_expected_objection:values.expectedObjection,p_expected_score:values.expectedScore,
        p_action: values.action, p_status: values.status || null, p_resolution_comment: values.resolutionComment || null,
        p_delivery_points: values.deliveryPoints ?? null, p_form_points: values.formPoints ?? null, p_weekly_points: values.weeklyPoints ?? null,
        p_second_reviewer_profile_id: values.secondReviewerProfileId || null, p_second_review_decision: values.secondReviewDecision || null,
        p_request_ip: metadata.request_ip || null, p_user_agent: metadata.user_agent || null });
    },
    async setReviewWindow(suppliedValues: { expectedHours: number; hours: number }, metadata: { request_ip?: string | null; user_agent?: string | null }) {
      const values = structuredClone(suppliedValues);
      if (action !== "planning.sprint.review-window" || !profile || await current()) return { data: null, error: forbidden() };
      return await service.rpc("update_founderops_review_window_transaction", { p_project_id: "findmydoc-founder-execution", p_expected_hours: values.expectedHours,
        p_review_objection_window_hours: values.hours, p_actor_profile_id: profile.id,
        p_request_ip: metadata.request_ip || null, p_user_agent: metadata.user_agent || null });
    },
    async readSprintLock() {
      if (action !== "planning.sprint.lock" || !targetId || await current()) return { data: null, error: forbidden() };
      const result = await service.from("sprints").select("id,project_id,name,status,start_date,end_date,review_due_at,score_locked,updated_at,lock_result").eq("id", targetId).single();
      if (result.data) { lockProjectId = result.data.project_id; lockStartDate = result.data.start_date || "1900-01-01"; }
      return result;
    },
    async readSprintBlockingObjections() {
      if (action !== "planning.sprint.lock" || !targetId || await current()) return { data: null, error: forbidden() };
      return await service.from("score_objections").select("id,status,second_reviewer_profile_id,second_reviewed_at", { count: "exact" }).eq("sprint_id", targetId);
    },
    async readSprintAcceptedAdjustments() {
      if (action !== "planning.sprint.lock" || !targetId || await current()) return { data: null, error: forbidden() };
      return await service.from("score_objections").select("profile_id,resolved_delivery_points,resolved_form_points,resolved_weekly_points,reviewed_at", { count: "exact" })
        .eq("sprint_id", targetId).eq("status", "accepted").not("resolved_delivery_points", "is", null).order("reviewed_at", { ascending: false });
    },
    async readSprintLockProject() {
      if (action !== "planning.sprint.lock" || !lockProjectId || await current()) return { data: null, error: forbidden() };
      return await service.from("projects").select("review_objection_window_hours").eq("id", lockProjectId).single();
    },
    async readNextSprint() {
      if (action !== "planning.sprint.lock" || !targetId || !lockStartDate || await current()) return { data: null, error: forbidden() };
      const result = await service.from("sprints").select("id,name,start_date,end_date").neq("id", targetId).gt("start_date", lockStartDate)
        .order("start_date", { ascending: true }).limit(1).maybeSingle();
      nextSprintId = result.data?.id || "";
      return result;
    },
    async readSprintTaskRows() {
      if (action !== "planning.sprint.lock" || !targetId || await current()) return { data: null, error: forbidden() };
      const result = await service
    .from(ACTIVE_TASKS_TABLE)
    .select("id,project_id,parent_task_id,title,description,status,priority,owner,assignee,workstream,sort_order,estimate_hours,definition_of_done,evidence_link,issue_number,issue_url,github_issue_number,github_issue_url,sprint_id,review_status,score_points,score_final,task_type,approval_status,score_relevant,carryover_count,original_sprint_id,problem_statement,intended_outcome,scope_constraints,acceptance_criteria,evidence_required,dod_template_version,sprint_outcome,updated_at", { count: "exact" })
    .eq("sprint_id", targetId);
      for (const task of result.data || []) sprintTaskIds.add(task.id);
      return result;
    },
    async readSprintBlockers(suppliedTaskIds: string[]) {
      const taskIds = [...suppliedTaskIds];
      if (action !== "planning.sprint.lock" || taskIds.some(id => !sprintTaskIds.has(id)) || await current()) return { data: null, error: forbidden() };
      return await service.from("task_blockers").select("id,task_id,status", { count: "exact" }).in("task_id", taskIds).eq("status", "open");
    },
    async readSprintScoringInputs() {
      if (action !== "planning.sprint.lock" || !targetId || await current()) {
        const denied = { data: null, error: forbidden() };
        return [denied, denied, denied, denied, denied] as const;
      }
      return Promise.all([
    service.from("profiles").select("id,name,platform_role,weekly_capacity", { count: "exact" }),
    service.from("sprint_commitments").select("id,sprint_id,profile_id,commitment_level,weekly_hours,note", { count: "exact" }).eq("sprint_id", targetId),
    service.from("meetings").select("id,sprint_id,title,meeting_at,duration_minutes,status,agenda", { count: "exact" }).eq("sprint_id", targetId).order("meeting_at"),
    service.from("meeting_attendance").select("id,meeting_id,profile_id,status,absence_reason,reason_accepted,written_update,points,created_at,updated_at", { count: "exact" }),
    service.from("founder_strike_state").select("id,profile_id,strike_level,fulfilled_reset_streak,last_evaluated_sprint_id,updated_at", { count: "exact" }),
  ]);
    },
    async commitSprintLock(suppliedValues: { expectedUpdatedAt: string; expectedTasks?: readonly { id: string; updatedAt: string }[]; taskUpdates: readonly Record<string, unknown>[]; acceptedBlockerTaskIds: readonly string[];
      carryoverInserts: readonly Record<string, unknown>[]; notifications: readonly Record<string, unknown>[]; scoreRows: readonly Record<string, unknown>[];
      strikeStateRows: readonly Record<string, unknown>[]; strikeEvents: readonly Record<string, unknown>[]; resultData: Record<string, unknown> },
      metadata: { request_ip?: string | null; user_agent?: string | null }) {
      const values = structuredClone(suppliedValues);
      if (action !== "planning.sprint.lock" || !targetId || !profile || values.taskUpdates.some(row => !sprintTaskIds.has(String(row.id)))
        || values.acceptedBlockerTaskIds.some(id => !sprintTaskIds.has(id))
        || values.carryoverInserts.some(row => !nextSprintId || !sprintTaskIds.has(String(row.carried_from_task_id)) || row.carried_from_sprint_id !== targetId
          || row.id !== `${String(row.carried_from_task_id)}-carryover-${nextSprintId}`) || await current()) return { data: null, error: forbidden() };
      return await service.rpc("lock_sprint_with_review_window_transaction", { p_sprint_id: targetId, p_expected_updated_at: values.expectedUpdatedAt,
        p_task_updates: values.taskUpdates, p_accepted_blocker_task_ids: values.acceptedBlockerTaskIds, p_carryover_inserts: values.carryoverInserts,
        p_notifications: values.notifications.map(row => ({ ...row, actor_profile_id: profile.id })),
        p_score_rows: values.scoreRows.map(row => ({ ...row, sprint_id: targetId, finalized_by: profile.id })),
        p_strike_state_rows: values.strikeStateRows.map(row => ({ ...row, last_evaluated_sprint_id: targetId })),
        p_strike_events: values.strikeEvents.map(row => ({ ...row, sprint_id: targetId, created_by: profile.id })),
        p_result_data: { ...Object.fromEntries(Object.entries(values.resultData).filter(([key])=>key!=="_planning_lock_basis")), ...(values.expectedTasks === undefined ? {} : { _planning_lock_basis: values.expectedTasks.map(task=>({id:task.id,updatedAt:task.updatedAt})) }) }, p_actor_profile_id: profile.id, p_request_ip: metadata.request_ip || null, p_user_agent: metadata.user_agent || null });
    },
    async readSprintPlanProject() {
      if (action !== "planning.sprint.plan" || await current()) return { data: null, error: forbidden() };
      return await service.from("projects").select("review_objection_window_hours").eq("id", "findmydoc-founder-execution").single();
    },
    async readPlannedSprints() {
      if (action !== "planning.sprint.plan" || await current()) return { data: null, error: forbidden(), count: null };
      return await service.from("sprints").select("id,name,status,start_date,end_date,review_due_at,score_locked,updated_at", { count: "exact" }).eq("project_id", "findmydoc-founder-execution").order("start_date", { ascending: true });
    },
    async readAssignedSprintIds() {
      if (action !== "planning.sprint.plan" || await current()) return { data: null, error: forbidden() };
      return await service.from(ACTIVE_TASKS_TABLE).select("sprint_id").not("sprint_id", "is", null);
    },
    async commitSprintPlan(suppliedValues: { sprints: readonly Record<string, unknown>[]; meetings: readonly Record<string, unknown>[]; auditData: Record<string, unknown> }, metadata: { request_ip?: string | null; user_agent?: string | null }) {
      const values = structuredClone(suppliedValues);
      if (action !== "planning.sprint.plan" || !profile || await current()) return { data: null, error: forbidden() };
      return await service.rpc("create_sprint_plan_with_review_window_transaction", { p_project_id: "findmydoc-founder-execution", p_sprints: values.sprints,
        p_meetings: values.meetings, p_audit_data: values.auditData, p_actor_profile_id: profile.id,
        p_request_ip: metadata.request_ip || null, p_user_agent: metadata.user_agent || null });
    },
    async readSprintSchedule() {
      if (action !== "planning.sprint.update" || !targetId || await current()) return { data: null, error: forbidden() };
      return await service.from("sprints").select("id,project_id,name,status,start_date,end_date,review_due_at,score_locked,updated_at").eq("id", targetId).single();
    },
    async readSprintTaskCount() {
      if (action !== "planning.sprint.update" || !targetId || await current()) return { count: null, error: forbidden() };
      return await service.from(ACTIVE_TASKS_TABLE).select("id", { count: "exact", head: true }).eq("sprint_id", targetId);
    },
    async commitSprintSchedule(suppliedValues: { expectedUpdatedAt: string; patch: Record<string, string | null> }, metadata: { request_ip?: string | null; user_agent?: string | null }) {
      const values = structuredClone(suppliedValues);
      if (action !== "planning.sprint.update" || !targetId || !profile || await current()) return { data: null, error: forbidden() };
      return await service.rpc("update_sprint_schedule_transaction", { p_sprint_id: targetId, p_expected_updated_at: values.expectedUpdatedAt,
        p_sprint_patch: values.patch, p_actor_profile_id: profile.id, p_request_ip: metadata.request_ip || null, p_user_agent: metadata.user_agent || null });
    },
    async writeCommitment(suppliedValues: { profileId: string; commitmentLevel: string; weeklyHours: number; note: string; expectedUpdatedAt: string | null }) {
      const values = structuredClone(suppliedValues);
      if (action !== "planning.sprint.commitment.write" || !targetId || !profile
        || (!rolePermitsAction("operations.lead", profile.platformRole) && values.profileId !== profile.id) || await current()) return { data: null, error: forbidden() };
      if (values.expectedUpdatedAt !== null && (typeof values.expectedUpdatedAt !== "string" || !values.expectedUpdatedAt.trim())) return { data: null, error: { code: "22023", message: "Die Bearbeitungsbasis fehlt." } };
      const now = Date.now();
      const row = { sprint_id: targetId, profile_id: values.profileId, commitment_level: values.commitmentLevel,
        weekly_hours: values.weeklyHours, note: values.note, updated_at: new Date(values.expectedUpdatedAt === null ? now : Math.max(now, Date.parse(values.expectedUpdatedAt) + 1)).toISOString() };
      const selection = "id,sprint_id,profile_id,commitment_level,weekly_hours,note,updated_at";
      const result = values.expectedUpdatedAt === null
        ? await service.from("sprint_commitments").insert(row).select(selection).single()
        : await service.from("sprint_commitments").update(row).eq("sprint_id", targetId).eq("profile_id", values.profileId).eq("updated_at", values.expectedUpdatedAt).select(selection).maybeSingle();
      if (result.error?.code === "23505" || (!result.error && !result.data)) return { data: null, error: { code: "commitment_revision_conflict", message: "Das Commitment wurde zwischenzeitlich geändert." } };
      if (!result.error && result.data) savedCommitment = { ...result.data };
      return result;
    },
    async auditCommitment(metadata: { request_ip?: string | null; user_agent?: string | null }) {
      if (action !== "planning.sprint.commitment.write" || !savedCommitment) return { error: forbidden() };
      return await followup.from("audit_log").insert({ actor_profile_id: profile?.id || null, action: "sprint.commitment.update",
        entity_type: "sprint_commitment", entity_id: String(savedCommitment.id), after_data: savedCommitment,
        request_ip: metadata.request_ip || null, user_agent: metadata.user_agent || null,
      });
    },
  };
}
