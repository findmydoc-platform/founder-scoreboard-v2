import type { TeamWorkweekWindows } from "./team-workweek-draft";

export type PublishedTeamWorkweek = Readonly<{
  id: string;
  ownerProfileId: string;
  effectiveFrom: string;
  effectiveAt?: string | null;
  effectiveUntil?: string | null;
  timezone: "Europe/Berlin";
  publishedAt: string;
  lastSyncAt: string;
  publicationRevision: number;
  phase: "current" | "prepared";
  windows: TeamWorkweekWindows;
}>;

type VisibilityCandidate = Readonly<{
  ownerProfileId: string;
  effectiveFrom: string;
  effectiveAt?: string | null;
  effectiveUntil?: string | null;
  effectiveTo: string | null;
  publicationRevision: number;
}>;

export function selectVisibleTeamWorkweeks<T extends VisibilityCandidate>(rows: T[], today: string, now = new Date()) {
  const byOwner = new Map<string, T[]>();
  for (const row of rows) {
    const ownerRows = byOwner.get(row.ownerProfileId) || [];
    ownerRows.push(row);
    byOwner.set(row.ownerProfileId, ownerRows);
  }

  return [...byOwner.values()].flatMap((ownerRows) => {
    const current = ownerRows
      .filter((row) => (row.effectiveAt ? new Date(row.effectiveAt) <= now : row.effectiveFrom <= today) && (row.effectiveUntil ? new Date(row.effectiveUntil) > now : (!row.effectiveTo || row.effectiveTo >= today)))
      .sort((left, right) => (right.effectiveAt || right.effectiveFrom).localeCompare(left.effectiveAt || left.effectiveFrom)
        || right.publicationRevision - left.publicationRevision)[0];
    const prepared = ownerRows
      .filter((row) => row.effectiveAt ? new Date(row.effectiveAt) > now : row.effectiveFrom > today)
      .sort((left, right) => (left.effectiveAt || left.effectiveFrom).localeCompare(right.effectiveAt || right.effectiveFrom)
        || left.publicationRevision - right.publicationRevision)[0];
    return [current ? { ...current, phase: "current" as const } : null, prepared ? { ...prepared, phase: "prepared" as const } : null]
      .filter((entry): entry is T & { phase: "current" | "prepared" } => Boolean(entry));
  });
}
