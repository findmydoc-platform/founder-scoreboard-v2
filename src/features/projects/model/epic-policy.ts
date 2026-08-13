import type { PlatformRole } from "@/lib/types";
import type { EpicChildCounts, EpicDto } from "./epic-contract";

export type EpicDeletePolicy = {
  canDelete: boolean;
  isEmpty: boolean;
  children: EpicChildCounts;
  error: string;
};

export function canManageEpics(
  platformRole: PlatformRole | null | undefined,
) {
  return platformRole === "ceo" || platformRole === "deputy";
}

export function isManageableEpic(epic: Pick<EpicDto, "id">) {
  return Boolean(epic.id.trim());
}

export function normalizeEpicChildCounts(counts: Partial<EpicChildCounts> | null | undefined): EpicChildCounts {
  return {
    initiatives: Math.max(0, Math.trunc(Number(counts?.initiatives) || 0)),
    tasks: Math.max(0, Math.trunc(Number(counts?.tasks) || 0)),
  };
}

function countLabel(count: number, singular: string, plural: string) {
  return `${count} ${count === 1 ? singular : plural}`;
}

export function formatEpicChildCounts(counts: EpicChildCounts) {
  const normalized = normalizeEpicChildCounts(counts);
  const labels = [
    normalized.initiatives ? countLabel(normalized.initiatives, "Initiative", "Initiativen") : "",
    normalized.tasks ? countLabel(normalized.tasks, "Aufgabe", "Aufgaben") : "",
  ].filter(Boolean);

  if (!labels.length) return "keine Initiativen oder Aufgaben";
  return labels.join(" und ");
}

export function epicNotEmptyMessage(counts: EpicChildCounts) {
  return `Der Meilenstein kann nicht gelöscht werden, weil noch ${formatEpicChildCounts(counts)} zugeordnet sind.`;
}

export function buildEpicDeletePolicy(counts: EpicChildCounts): EpicDeletePolicy {
  const children = normalizeEpicChildCounts(counts);
  const isEmpty = children.initiatives === 0 && children.tasks === 0;
  return {
    canDelete: isEmpty,
    isEmpty,
    children,
    error: isEmpty ? "" : epicNotEmptyMessage(children),
  };
}
