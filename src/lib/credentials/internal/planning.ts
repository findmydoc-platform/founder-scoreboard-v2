import "server-only";
import type { CredentialAction, PlanningCredentialInput } from "../types";
import { authorizeSessionPolicy, currentAdministratorAccess, administratorAccessFailure, rolePermitsAction } from "./session-policy";
import { getServerServiceRoleSupabase } from "../../supabase-service-role";
import { getServerSupabase } from "../../supabase";
import { ACTIVE_TASKS_TABLE } from "../../planning-read-model";

import { createSupabaseBacklogReadModel } from "@/features/backlog/server/backlog-read-model-supabase";
import { createSupabaseSprintReadModel } from "@/features/sprint/server/sprint-read-model-supabase";
import { createSupabaseTaskDetailReadModel } from "@/features/tasks/server/task-detail-read-model-supabase";
import { createSupabasePlanningBoardReadModel } from "@/features/planning/server/planning-board-read-model-supabase";
import { loadPlanningHeaderData } from "../../planning-header-data";
import { sharedPlanningHeaderSlotLoaders } from "../../planning-header-cache";
import type { PlanningHeaderSlotKey } from "../../planning-header-data";

import { createPlanningTrashPlanningItems, planningTrashTransactionFromResult, runPlanningTrashLifecycle, type PlanningTrashTransactionResult } from "@/features/planning-items/model/planning-items-trash";
import { createBacklogMovePlanningItems } from "@/features/planning-items/model/planning-items-backlog-move";
import { createSprintAssignmentPlanningItems } from "@/features/planning-items/model/planning-items-sprint-assignment";
import { createPlanningReparentPlanningItems } from "@/features/planning-items/model/planning-items-reparent";
import { createEmptyEpicDeletePlanningItems } from "@/features/planning-items/model/planning-items-empty-epic-delete";
import { createPlanningRelationshipPlanningItems } from "@/features/planning-items/model/planning-items-relationships";
import { createBrowserCreatePlanningItems, browserCreateTransactionFromResult, type BrowserCreateWriter } from "@/features/planning-items/model/planning-items-create";
import { createPlanningApprovalPlanningItems, runPlanningApprovalLifecycle } from "@/features/planning-items/model/planning-items-approval";
import { validateStoredPlanningContent } from "@/features/planning-items/model/planning-item-content-server";
import { createPlanningItemRevision } from "@/features/planning-items/model/planning-item-revision";
import type { TaskUpdatePayload } from "@/features/tasks/model/task-mutation-contract";
import { actorContextFromSessionAuth } from "@/features/planning-items/model/planning-actor-context-server";
import { createPlanningReviewPlanningItems } from "@/features/planning-items/model/planning-items-review";
import { deliverPendingGitHubReviews } from "../../github-review-delivery";
import type { PlanningInvocation, PlanningResult } from "@/features/planning-items/model/planning-items";

type BoundInvocation = Omit<PlanningInvocation, "actor" | "mode">;
const rejected = (): PlanningResult => ({ ok: false, error: { code: "forbidden", reason: "actionBinding" } });
import { planningSprintOperations } from "./planning-sprint";
const forbidden = () => ({ code: "42501", message: "Keine Berechtigung für diese Aktion." });
const planningPolicyActions: Record<PlanningCredentialInput["action"], CredentialAction> = {
  "planning.revision.read": "team.read", "planning.board.read": "team.read", "planning.header.read": "team.read",
  "planning.backlog.read": "team.read", "planning.sprint.read": "team.read", "planning.task.read": "team.read",
  "planning.review.request": "planning.contribute", "planning.review.decide": "planning.contribute",
  "planning.review.withdraw": "planning.contribute", "planning.review.reopen": "planning.contribute",
  "planning.task.update": "planning.correct", "planning.relationship.add": "planning.correct", "planning.relationship.remove": "planning.correct",
  "planning.task.delete": "operations.lead", "planning.task.create": "planning.contribute",
  "planning.sprint.commitment.write": "planning.contribute", "planning.sprint.update": "operations.lead",
  "planning.sprint.plan": "operations.lead", "planning.sprint.lock": "governance.ceo", "planning.sprint.review-window": "governance.ceo",
  "planning.sprint.objection.create": "planning.contribute", "planning.sprint.objection.process": "planning.contribute", "planning.sprint.assign": "operations.lead", "planning.backlog.move": "planning.contribute", "planning.approval.decide": "planning.contribute", "planning.trash.withdraw": "planning.contribute", "planning.trash.restore": "operations.lead",
};
export function isPlanningAction(value: string): value is PlanningCredentialInput["action"] {
  return Object.hasOwn(planningPolicyActions, value);
}


export async function authorizePlanning(input: PlanningCredentialInput) {
  if (input.credential.kind !== "session-request") return { ok: false as const, status: 403, error: "Keine Berechtigung für diese Aktion." };
  const action = input.action;
  const targetId = input.targetId?.trim() || "";
  const targetIds = new Set(input.targetIds || []);
  const permission = await authorizeSessionPolicy(input.credential.request, planningPolicyActions[action]);
  if (!permission.ok) return permission;
  const strictService = action === "planning.approval.decide" || action.startsWith("planning.trash.");
  const service = strictService ? getServerServiceRoleSupabase() : getServerSupabase();
  if (!service && strictService) return { ok: false as const, status: 503, error: action.startsWith("planning.trash.") ? "Server-Service für den Papierkorb ist nicht konfiguriert." : "Server-Service für Freigaben ist nicht konfiguriert." };
  if (!service) return { ok: false as const, status: 501, error: "Supabase env is not configured." };
  const profile = permission.profile;
  const actor = actorContextFromSessionAuth(permission);
  const authority = "authority" in permission ? permission.authority : undefined;
  const correction = authority?.capabilities.operationalCorrection === true;
  const failure = async () => {
    const result = permission.data ? await permission.data.rpc("administrator_access_snapshot") : null;
    return administratorAccessFailure(currentAdministratorAccess(result?.error ? null : result?.data));
  };
  const reviewKinds: Partial<Record<PlanningCredentialInput["action"], string>> = {
    "planning.task.update": "requestReview", "planning.review.request": "requestReview", "planning.review.decide": "decideReview", "planning.review.withdraw": "withdrawReview", "planning.review.reopen": "reopenReview",
  };
  let reviewCommitted = false;
  let observedKind = "";
  let approvedKind = "";
  let trashTransaction: PlanningTrashTransactionResult | null = null;
  const createdIds = new Set<string>();
  const current = async () => {
    if (!permission.data) return null;
    const result = await permission.data.rpc("current_authenticated_profile");
    if (result.error) return { code: result.error.code, message: "Berechtigung konnte nicht geprüft werden." };
    if (result.data?.id !== profile?.id || result.data?.platform_role !== profile?.platformRole) return forbidden();
    if (correction) {
      if (Date.parse(authority!.administratorAccess.expiresAt || "") <= Date.now()) return forbidden();
      const snapshot = await permission.data.rpc("administrator_access_snapshot");
      if (snapshot.error || !currentAdministratorAccess(snapshot.data).active) return forbidden();
    }
    return null;
  };
  return { ok: true as const, profile: profile ? Object.freeze({ ...profile }) : null, authority: authority ? Object.freeze({ ...authority, profile: Object.freeze({ ...authority.profile }), administratorAccess: Object.freeze({ ...authority.administratorAccess }), capabilities: Object.freeze({ ...authority.capabilities }) }) : undefined, planning: {
    ...planningSprintOperations({ action, targetId, profile, service, current }),
    async readItemKind() {
      if ((action !== "planning.approval.decide" && !action.startsWith("planning.trash.")) || !targetId || await current()) return { data: null, error: forbidden() };
      const result = await service.from("tasks").select("task_type").eq("id", targetId).maybeSingle<{ task_type: string }>();
      if (result.data) observedKind = result.data.task_type;
      return result;
    },
    async runTrash(kind: "initiative" | "deliverable", call: BoundInvocation): Promise<PlanningResult> {
      const expected = action === "planning.trash.withdraw" ? "withdraw" : action === "planning.trash.restore" ? "restore" : null;
      if (!expected || kind !== observedKind || !actor.ok || call.command.kind !== "actOnItem" || call.command.action.kind !== expected
        || !("itemId" in call.command.action) || call.command.action.itemId !== targetId || !targetId || await current()) return rejected();
      const result = await createPlanningTrashPlanningItems(service, kind).run({ ...call, actor: actor.actor, mode: "commit" });
      if (result.ok && result.status === "committed") {
        const transaction = planningTrashTransactionFromResult(result);
        if (transaction?.rootId === targetId && transaction.rootType === kind) trashTransaction = structuredClone(transaction);
      }
      return result;
    },
    async trashLifecycle() {
      if (!action.startsWith("planning.trash.") || !trashTransaction) throw Object.assign(new Error("Keine gebundene Papierkorb-Transaktion vorhanden."), { code: "42501" });
      return runPlanningTrashLifecycle(service, trashTransaction);
    },
    async runApproval(kind: "initiative" | "deliverable", call: BoundInvocation): Promise<PlanningResult> {
      if (action !== "planning.approval.decide" || kind !== observedKind || !actor.ok || call.command.kind !== "actOnItem" || call.command.action.kind !== "decideApproval"
        || call.command.action.itemId !== targetId || !targetId || await current()) return rejected();
      const result = await createPlanningApprovalPlanningItems(service, kind).run({ ...call, actor: actor.actor, mode: "commit" });
      if (result.ok && result.status === "committed") approvedKind = kind;
      return result;
    },
    async approvalLifecycle() {
      if (action !== "planning.approval.decide" || approvedKind !== "deliverable") throw Object.assign(new Error("Keine gebundene Freigabe vorhanden."), { code: "42501" });
      return runPlanningApprovalLifecycle(service, targetId);
    },
    async runBacklogMove(call: BoundInvocation): Promise<PlanningResult> {
      if (action !== "planning.backlog.move" || !actor.ok || call.command.kind !== "actOnItem" || call.command.action.kind !== "moveBacklog"
        || !targetId || call.command.action.itemId !== targetId || !targetIds.has(call.command.action.before?.itemId || call.command.action.after?.itemId || "") || await current()) return rejected();
      return createBacklogMovePlanningItems(service).run({ ...call, actor: actor.actor, mode: "commit" });
    },
    async runSprintAssignment(call: BoundInvocation): Promise<PlanningResult> {
      if (action !== "planning.sprint.assign" || !actor.ok || call.command.kind !== "actOnItem" || call.command.action.kind !== "assignSprint"
        || !targetId || call.command.action.sprintId !== targetId || call.command.action.items.some(item => !targetIds.has(item.itemId)) || await current()) return rejected();
      return createSprintAssignmentPlanningItems(service).run({ ...call, actor: actor.actor, mode: "commit" });
    },
    async runCreate(writer: BrowserCreateWriter, call: BoundInvocation): Promise<PlanningResult> {
      if (action !== "planning.task.create" || !actor.ok || call.command.kind !== "createItems" || call.command.items.length !== 1 || await current()) return rejected();
      const item = call.command.items[0];
      const row = writer.kind === "strategic" ? writer.params.item : writer.params.taskInsert;
      if (row.task_type !== item.kind || (writer.kind === "strategic") !== ["epic", "initiative"].includes(item.kind)) return rejected();
      const boundWriter: BrowserCreateWriter = writer.kind === "delivery"
        ? { ...writer, params: { ...writer.params, taskInsert: { ...writer.params.taskInsert, created_by: profile!.id }, approveNow: false } }
        : writer;
      const result = await createBrowserCreatePlanningItems({ supabase: service, actor: actor.actor, writer: boundWriter }).run({ ...call, actor: actor.actor, mode: "commit" });
      if (result.ok && result.status === "committed") {
        const transaction = browserCreateTransactionFromResult(result) as { task?: { id?: string } } | null;
        if (transaction?.task?.id) createdIds.add(transaction.task.id);
      }
      return result;
    },
    async runCreateApproval(kind: "initiative" | "deliverable", call: BoundInvocation): Promise<PlanningResult> {
      if (action !== "planning.task.create" || !actor.ok || !profile || !rolePermitsAction("governance.ceo", profile.platformRole)
        || call.command.kind !== "actOnItem" || call.command.action.kind !== "decideApproval" || !createdIds.has(call.command.action.itemId) || await current()) return rejected();
      return createPlanningApprovalPlanningItems(service, kind).run({ ...call, actor: actor.actor, mode: "commit" });
    },
    async validateContent(content: Parameters<typeof validateStoredPlanningContent>[1]) {
      if (action !== "planning.task.create" || await current()) throw Object.assign(new Error("Planungselement konnte nicht geprüft werden."), { code: "42501" });
      return validateStoredPlanningContent(service, content);
    },
    async readCreateParent(parentId: string) {
      if (action !== "planning.task.create" || await current()) return { data: null, error: forbidden() };
      return await service.from(ACTIVE_TASKS_TABLE).select("id,title,owner,task_type,approval_status,status,review_status,score_final").eq("id", parentId).maybeSingle();
    },
    async readAccountable(parentId: string) {
      if (action !== "planning.task.create" || await current()) return { data: null, error: forbidden() };
      return await service.from("planning_item_raci_assignments").select("profile_id").eq("task_id", parentId).eq("role", "accountable").maybeSingle();
    },
    async readProfileNames(ids: string[]) {
      if (action !== "planning.task.create" || await current()) return { data: null, error: forbidden() };
      return await service.from("profiles").select("id,name").in("id", ids);
    },
    async readLeadIds() {
      if (action !== "planning.task.create" || await current()) return { data: null, error: forbidden() };
      return await service.from("profiles").select("id").in("platform_role", ["ceo", "deputy"]);
    },
    async runReparent(call: BoundInvocation): Promise<PlanningResult> {
      if (action !== "planning.task.update" || correction || !actor.ok || call.command.kind !== "actOnItem" || call.command.action.kind !== "changeParent"
        || call.command.action.itemId !== targetId || !targetId || await current()) return rejected();
      return createPlanningReparentPlanningItems(service, "any").run({ ...call, actor: actor.actor, mode: "commit" });
    },
    async runDelete(call: BoundInvocation): Promise<PlanningResult> {
      if (action !== "planning.task.delete" || !actor.ok || call.command.kind !== "actOnItem" || call.command.action.kind !== "deleteEmptyEpic"
        || call.command.action.itemId !== targetId || !targetId || await current()) return rejected();
      return createEmptyEpicDeletePlanningItems(service).run({ ...call, actor: actor.actor, mode: "commit" });
    },
    async runRelationship(call: BoundInvocation, mentionRecipientProfileIds: readonly string[] = []): Promise<PlanningResult> {
      const expected = action === "planning.relationship.add" ? "addRelationship" : action === "planning.relationship.remove" ? "removeRelationship" : null;
      if (!expected || !actor.ok || call.command.kind !== "actOnItem" || call.command.action.kind !== expected
        || !("itemId" in call.command.action) || !targetId || call.command.action.itemId !== targetId || await current()) return rejected();
      return createPlanningRelationshipPlanningItems(service, { mutationClient: correction ? permission.data! : service, administratorAccess: correction, mentionRecipientProfileIds }).run({ ...call, actor: actor.actor, mode: "commit" });
    },
    failure,
    async revise(payload: TaskUpdatePayload) {
      const denial = action === "planning.task.update" && targetId ? await current() : forbidden();
      if (denial) {
        const denied = correction ? await failure() : { error: denial.message, code: undefined };
        return { ok: false as const, error: { kind: "forbidden" as const, message: denied.error, code: denied.code } };
      }
      return createPlanningItemRevision(correction ? permission.data! : service, failure).commitBrowserRevision({ itemId: targetId, payload, permission });
    },
    async readMentionProfiles() {
      const denial = reviewKinds[action] || action === "planning.task.create" || action === "planning.task.update" || action.startsWith("planning.relationship.") ? await current() : forbidden();
      if (denial) return { data: null, error: denial };
      if (correction) {
        const result = await permission.data!.rpc("administrator_directory_snapshot");
        const people = (result.data as { people?: Array<{ id: string; name: string; githubLogin?: string }> } | null)?.people || [];
        return { data: result.error ? null : people.map(person => ({ id: person.id, name: person.name, github_login: person.githubLogin || "" })), error: result.error };
      }
      return await service.from("profiles").select("id,name,github_login");
    },
    async deliverReviews() {
      if (action !== "planning.review.decide" || !reviewCommitted) throw Object.assign(new Error("Keine Berechtigung für diesen Review-Versand."), { code: "42501" });
      return deliverPendingGitHubReviews({ supabase: service, taskId: targetId, limit: 20 });
    },
    async runReview(call: BoundInvocation): Promise<PlanningResult> {
      if (!reviewKinds[action] || correction || !actor.ok || call.command.kind !== "actOnItem" || call.command.action.kind !== reviewKinds[action]
        || !targetId || !("itemId" in call.command.action) || call.command.action.itemId !== targetId || await current()) return rejected();
      const result = await createPlanningReviewPlanningItems(service).run({ ...call, actor: actor.actor, mode: "commit" });
      if (result.ok && result.status === "committed") reviewCommitted = true;
      return result;
    },
    async loadBacklog() {
      if (action !== "planning.backlog.read" || await current()) return { status: "forbidden" as const };
      return createSupabaseBacklogReadModel(service).load({ authorized: true, actorProfileId: profile?.id || null });
    },
    async loadSprint() {
      if (action !== "planning.sprint.read" || await current()) return { status: "forbidden" as const };
      return createSupabaseSprintReadModel(service).load({ authorized: true, actorProfileId: profile?.id || null });
    },
    async loadDetail() {
      if (action !== "planning.task.read" || !targetId || await current()) return { status: "forbidden" as const };
      return createSupabaseTaskDetailReadModel(service).load({ itemId: targetId }, { authorized: true, actorProfileId: profile?.id || null });
    },
    async loadBoard() {
      const denial = action === "planning.board.read" ? await current() : forbidden();
      if (denial) return { status: "forbidden" as const };
      return createSupabasePlanningBoardReadModel(service).load({ authorized: true, actorProfileId: profile?.id || null });
    },
    async loadHeader(slots?: PlanningHeaderSlotKey[]) {
      const denial = ["planning.board.read", "planning.header.read", "planning.backlog.read", "planning.sprint.read"].includes(action) ? await current() : forbidden();
      if (denial) throw Object.assign(new Error(denial.message), { code: denial.code });
      return loadPlanningHeaderData(service, { currentProfileId: profile?.id || null, platformRole: profile?.platformRole || null, slots, sharedSlotLoaders: sharedPlanningHeaderSlotLoaders });
    },
    async readRevision() {
      const denial = action === "planning.revision.read" ? await current() : forbidden();
      if (denial) return { data: null, count: null, error: denial };
      return await service.from(ACTIVE_TASKS_TABLE).select("updated_at", { count: "exact" })
        .eq("project_id", "findmydoc-founder-execution").order("updated_at", { ascending: false }).limit(1);
    },
  } };
}
