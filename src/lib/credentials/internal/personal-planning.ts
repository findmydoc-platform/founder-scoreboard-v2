import { authorizeSessionPolicy } from "./session-policy";
import { getServerSupabase } from "@/lib/credentials/internal/server-data-client";
import { createTeamPlanningItemsToken, mapTeamPlanningItemsTokenRecord } from "./planning-items/issuance";
import "server-only";
import type { PersonalPlanningCredentialInput } from "../types";
import { requireTeamPlanningItemScope, type TeamPlanningItemsAuthResult } from "./planning-items/token";
import { actorContextFromPlanningTokenAuth } from "@/features/planning-items/model/planning-actor-context-server";
import { TEAM_PLANNING_ITEM_SCOPES, TEAM_PLANNING_ITEMS_TOKEN_HISTORY_LIMIT, type TeamPlanningItemScope } from "@/features/planning-items/model/planning-items-contract";
import { buildPlanningItemsContext } from "@/features/planning-items/model/planning-items-context";
import { createTeamCreatePlanningItems } from "@/features/planning-items/model/planning-items-create";
import { buildPlanningItemUpdatePreview, createTeamRevisePlanningItems } from "@/features/planning-items/model/planning-item-update";
import { buildTeamPlanningDependencyPreview } from "@/features/planning-items/model/planning-items-team-dependency";
import { commitTeamPlanningItemUpdate } from "@/features/planning-items/model/planning-items-team-update";
import { createEmptyEpicDeletePlanningItems } from "@/features/planning-items/model/planning-items-empty-epic-delete";
import { hasCanonicalTeamPlanningItem } from "@/features/planning-items/model/planning-items-team-canonical-item";
import { enqueueTeamPlanningGitHubProjection, dispatchAndLoadPlanningGitHubProjections } from "@/features/planning-items/model/planning-items-github-projection";
import type { PlanningInvocation } from "@/features/planning-items/model/planning-items";

const operationScopes: Record<PersonalPlanningCredentialInput["operation"], TeamPlanningItemScope> = {
  "planningContext.read": "read:planning-context",
  "planningItems.create": "write:planning-items:create",
  "planningItems.update": "write:planning-items:update",
  "planningItems.deleteEmpty": "write:planning-items:delete-empty",
  "planningItems.githubSync": "write:planning-items:github-sync",
};
type Failure = Extract<TeamPlanningItemsAuthResult, { ok: false }>;
const forbidden = (): never => { throw Object.assign(new Error("Planning-API-Berechtigung ist nicht mehr gültig."), { code: "P0007" }); };

export async function authorizePersonalPlanning(input: PersonalPlanningCredentialInput) {
  const { operation, mode } = input;
  const scope = operationScopes[operation];
  if (input.action !== "planning-items.access" || !["read", "preview", "commit"].includes(mode) || typeof scope !== "string" || (operation === "planningContext.read" ? mode !== "read" : mode === "read")
    || (operation === "planningItems.githubSync" && mode !== "commit")) {
    return { ok: false, status: 500, code: "AUTHORIZATION_UNAVAILABLE", error: "Planning-API-Berechtigung konnte nicht geprüft werden." } as Failure;
  }
  const permission = await requireTeamPlanningItemScope(input.credential.request, scope);
  if (!permission.ok) return permission;
  if (permission.scopeGranted !== permission.scopes.includes(scope)) {
    return { ok: false, status: 500, code: "AUTHORIZATION_UNAVAILABLE", error: "Planning-API-Berechtigung konnte nicht geprüft werden." } as Failure;
  }
  const actorResult = actorContextFromPlanningTokenAuth(permission);
  if (!actorResult.ok) return { ok: false, status: 403, code: "TOKEN_PROFILE_FORBIDDEN", error: "Planning-API-Berechtigung ist nicht mehr gültig." } as Failure;
  const actor = actorResult.actor;
  const { supabase, ...metadata } = permission;
  const itemId = input.itemId?.trim() || "";
  const projectionIds = new Set<string>();
  const authorizeOperation = async (expectedOperation: PersonalPlanningCredentialInput["operation"], expectedMode = mode, githubSync = false) => {
    if (operation !== expectedOperation || mode !== expectedMode || !permission.scopeGranted
      || (githubSync && !permission.scopes.includes("write:planning-items:github-sync"))) forbidden();
    const current = await requireTeamPlanningItemScope(input.credential.request, scope);
    if (!current.ok) throw Object.assign(new Error(current.error), { code: current.code === "TOKEN_INACTIVE" ? "P0004" : current.code === "AUTHORIZATION_UNAVAILABLE" ? "AUTHORIZATION_UNAVAILABLE" : "P0007", status: current.status });
    if (current.tokenId !== permission.tokenId || current.profile.id !== permission.profile.id
      || current.profile.platformRole !== permission.profile.platformRole || !current.scopeGranted
      || (githubSync && !current.scopes.includes("write:planning-items:github-sync"))) forbidden();
  };
  const invocation = (value: Omit<PlanningInvocation, "actor" | "mode">): PlanningInvocation => ({ ...value, actor, mode: mode === "commit" ? "commit" : "preview" });
  const requiredScopes = [scope];
  return {
    ...metadata,
    profile: Object.freeze({ ...permission.profile }),
    scopes: Object.freeze([...permission.scopes]),
    requiredScopes,
    missingScopes: permission.scopeGranted ? [] : [scope],
    planningItems: {
      requireGitHubSync() {
        const scopes = TEAM_PLANNING_ITEM_SCOPES.filter(value => value === scope || value === "write:planning-items:github-sync");
        return { requiredScopes: scopes, missingScopes: scopes.filter(value => !permission.scopes.includes(value)) };
      },
      async readContext() {
        await authorizeOperation("planningContext.read", "read");
        return buildPlanningItemsContext(supabase, permission.profile);
      },
      async create(options: Omit<Parameters<typeof createTeamCreatePlanningItems>[0], "supabase" | "actor" | "tokenId" | "dispatchGitHubProjections">, call: Omit<PlanningInvocation, "actor" | "mode">) {
        await authorizeOperation("planningItems.create", mode, Boolean(options.githubSyncMode));
        return createTeamCreatePlanningItems({ ...options, supabase, actor, tokenId: permission.tokenId, dispatchGitHubProjections: dispatchAndLoadPlanningGitHubProjections }).run(invocation(call));
      },
      async buildUpdatePreview(options: Omit<Parameters<typeof buildPlanningItemUpdatePreview>[0], "supabase" | "actor" | "itemId">) {
        await authorizeOperation("planningItems.update", "preview", Boolean(options.parsed.githubSyncMode));
        return buildPlanningItemUpdatePreview({ ...options, supabase, actor: permission.profile, itemId });
      },
      async buildDependencyPreview(options: Omit<Parameters<typeof buildTeamPlanningDependencyPreview>[0], "supabase" | "actor" | "itemId">) {
        await authorizeOperation("planningItems.update", "preview");
        return buildTeamPlanningDependencyPreview({ ...options, supabase, actor, itemId });
      },
      async revise(options: Omit<Parameters<typeof createTeamRevisePlanningItems>[0], "supabase" | "actor" | "tokenId" | "itemId">, call: Omit<PlanningInvocation, "actor" | "mode">) {
        await authorizeOperation("planningItems.update", "preview", Boolean(options.parsed.githubSyncMode));
        if (call.command.kind !== "reviseItem" || call.command.itemId !== itemId) forbidden();
        return createTeamRevisePlanningItems({ ...options, supabase, actor, tokenId: permission.tokenId, itemId }).run(invocation(call));
      },
      async commitUpdate(options: Omit<Parameters<typeof commitTeamPlanningItemUpdate>[0], "actor" | "itemId">, scheduleAfter: Parameters<typeof commitTeamPlanningItemUpdate>[1]["scheduleAfter"]) {
        await authorizeOperation("planningItems.update", "commit", Boolean(options.parsed.githubSyncMode));
        return commitTeamPlanningItemUpdate({ ...options, actor, itemId }, { supabase, dispatchGitHubProjections: dispatchAndLoadPlanningGitHubProjections, scheduleAfter });
      },
      async delete(call: Omit<PlanningInvocation, "actor" | "mode">) {
        await authorizeOperation("planningItems.deleteEmpty");
        if (call.command.kind !== "actOnItem" || call.command.action.kind !== "deleteEmptyEpic" || call.command.action.itemId !== itemId) forbidden();
        return createEmptyEpicDeletePlanningItems(supabase).run(invocation(call));
      },
      async hasCanonicalItem() {
        if (!["planningItems.update", "planningItems.deleteEmpty", "planningItems.githubSync"].includes(operation) || !permission.scopeGranted) forbidden();
        await authorizeOperation(operation);
        return hasCanonicalTeamPlanningItem(supabase, itemId);
      },
      async readDeleteReplay(idempotencyKey: string) {
        await authorizeOperation("planningItems.deleteEmpty", "commit");
        const result = await supabase.from("team_planning_item_delete_requests").select("request_hash,response,contract_version,item_id")
          .eq("token_id", permission.tokenId).eq("profile_id", permission.profile.id).eq("idempotency_key", idempotencyKey).maybeSingle();
        if (result.data && result.data.item_id !== itemId) throw Object.assign(new Error("Idempotency-Key wurde mit anderen Daten wiederverwendet."), { code: "P0003" });
        return result;
      },
      async enqueueGitHubProjection(options: Omit<Parameters<typeof enqueueTeamPlanningGitHubProjection>[0], "supabase" | "tokenId" | "actorProfileId" | "itemId">) {
        await authorizeOperation("planningItems.githubSync", "commit");
        const result = await enqueueTeamPlanningGitHubProjection({ ...options, supabase, tokenId: permission.tokenId, actorProfileId: permission.profile.id, itemId });
        if (result.ok) projectionIds.add(result.value.operationId);
        return result;
      },
      async dispatchGitHubProjection(operationId: string) {
        if (operation !== "planningItems.githubSync" || mode !== "commit" || !projectionIds.has(operationId)) forbidden();
        // Only an accepted transaction supplies this operation ID. Existing durable claims own delivery.
        return dispatchAndLoadPlanningGitHubProjections(supabase, operationId);
      },
    },
  };
}

export async function authorizePersonalPlanningTokenManagement(input: import("../types").PersonalPlanningTokenManagementInput) {
  const supabase = getServerSupabase();
  if (!supabase) return { ok: false as const, status: 501, error: "Supabase ist für Planning-API-Tokens erforderlich." };
  const permission = await authorizeSessionPolicy(input.credential.request, "planning.contribute");
  if (!permission.ok) return permission;
  if (!permission.profile) return { ok: false as const, status: 403, error: "Profil konnte nicht bestimmt werden." };
  const profileId = permission.profile.id;
  const canIssueEmptyEpicDeletes = ["ceo", "deputy"].includes(permission.profile.platformRole);
  return { ok: true as const, profile: Object.freeze({ ...permission.profile }), tokens: {
    async list() {
      const now = new Date().toISOString();
      const [active, history] = await Promise.all([
        supabase.from("team_task_intake_tokens").select("id,label,token_hint,scopes,expires_at,created_at,last_used_at,revoked_at")
          .eq("profile_id", profileId).is("revoked_at", null).gt("expires_at", now).order("created_at", { ascending: false }),
        supabase.from("team_task_intake_tokens").select("id,label,token_hint,scopes,expires_at,created_at,last_used_at,revoked_at")
          .eq("profile_id", profileId).or(`revoked_at.not.is.null,expires_at.lte.${now}`).order("created_at", { ascending: false }).limit(TEAM_PLANNING_ITEMS_TOKEN_HISTORY_LIMIT),
      ]);
      return { data: [...(active.data || []), ...(history.data || [])].map(row => mapTeamPlanningItemsTokenRecord(row)), error: active.error || history.error };
    },
    async issue(options: { label: string; allowUpdates: boolean; allowEmptyEpicDeletes: boolean; allowGitHubSync: boolean }) {
      if (options.allowEmptyEpicDeletes && !canIssueEmptyEpicDeletes) return { data: null, error: { code: "P0006" } };
      const generated = createTeamPlanningItemsToken();
      const result = await supabase.rpc("create_team_planning_items_token_v2", { p_profile_id: profileId, p_label: options.label,
        p_token_hash: generated.tokenHash, p_token_hint: generated.tokenHint, p_allow_updates: options.allowUpdates,
        p_allow_empty_epic_deletes: options.allowEmptyEpicDeletes, p_allow_github_sync: options.allowGitHubSync });
      return { data: result.error ? null : { token: generated.token, tokenRecord: mapTeamPlanningItemsTokenRecord(result.data) }, error: result.error };
    },
    async revoke(tokenId: string) {
      return await supabase.rpc("revoke_team_planning_items_token", { p_token_id: tokenId, p_profile_id: profileId });
    },
  } };
}
