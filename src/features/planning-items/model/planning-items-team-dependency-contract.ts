export type TeamPlanningDependencyDirection = "blocked_by" | "blocks";

export type TeamPlanningDependencyCommand =
  | Readonly<{
      operation: "add";
      direction: TeamPlanningDependencyDirection;
      relatedItemId: string;
      note: string;
    }>
  | Readonly<{
      operation: "remove";
      relationshipId: number;
    }>;

export type CanonicalPlanningDependency = Readonly<{
  relationshipId: number;
  blockedItemId: string;
  blockingItemId: string;
  note: string | null;
}>;

export type CanonicalPlanningDependencyChange = Readonly<{
  relationshipId: number | null;
  blockedItemId: string;
  blockingItemId: string;
  note: string | null;
}>;

type RelationshipRecord = Readonly<{
  id: number;
  taskId: string;
  relatedTaskId: string;
  relationType: string;
  note?: string | null;
}>;

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: readonly string[]) {
  const allowedKeys = new Set(allowed);
  return Object.keys(value).every((key) => allowedKeys.has(key));
}

export function parseTeamPlanningDependency(value: unknown):
  | Readonly<{ ok: true; dependency: TeamPlanningDependencyCommand }>
  | Readonly<{ ok: false; error: string }> {
  const candidate = record(value);
  if (!candidate) return { ok: false, error: "dependency muss ein Objekt sein." };

  if (candidate.operation === "add") {
    if (!hasOnlyKeys(candidate, ["operation", "direction", "relatedItemId", "note"])) {
      return { ok: false, error: "dependency enthält ein unbekanntes Feld." };
    }
    if (candidate.direction !== "blocked_by" && candidate.direction !== "blocks") {
      return { ok: false, error: "dependency.direction muss blocked_by oder blocks sein." };
    }
    const relatedItemId = typeof candidate.relatedItemId === "string" ? candidate.relatedItemId.trim() : "";
    if (!relatedItemId) return { ok: false, error: "dependency.relatedItemId ist erforderlich." };
    if (candidate.note !== undefined && typeof candidate.note !== "string") {
      return { ok: false, error: "dependency.note muss Text sein." };
    }
    const note = typeof candidate.note === "string" ? candidate.note.trim() : "";
    if (note.length > 500) return { ok: false, error: "dependency.note darf höchstens 500 Zeichen enthalten." };
    return {
      ok: true,
      dependency: {
        operation: "add",
        direction: candidate.direction,
        relatedItemId,
        note,
      },
    };
  }

  if (candidate.operation === "remove") {
    if (!hasOnlyKeys(candidate, ["operation", "relationshipId"])) {
      return { ok: false, error: "dependency enthält ein unbekanntes Feld." };
    }
    if (!Number.isInteger(candidate.relationshipId) || Number(candidate.relationshipId) <= 0) {
      return { ok: false, error: "dependency.relationshipId muss eine positive Ganzzahl sein." };
    }
    return {
      ok: true,
      dependency: { operation: "remove", relationshipId: Number(candidate.relationshipId) },
    };
  }

  return { ok: false, error: "dependency.operation muss add oder remove sein." };
}

export function canonicalPlanningDependency(relationship: RelationshipRecord): CanonicalPlanningDependency | null {
  if (relationship.relationType === "blocked_by") {
    return {
      relationshipId: relationship.id,
      blockedItemId: relationship.taskId,
      blockingItemId: relationship.relatedTaskId,
      note: relationship.note || null,
    };
  }
  if (relationship.relationType === "blocks") {
    return {
      relationshipId: relationship.id,
      blockedItemId: relationship.relatedTaskId,
      blockingItemId: relationship.taskId,
      note: relationship.note || null,
    };
  }
  return null;
}

export function canonicalPlanningDependencyChange(
  relationship: RelationshipRecord,
): CanonicalPlanningDependencyChange | null {
  const dependency = canonicalPlanningDependency(relationship);
  return dependency
    ? { ...dependency, relationshipId: relationship.id > 0 ? relationship.id : null }
    : null;
}
