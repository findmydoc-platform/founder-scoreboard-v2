import type { TeamWorkweekWindows } from "./team-workweek-draft";

export type PublishedTeamWorkweek = Readonly<{
  id: string;
  ownerProfileId: string;
  effectiveFrom: string;
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
  effectiveTo: string | null;
  publicationRevision: number;
}>;

export function selectVisibleTeamWorkweeks<T extends VisibilityCandidate>(rows: T[], today: string) {
  const byOwner = new Map<string, T[]>();
  for (const row of rows) {
    const ownerRows = byOwner.get(row.ownerProfileId) || [];
    ownerRows.push(row);
    byOwner.set(row.ownerProfileId, ownerRows);
  }

  return [...byOwner.values()].flatMap((ownerRows) => {
    const current = ownerRows
      .filter((row) => row.effectiveFrom <= today && (!row.effectiveTo || row.effectiveTo >= today))
      .sort((left, right) => right.effectiveFrom.localeCompare(left.effectiveFrom)
        || right.publicationRevision - left.publicationRevision)[0];
    const prepared = ownerRows
      .filter((row) => row.effectiveFrom > today)
      .sort((left, right) => left.effectiveFrom.localeCompare(right.effectiveFrom)
        || left.publicationRevision - right.publicationRevision)[0];
    return [current ? { ...current, phase: "current" as const } : null, prepared ? { ...prepared, phase: "prepared" as const } : null]
      .filter((entry): entry is T & { phase: "current" | "prepared" } => Boolean(entry));
  });
}
