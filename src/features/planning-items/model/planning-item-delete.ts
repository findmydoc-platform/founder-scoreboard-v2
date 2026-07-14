import { createHash } from "node:crypto";
import type { AuthenticatedProfile } from "@/lib/types";
import type { getServerSupabase } from "@/lib/supabase";
import { mapPlanningItemDatabaseRow } from "@/features/planning-items/model/planning-item-update";
import type {
  MilestoneChildCounts,
  MilestoneNotEmptyError,
} from "@/features/projects/model/milestone-contract";
import {
  loadMilestoneChildCounts,
  loadProjectMilestone,
  milestoneNotEmptyError,
  parseMilestoneDeleteRequest,
} from "@/features/projects/model/milestone-server";

type SupabaseServer = NonNullable<ReturnType<typeof getServerSupabase>>;
type DatabaseRow = Record<string, unknown>;

export const MILESTONE_DELETE_SCOPE_WARNING = "Zugeordnete Initiativen oder Aufgaben werden weder verschoben noch gelöscht.";

export type PlanningItemMilestoneDeletePreview = {
  itemId: string;
  itemType: "milestone";
  expectedUpdatedAt: string;
  currentItem: Record<string, unknown>;
  children: MilestoneChildCounts;
  valid: boolean;
  canDelete: boolean;
  code: MilestoneNotEmptyError["code"] | null;
  error: string;
  warnings: string[];
};

export function parsePlanningItemDeletePayload(payload: unknown) {
  const parsed = parseMilestoneDeleteRequest(payload);
  if (!parsed.ok) return parsed;
  return { ok: true as const, expectedUpdatedAt: parsed.value.expectedUpdatedAt };
}

export function planningItemMilestoneDeleteHash({
  itemId,
  expectedUpdatedAt,
}: {
  itemId: string;
  expectedUpdatedAt: string;
}) {
  return createHash("sha256")
    .update(JSON.stringify({ itemId, expectedUpdatedAt }), "utf8")
    .digest("hex");
}

function databaseError(error: { message?: string | null; code?: string | null }) {
  return Object.assign(new Error(error.message || "Planning-Items-Datenbankfehler"), { code: error.code || "" });
}

export async function loadPlanningItemMilestoneDeletePreview({
  actor,
  itemId,
  expectedUpdatedAt,
  supabase,
}: {
  actor: AuthenticatedProfile;
  itemId: string;
  expectedUpdatedAt: string;
  supabase: SupabaseServer;
}): Promise<
  | { ok: true; preview: PlanningItemMilestoneDeletePreview }
  | { ok: false; status: 403 | 404 | 409; error: string }
> {
  if (!["ceo", "deputy"].includes(actor.platformRole)) {
    return { ok: false, status: 403, error: "Nur CEO oder Deputy können Meilensteine löschen." };
  }

  const { data, error } = await loadProjectMilestone(supabase, itemId);
  if (error) throw databaseError(error);
  if (!data) return { ok: false, status: 404, error: "Meilenstein wurde nicht gefunden." };
  if (String(data.updated_at || "") !== expectedUpdatedAt) {
    return { ok: false, status: 409, error: "Meilenstein wurde zwischenzeitlich geändert. Bitte Kontext erneut laden." };
  }

  const childResult = await loadMilestoneChildCounts(supabase, itemId);
  if (!childResult.ok) throw databaseError(childResult.error);
  const children = childResult.counts;
  const canDelete = children.initiatives === 0 && children.tasks === 0;
  const conflict = canDelete ? null : milestoneNotEmptyError(children);
  return {
    ok: true,
    preview: {
      itemId,
      itemType: "milestone",
      expectedUpdatedAt,
      currentItem: mapPlanningItemDatabaseRow("milestone", data as DatabaseRow),
      children,
      valid: canDelete,
      canDelete,
      code: conflict?.code || null,
      error: conflict?.error || "",
      warnings: [MILESTONE_DELETE_SCOPE_WARNING],
    },
  };
}
