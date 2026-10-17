import "server-only";
import type { PlanningCredentialInput } from "../types";
import { authorizeSessionPolicy, currentAdministratorAccess, administratorAccessFailure } from "./session-policy";
import { getServerSupabase } from "../../supabase";
import { ACTIVE_TASKS_TABLE } from "../../planning-read-model";

import { createSupabaseBacklogReadModel } from "@/features/backlog/server/backlog-read-model-supabase";
import { createSupabaseSprintReadModel } from "@/features/sprint/server/sprint-read-model-supabase";
import { createSupabaseTaskDetailReadModel } from "@/features/tasks/server/task-detail-read-model-supabase";
import { createSupabasePlanningBoardReadModel } from "@/features/planning/server/planning-board-read-model-supabase";
import { loadPlanningHeaderData } from "../../planning-header-data";
import { sharedPlanningHeaderSlotLoaders } from "../../planning-header-cache";
import type { PlanningHeaderSlotKey } from "../../planning-header-data";

import { createPlanningReparentPlanningItems } from "@/features/planning-items/model/planning-items-reparent";
import { createEmptyEpicDeletePlanningItems } from "@/features/planning-items/model/planning-items-empty-epic-delete";
import { createPlanningRelationshipPlanningItems } from "@/features/planning-items/model/planning-items-relationships";
import { createPlanningItemRevision } from "@/features/planning-items/model/planning-item-revision";
import type { TaskUpdatePayload } from "@/features/tasks/model/task-mutation-contract";
import { actorContextFromSessionAuth } from "@/features/planning-items/model/planning-actor-context-server";
import { createPlanningReviewPlanningItems } from "@/features/planning-items/model/planning-items-review";
import { deliverPendingGitHubReviews } from "../../github-review-delivery";
import type { PlanningInvocation, PlanningResult } from "@/features/planning-items/model/planning-items";

type BoundInvocation = Omit<PlanningInvocation, "actor" | "mode">;
const rejected = (): PlanningResult => ({ ok: false, error: { code: "forbidden", reason: "actionBinding" } });
const forbidden = () => ({ code: "42501", message: "Keine Berechtigung für diese Aktion." });

export async function authorizePlanning(input: PlanningCredentialInput) {
  if (input.credential.kind !== "session-request") return { ok: false as const, status: 403, error: "Keine Berechtigung für diese Aktion." };
  const action = input.action;
  const targetId = input.targetId?.trim() || "";
  const permission = await authorizeSessionPolicy(input.credential.request, (action === "planning.task.update" || action.startsWith("planning.relationship.")) ? "planning.correct" : action === "planning.task.delete" ? "operations.lead" : action.startsWith("planning.review.") ? "planning.contribute" : "team.read");
  if (!permission.ok) return permission;
  const service = getServerSupabase();
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
      const denial = reviewKinds[action] || action === "planning.task.update" || action.startsWith("planning.relationship.") ? await current() : forbidden();
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
