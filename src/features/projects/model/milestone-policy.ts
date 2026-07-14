import type { PlatformRole } from "@/lib/types";
import type { MilestoneChildCounts, MilestoneDto } from "./milestone-contract";

export type MilestoneDeletePolicy = {
  canDelete: boolean;
  isEmpty: boolean;
  children: MilestoneChildCounts;
  error: string;
};

export function canManageMilestones(
  platformRole: PlatformRole | null | undefined,
  source: "seed" | "supabase" = "supabase",
) {
  return source === "seed" || platformRole === "ceo" || platformRole === "deputy";
}

export function isManageableMilestone(milestone: Pick<MilestoneDto, "id">) {
  return Boolean(milestone.id.trim());
}

export function normalizeMilestoneChildCounts(counts: Partial<MilestoneChildCounts> | null | undefined): MilestoneChildCounts {
  return {
    initiatives: Math.max(0, Math.trunc(Number(counts?.initiatives) || 0)),
    tasks: Math.max(0, Math.trunc(Number(counts?.tasks) || 0)),
  };
}

function countLabel(count: number, singular: string, plural: string) {
  return `${count} ${count === 1 ? singular : plural}`;
}

export function formatMilestoneChildCounts(counts: MilestoneChildCounts) {
  const normalized = normalizeMilestoneChildCounts(counts);
  const labels = [
    normalized.initiatives ? countLabel(normalized.initiatives, "Initiative", "Initiativen") : "",
    normalized.tasks ? countLabel(normalized.tasks, "Aufgabe", "Aufgaben") : "",
  ].filter(Boolean);

  if (!labels.length) return "keine Initiativen oder Aufgaben";
  return labels.join(" und ");
}

export function milestoneNotEmptyMessage(counts: MilestoneChildCounts) {
  return `Der Meilenstein kann nicht gelöscht werden, weil noch ${formatMilestoneChildCounts(counts)} zugeordnet sind.`;
}

export function buildMilestoneDeletePolicy(counts: MilestoneChildCounts): MilestoneDeletePolicy {
  const children = normalizeMilestoneChildCounts(counts);
  const isEmpty = children.initiatives === 0 && children.tasks === 0;
  return {
    canDelete: isEmpty,
    isEmpty,
    children,
    error: isEmpty ? "" : milestoneNotEmptyMessage(children),
  };
}
