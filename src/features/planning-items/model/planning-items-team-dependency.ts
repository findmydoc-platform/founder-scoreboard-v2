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
  planningRelationshipTransactionFromResult,
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

function dependencySystemEffects(
  operation: "add" | "remove",
  dependency: CanonicalPlanningDependencyChange,
  changed: boolean,
): PlanningItemSystemEffect[] {
  if (!changed) return [];
  return [
    {
      field: "dependencies",
      before: operation === "remove" ? dependency : null,
      after: operation === "add" ? dependency : null,
      reason: operation === "add" ? "Aufgabenabhängigkeit wird hinzugefügt." : "Aufgabenabhängigkeit wird entfernt.",
    },
    {
      field: "githubIssueSyncStatus",
      before: "current",
      after: "not_synced",
      reason: "Betroffene GitHub-Projektionen werden als nicht synchron markiert.",
    },
  ];
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
      systemEffects: dependencySystemEffects(dependency.operation, change.relationship, changed),
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
  const planning = createPlanningRelationshipPlanningItems(supabase, {
    teamUpdate: { tokenId, requestHash },
  });
  const result = await planning.run({
    actor,
    mode: "commit",
    command: relationshipCommand(itemId, expectedUpdatedAt, dependency),
    idempotencyKey,
    requestMetadata,
  });
  if (!result.ok) {
    if (result.error.code === "forbidden" && result.error.reason === "planningTokenInactive") {
      return { ok: false, status: 403, code: "TOKEN_INACTIVE", error: "Planning-API-Berechtigung ist nicht mehr gültig." };
    }
    if (result.error.code === "forbidden" && [
      "planningTokenScopeMissing",
      "planningRelationshipAuthorizationChanged",
    ].includes(result.error.reason)) {
      return { ok: false, status: 403, code: "TOKEN_PROFILE_FORBIDDEN", error: "Planning-API-Berechtigung ist nicht mehr gültig." };
    }
    const mapped = planningRelationshipError(result.error);
    return { ok: false, status: mapped.status, error: mapped.message };
  }
  const transaction = planningRelationshipTransactionFromResult(result);
  if (!transaction) throw new Error("Planning-Items-Abhängigkeit lieferte kein Ergebnis zurück.");
  return { ok: true, transaction };
}
