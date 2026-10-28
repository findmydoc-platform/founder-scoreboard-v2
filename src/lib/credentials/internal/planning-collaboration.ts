import "server-only";
import type { NextRequest } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AuthenticatedProfile, Task as PlanningTask } from "../../types";
import type { PlanningCredentialInput } from "../types";
import { authorizeGitHubAttachment } from "./github-user";
import { uploadGitHubAttachment } from "../../github";
import { defaultGitHubRepository } from "../../github-repositories";
import { GitHubAppUserTokenBusyError, GitHubAppUserTokenRequiredError } from "../../github-app-errors";
import { ACTIVE_TASKS_TABLE } from "../../planning-read-model";
import { loadGitHubMentionTeam } from "../../github-mention-team-config";
import { importGitHubTaskCommentsWithMentions } from "../../github-comment-mention-import";
import { projectTaskToGitHub } from "../../github-sync/task-projection";
import { taskGitHubSyncFailure } from "../../github-sync/contract";
import { authorizeGitHubInstallation } from "./github-installation";
import { FOUNDEROPS_GITHUB_REPOSITORIES } from "../../github-project-config";
import { requireActivePlanningItem } from "../../planning-trash-mutation-guard";
import { deliverPendingGitHubComments } from "../../github-comment-delivery";
import { taskDetailPermissions } from "@/features/tasks/model/task-detail-permissions";

type Context = { action: PlanningCredentialInput["action"]; targetId: string; profile: AuthenticatedProfile | null; request: NextRequest; service: SupabaseClient; followup: SupabaseClient;
  current(): Promise<{ code?: string; message: string } | null> };
const denied = () => ({ data: null, error: { code: "42501", message: "Keine Berechtigung für diese Aktion." } });
const columns = { "planning.github-comments.import": "id,title,assignee,owner,status,review_owner_profile_id,review_status,score_final,evidence_link,updated_at,issue_url,github_repo,github_issue_number,issue_number,task_type", "planning.attachment.write": "id,title,task_type,assignee,owner,status,review_owner_profile_id,review_status,score_final,github_repo,github_issue_number,issue_number", "planning.comment.create": "id,title,task_type,assignee,owner,github_issue_number,github_issue_url,issue_number,issue_url",
  "planning.blocker.report": "id,title,assignee,owner,status,task_type,review_status,score_final" };
type Task = { id: string; title: string; task_type: "epic" | "initiative" | "deliverable" | "sub_issue"; github_repo?: string; github_issue_number?: number; issue_number?: string; github_issue_url?: string; review_owner_profile_id?: string; evidence_link?: string | null; updated_at?: string; issue_url?: string; assignee?: string; owner?: string; status?: PlanningTask["status"]; review_status?: PlanningTask["reviewStatus"]; score_final?: boolean };
export function planningCollaborationOperations({ action, targetId, profile, service, followup, request, current }: Context) {
  const permitted = action === "planning.comment.create" || action === "planning.blocker.report" || action === "planning.attachment.write" || action === "planning.github-comments.import";
  const commentIds = new Set<number>();
  let deliveryApplicable = false;
  let attachmentReady = false;
  let attachmentRepository: string | undefined;
  let uploadedAttachment: { filename: string; contentType: string; size: number; url: string } | null = null;
  const readTask = async () => {
    if (!permitted || !targetId || await current()) return denied();
    const result = await service.from("tasks").select(columns[action as keyof typeof columns]).eq("id", targetId).single<Task>();
    if (action === "planning.attachment.write" && result.data && profile) {
      const row = result.data;
      const permissions = taskDetailPermissions({ task: { assignee: row.assignee || "", assigneeId: row.assignee || "", owner: row.owner || "", ownerId: row.owner || "",
        reviewOwnerProfileId: row.review_owner_profile_id || "", reviewStatus: row.review_status || "not_requested", scoreFinal: Boolean(row.score_final), status: row.status || "", taskType: row.task_type }, profile, unrestricted: false });
      attachmentRepository = row.github_repo;
      attachmentReady = row.task_type === "deliverable" ? permissions.canEditEvidence : row.task_type === "sub_issue" && permissions.canEditBrief;
    }
    return result;
  };
  return {
    async ensureCollaborationActive() {
      if (!permitted || !targetId || await current()) return { ok: false as const, status: 403, error: "Keine Berechtigung für diese Aktion." };
      return requireActivePlanningItem(service, targetId);
    },
    readCollaborationTask: readTask,
    async readProjectionKind() {
      if (action !== "planning.github-sync.apply" || !targetId || await current()) return denied();
      return await service.from(ACTIVE_TASKS_TABLE).select("task_type").eq("id", targetId).maybeSingle();
    },
    async projectToGitHub(createIfMissing: boolean) {
      if (action !== "planning.github-sync.apply" || !targetId || !profile || await current()) return taskGitHubSyncFailure("github_sync_forbidden", "Keine Berechtigung für diese Aktion.");
      let installation;
      try {
        installation = await authorizeGitHubInstallation({ credential: { kind: "github-installation" }, action: "github.projection.apply", target: { repositories: FOUNDEROPS_GITHUB_REPOSITORIES } });
      } catch (error) {
        return taskGitHubSyncFailure("github_sync_unavailable", error instanceof Error ? error.message : "GitHub-Verbindung konnte nicht geprüft werden.");
      }
      return projectTaskToGitHub({ supabase: service, installationToken: installation.github, taskId: targetId, actorProfileId: profile.id, createIfMissing });
    },
    async readGitHubImportProfiles() {
      if (action !== "planning.github-comments.import" || await current()) return denied();
      return await service.from("profiles").select("id,name,github_login");
    },
    async readGitHubMentionTeam() {
      if (action !== "planning.github-comments.import" || await current()) throw Object.assign(new Error("Keine Berechtigung für diese Aktion."), { code: "42501" });
      return loadGitHubMentionTeam(service);
    },
    async readExistingExternalComments(externalIds: string[]) {
      if (action !== "planning.github-comments.import" || !targetId || await current()) return denied();
      return await service.from("task_external_comments").select("external_id,author_login,body,source_updated_at,mention_recipient_profile_ids,mention_recipients_initialized")
        .eq("source", "github").in("external_id", externalIds);
    },
    async importExternalComments(rows: Record<string, unknown>[]) {
      if (action !== "planning.github-comments.import" || !targetId || await current()) return denied();
      const active = await requireActivePlanningItem(service, targetId);
      if (!active.ok) return { data: null, error: { code: active.status === 409 ? "P0010" : "P0002", message: active.error } };
      return importGitHubTaskCommentsWithMentions(service, targetId, rows);
    },
    async readImportedComments() {
      if (action !== "planning.github-comments.import" || !targetId || await current()) return { ...denied(), count: null };
      return await service.from("task_external_comments").select("id,task_id,source,external_id,author_login,author_avatar_url,body,html_url,created_at,imported_at", { count: "exact" })
        .eq("task_id", targetId).eq("source", "github").order("created_at", { ascending: true });
    },
    async updateImportedEvidence(evidence: string) {
      if (action !== "planning.github-comments.import" || !profile) return denied();
      const result = await readTask();
      if (result.error || !result.data) return { data: null, error: result.error };
      const row = result.data;
      const permissions = taskDetailPermissions({ task: { assignee: row.assignee || "", assigneeId: row.assignee || "", owner: row.owner || "", ownerId: row.owner || "",
        reviewOwnerProfileId: row.review_owner_profile_id || "", reviewStatus: row.review_status || "not_requested", scoreFinal: Boolean(row.score_final), status: row.status || "",
        taskType: row.task_type === "sub_issue" ? "sub_issue" : "deliverable" }, profile, unrestricted: false });
      const previous = String(row.evidence_link || "").trim();
      if (!permissions.canEditEvidence || (previous && previous !== String(row.issue_url || "").trim())) return denied();
      if (!row.updated_at || row.evidence_link !== null && typeof row.evidence_link !== "string" || await current()) return denied();
      const update = service.from("tasks").update({ evidence_link: evidence, github_issue_sync_status: "not_synced", github_issue_sync_error: null })
        .eq("id", targetId).eq("updated_at", row.updated_at);
      const compared = row.evidence_link === null ? update.is("evidence_link", null) : update.eq("evidence_link", row.evidence_link);
      const saved = await compared.select("id").maybeSingle();
      if (saved.error || saved.data) return saved;
      return { data: null, error: { code: "import_evidence_stale", message: "Der Nachweis wurde inzwischen geändert. Die Kommentare wurden nicht importiert." } };
    },
    async uploadAttachment(input: { path: string; bytes: Uint8Array; filename: string; contentType: string }) {
      const path = input.path, bytes = Buffer.from(input.bytes), filename = input.filename, contentType = input.contentType;
      const repository = attachmentRepository;
      if (action !== "planning.attachment.write" || !attachmentReady || !profile || !path.startsWith(`.fmd-attachments/tasks/${targetId}/`) || await current()) return { ok: false as const, status: 403, error: "Keine Berechtigung für diese Aktion." };
      let capability;
      try {
        capability = (await authorizeGitHubAttachment({ credential: { kind: "session-request", request }, action: "github.attachment.write", target: { taskId: targetId, path, repository: repository || defaultGitHubRepository } })).github;
      } catch (error) {
        return { ok: false as const, status: error instanceof GitHubAppUserTokenBusyError ? 503 : error instanceof GitHubAppUserTokenRequiredError ? 401 : 403,
          error: error instanceof Error ? error.message : "GitHub-Verbindung konnte nicht geprüft werden." };
      }
      try {
        const uploaded = await uploadGitHubAttachment(path, bytes, capability, `Add attachment for Founder Scoreboard task ${targetId}`, repository);
        uploadedAttachment = { filename, contentType, size: bytes.length, url: uploaded.rawUrl };
        return { ok: true as const, uploaded };
      } catch {
        return { ok: false as const, status: 502, error: "Ob der Anhang auf GitHub hochgeladen wurde, ist noch unklar. Prüfe zuerst die Aufgabe." };
      }
    },
    async recordAttachment(metadata: { request_ip?: string | null; user_agent?: string | null }) {
      if (action !== "planning.attachment.write" || !uploadedAttachment || !profile) return { ...denied(), taskSyncConfirmed: false };
      const result = await followup.from("audit_log").insert({ entity_type: "task", entity_id: targetId, action: "task.attachment_uploaded", actor_profile_id: profile.id,
        after_data: { ...uploadedAttachment }, request_ip: metadata.request_ip || null, user_agent: metadata.user_agent || null }).select("id,entity_id,action,actor_profile_id,before_data,after_data,created_at").single();
      let taskSyncConfirmed = false;
      if (!result.error && result.data) {
        try {
          const sync = await followup.from("tasks").update({ github_issue_sync_status: "not_synced", github_issue_sync_error: null }).eq("id", targetId).select("id").maybeSingle();
          taskSyncConfirmed = !sync.error && sync.data?.id === targetId;
        } catch { /* The upload and returned activity remain confirmed when the sync marker is uncertain. */ }
      }
      return { ...result, taskSyncConfirmed };
    },
    async readCollaborationProfiles() {
      if ((action !== "planning.comment.create" && action !== "planning.blocker.report") || await current()) return denied();
      return await service.from("profiles").select("id,name,github_login,platform_role");
    },
    async writeComment(suppliedValues: { comment: string; mentions: string[]; recipients: string[] }) {
      const values = structuredClone(suppliedValues);
      if (action !== "planning.comment.create" || !profile) return denied();
      const task = await readTask();
      if (task.error || !task.data) return { data: null, error: task.error };
      const active = await requireActivePlanningItem(service, targetId);
      if (!active.ok) return { data: null, error: { code: active.status === 409 ? "P0010" : "P0002", message: active.error } };
      const team = await service.from("profiles").select("id,platform_role");
      if (team.error) return { data: null, error: team.error };
      const profileIds = new Set((team.data || []).map(row => row.id));
      const recipients = new Set((team.data || []).filter(row => ["ceo", "deputy"].includes(row.platform_role)).map(row => row.id));
      recipients.add(task.data.assignee || task.data.owner || "");
      if (values.mentions.some(id => !profileIds.has(id)) || values.recipients.some(id => !recipients.has(id))) return denied();
      deliveryApplicable = !["epic", "initiative"].includes(task.data.task_type);
      const result = await service.rpc("create_task_comment_with_notifications", { p_task_id: targetId, p_profile_id: profile.id, p_comment: values.comment,
        p_deliver_to_github: deliveryApplicable, p_mention_recipient_profile_ids: values.mentions, p_comment_recipient_profile_ids: values.recipients });
      if (!result.error && result.data?.comment?.task_id === targetId && result.data.comment.profile_id === profile.id) commentIds.add(result.data.comment.id);
      return result;
    },
    async deliverComments() {
      if (action !== "planning.comment.create" || !commentIds.size || !deliveryApplicable) return;
      await deliverPendingGitHubComments({ supabase: followup, taskId: targetId, limit: 20 });
    },
    async readCommentDelivery(commentId: number) {
      if (action !== "planning.comment.create" || !commentIds.has(commentId)) return denied();
      return await followup.from("task_comment_github_deliveries").select("status,github_comment_url").eq("task_comment_id", commentId)
        .maybeSingle<{ status: string; github_comment_url: string | null }>();
    },
    async writeBlocker(suppliedValues: { reason: string; impact: string; needsHelpFrom: string; notifications: Record<string, unknown>[]; mentions: string[] },
      metadata: { request_ip?: string | null; user_agent?: string | null }) {
      const values = structuredClone(suppliedValues);
      if (action !== "planning.blocker.report" || !profile) return denied();
      const task = await readTask();
      if (task.error || !task.data) return { data: null, error: task.error };
      const row = task.data;
      const permissions = taskDetailPermissions({ task: { assignee: row.assignee || "", assigneeId: row.assignee || "", owner: row.owner || "", ownerId: row.owner || "",
        reviewOwnerProfileId: "", reviewStatus: row.review_status || "not_requested", scoreFinal: Boolean(row.score_final), status: row.status || "",
        taskType: row.task_type === "sub_issue" ? "sub_issue" : "deliverable" }, profile, unrestricted: false });
      if (!permissions.canReportBlocker || values.notifications.some(row => row.actor_profile_id !== profile.id || row.entity_id !== targetId || row.entity_type !== "task" || row.type !== "task.blocker_reported")) return denied();
      const active = await requireActivePlanningItem(service, targetId);
      if (!active.ok) return { data: null, error: { code: active.status === 409 ? "P0010" : "P0002", message: active.error } };
      const team = await service.from("profiles").select("id,platform_role");
      if (team.error) return { data: null, error: team.error };
      const profileIds = new Set((team.data || []).map(row => row.id));
      const leads = new Set((team.data || []).filter(row => ["ceo", "deputy"].includes(row.platform_role)).map(row => row.id));
      if (values.mentions.some(id => !profileIds.has(id)) || values.notifications.some(row => !leads.has(String(row.recipient_profile_id)))) return denied();
      return await service.rpc("report_task_blocker_transaction_v2", { p_task_id: targetId, p_actor_profile_id: profile.id, p_reason: values.reason,
        p_impact: values.impact, p_needs_help_from: values.needsHelpFrom, p_notifications: values.notifications, p_mention_recipient_profile_ids: values.mentions,
        p_request_ip: metadata.request_ip, p_user_agent: metadata.user_agent || null });
    },
  };
}
