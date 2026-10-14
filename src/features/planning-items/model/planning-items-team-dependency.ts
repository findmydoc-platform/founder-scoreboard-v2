import { createHash } from "node:crypto";
import type { getServerSupabase } from "@/lib/supabase";
import type { ActorContext } from "./actor-context";
import {
  loadPlanningItemUpdateTarget,
  mapPlanningItemDatabaseRow,
  type PlanningItemSystemEffect,
  type PlanningItemReplayType,
} from "./planning-item-update";
import {
  addPlanningRelationshipCommand,
  createPlanningRelationshipPlanningItems,
  planningRelationshipError,
  planningRelationshipFromResult,
  removePlanningRelationshipCommand,
  type PlanningRelationship,
} from "./planning-items-relationships";
import {
  canonicalPlanningDependencyChange,
  type CanonicalPlanningDependencyChange,
  type TeamPlanningDependencyCommand,
} from "./planning-items-team-dependency-contract";

type SupabaseServer = NonNullable<ReturnType<typeof getServerSupabase>>;

export type TeamPlanningDependencyChange = Readonly<{
  operation: "add" | "remove";
  changed: boolean;
  relationship: CanonicalPlanningDependencyChange;
}>;

export type TeamPlanningDependencyPreview = Readonly<{
  itemId: string;
  itemType: PlanningItemReplayType;
  expectedUpdatedAt: string;
  currentItem: Record<string, unknown>;
  normalizedPatch: Readonly<{ dependency: TeamPlanningDependencyCommand }>;
  resultingItem: Record<string, unknown>;
  changedFields: readonly string[];
  systemEffects: readonly PlanningItemSystemEffect[];
  dependencyChange: TeamPlanningDependencyChange;
  warnings: readonly string[];
  errors: readonly string[];
}>;

function relationshipCommand(itemId: string, expectedUpdatedAt: string, dependency: TeamPlanningDependencyCommand) {
  return dependency.operation === "add"
    ? addPlanningRelationshipCommand(itemId, {
        relationType: dependency.direction,
        relatedTaskId: dependency.relatedItemId,
        note: dependency.note,
        expectedUpdatedAt,
      })
    : removePlanningRelationshipCommand(itemId, {
        relationId: dependency.relationshipId,
        expectedUpdatedAt,
      });
}

function changedRelationship(result: { changes: readonly { field: string; before: unknown; after: unknown }[] }) {
  const change = result.changes.find((candidate) => candidate.field === "planningRelationship");
  return Boolean(change && JSON.stringify(change.before) !== JSON.stringify(change.after));
}

function canonicalRelationship(relationship: PlanningRelationship | null) {
  if (!relationship) return null;
  return canonicalPlanningDependencyChange({
    id: relationship.id,
    taskId: relationship.taskId,
    relatedTaskId: relationship.relatedTaskId,
    relationType: relationship.relationType,
    note: relationship.note,
  });
}

function dependencyEffect(
  operation: "add" | "remove",
  dependency: CanonicalPlanningDependencyChange,
): PlanningItemSystemEffect {
  return {
    field: "dependencies",
    before: operation === "remove" ? dependency : null,
    after: operation === "add" ? dependency : null,
    reason: operation === "add" ? "Aufgabenabhängigkeit wird hinzugefügt." : "Aufgabenabhängigkeit wird entfernt.",
  };
}

function githubSyncEffect(
  itemId: string,
  target: Extract<Awaited<ReturnType<typeof loadPlanningItemUpdateTarget>>, { ok: true }>,
): PlanningItemSystemEffect | null {
  if (target.itemType !== "deliverable" && target.itemType !== "sub_issue") return null;
  const before = String(target.row.github_issue_sync_status || "not_synced");
  if (before === "not_synced") return null;
  return {
    field: `githubIssueSyncStatus:${itemId}`,
    before,
    after: "not_synced",
    reason: "Die GitHub-Projektion dieses Planungselements wird als nicht synchron markiert.",
  };
}

function dependencyChange(
  operation: "add" | "remove",
  relationship: PlanningRelationship | null,
  changed: boolean,
): TeamPlanningDependencyChange | null {
  const canonical = canonicalRelationship(relationship);
  return canonical ? { operation, changed, relationship: canonical } : null;
}

function mappedItem(target: Awaited<ReturnType<typeof loadPlanningItemUpdateTarget>>) {
  if (!target.ok) return null;
  return mapPlanningItemDatabaseRow(target.itemType, target.row, target.strategy, target.raciAssignments);
}

export function planningDependencyUpdateHash(
  itemId: string,
  expectedUpdatedAt: string,
  dependency: TeamPlanningDependencyCommand,
) {
  const canonicalDependency = dependency.operation === "add"
    ? {
        operation: dependency.operation,
        direction: dependency.direction,
        relatedItemId: dependency.relatedItemId,
        note: dependency.note,
      }
    : {
        operation: dependency.operation,
        relationshipId: dependency.relationshipId,
      };
  return createHash("sha256")
    .update(JSON.stringify({ itemId, expectedUpdatedAt, dependency: canonicalDependency }), "utf8")
    .digest("hex");
}

export async function buildTeamPlanningDependencyPreview({
  actor,
  itemId,
  expectedUpdatedAt,
  dependency,
  supabase,
}: {
  actor: ActorContext;
  itemId: string;
  expectedUpdatedAt: string;
  dependency: TeamPlanningDependencyCommand;
  supabase: SupabaseServer;
}): Promise<
  | Readonly<{ ok: true; preview: TeamPlanningDependencyPreview }>
  | Readonly<{ ok: false; status: number; error: string }>
> {
  const target = await loadPlanningItemUpdateTarget(supabase, itemId);
  if (!target.ok) return target;
  const planning = createPlanningRelationshipPlanningItems(supabase, { teamDependency: true });
  const result = await planning.run({
    actor,
    mode: "preview",
    command: relationshipCommand(itemId, expectedUpdatedAt, dependency),
  });
  if (!result.ok) {
    const mapped = planningRelationshipError(result.error);
    return { ok: false, status: mapped.status, error: mapped.message };
  }
  if (result.status !== "previewed") throw new Error("Planning-Items-Abhängigkeitsvorschau lieferte keinen Preview-Status.");
  const relationship = planningRelationshipFromResult(result);
  const changed = changedRelationship(result);
  const change = dependencyChange(dependency.operation, relationship, changed);
  const item = mappedItem(target);
  if (!change || !item) throw new Error("Planning-Items-Abhängigkeit konnte nicht dargestellt werden.");
  const warnings = result.warnings.map((warning) => warning.message);
  const systemEffects: PlanningItemSystemEffect[] = [];
  if (changed) {
    systemEffects.push(dependencyEffect(dependency.operation, change.relationship));
    const otherItemId = change.relationship.blockedItemId === itemId
      ? change.relationship.blockingItemId
      : change.relationship.blockedItemId;
    const related = await loadPlanningItemUpdateTarget(supabase, otherItemId);
    if (!related.ok) return related;
    const sourceSyncEffect = githubSyncEffect(itemId, target);
    const relatedSyncEffect = githubSyncEffect(otherItemId, related);
    if (sourceSyncEffect) systemEffects.push(sourceSyncEffect);
    if (relatedSyncEffect) systemEffects.push(relatedSyncEffect);
  }
  return {
    ok: true,
    preview: {
      itemId,
      itemType: target.itemType,
      expectedUpdatedAt,
      currentItem: item,
      normalizedPatch: { dependency },
      resultingItem: item,
      changedFields: changed ? ["dependencies"] : [],
      systemEffects,
      dependencyChange: change,
      warnings,
      errors: [],
    },
  };
}

export async function commitTeamPlanningDependency({
  actor,
  itemId,
  expectedUpdatedAt,
  dependency,
  supabase,
  tokenId,
  requestHash,
  idempotencyKey,
  requestMetadata,
}: {
  actor: ActorContext;
  itemId: string;
  expectedUpdatedAt: string;
  dependency: TeamPlanningDependencyCommand;
  supabase: SupabaseServer;
  tokenId: string;
  requestHash: string;
  idempotencyKey: string;
  requestMetadata: Readonly<{ requestIp?: string; userAgent?: string }>;
}): Promise<
  | Readonly<{ ok: true; transaction: Record<string, unknown> }>
  | Readonly<{ ok: false; status: number; error: string; code?: string }>
> {
  const relationshipParams = dependency.operation === "add"
    ? {
        p_related_task_id: dependency.relatedItemId,
        p_relation_type: dependency.direction,
        p_relation_id: null,
        p_note: dependency.note,
      }
    : {
        p_related_task_id: null,
        p_relation_type: null,
        p_relation_id: dependency.relationshipId,
        p_note: "",
      };
  const result = await supabase.rpc("mutate_team_planning_dependency_transaction", {
    p_token_id: tokenId,
    p_idempotency_key: idempotencyKey,
    p_request_hash: requestHash,
    p_operation: dependency.operation,
    p_task_id: itemId,
    ...relationshipParams,
    p_expected_updated_at: expectedUpdatedAt,
    p_actor_profile_id: actor.profileId,
    p_request_ip: requestMetadata.requestIp || null,
    p_user_agent: requestMetadata.userAgent || null,
  });
  if (result.error) {
    const code = String(result.error.code || "");
    if (code === "P0004") {
      return { ok: false, status: 403, code: "TOKEN_INACTIVE", error: "Planning-API-Berechtigung ist nicht mehr gültig." };
    }
    if (["P0005", "P0006", "P0007"].includes(code)) {
      return { ok: false, status: 403, code: "TOKEN_PROFILE_FORBIDDEN", error: "Planning-API-Berechtigung ist nicht mehr gültig." };
    }
    if (code === "P0001") return { ok: false, status: 409, error: "Planungselement wurde zwischenzeitlich geändert." };
    if (code === "P0002") return { ok: false, status: 404, error: "Abhängigkeit oder Aufgabe wurde nicht gefunden." };
    if (code === "P0003") return { ok: false, status: 409, error: "Idempotency-Key wurde mit anderen Daten wiederverwendet." };
    if (["P0008", "P0009", "P0016"].includes(code)) {
      return { ok: false, status: 409, error: "Planungselement oder übergeordnete Aufgabe ist gesperrt." };
    }
    if (["P0010", "P0011"].includes(code)) {
      return { ok: false, status: 409, error: "Aufgabe wurde gelöscht und kann nicht geändert werden." };
    }
    if (["22023", "23514"].includes(code)) return { ok: false, status: 400, error: "Ungültige Aufgabenabhängigkeit." };
    throw Object.assign(new Error(result.error.message), { code: result.error.code });
  }
  if (!result.data || typeof result.data !== "object" || Array.isArray(result.data)) {
    throw new Error("Planning-Items-Abhängigkeit lieferte kein Ergebnis zurück.");
  }
  return { ok: true, transaction: result.data as Record<string, unknown> };
}
