import type { PlatformReleaseManifest } from "./platform-release-manifest";

export type PlatformReleasePlanningLink = {
  id: string;
  title: string;
  type: "initiative" | "deliverable" | "sub_issue";
  href: string;
  issueNumber?: number;
};

export type PlatformReleasePlanningReference = {
  repository: string;
  pullRequestNumber: number;
  taskLinks: PlatformReleasePlanningLink[];
};

export type PlatformReleaseContent = {
  version: string;
  summary: string;
  publishedAt: string;
  manifestDigest: string;
  manifest: PlatformReleaseManifest;
  notificationId: number | null;
  seenAt: string | null;
};

// The existing public release resource still returns complete Planning references.
export type PlatformReleaseRecord = PlatformReleaseContent & { planningReferences: PlatformReleasePlanningReference[] };

export type PlatformReleaseReferenceKey = Pick<PlatformReleaseContent, "version" | "manifestDigest">;
export type PlatformReleaseReferenceReceipt = PlatformReleaseReferenceKey & {
  planningReferences: PlatformReleasePlanningReference[];
  sourceRevision: string;
  readActor: { profileId: string; platformRole: import("@/lib/types").PlatformRole };
  readAuthority: import("@/features/planning/model/planning-server-header-read").PlanningReadAuthority;
};
export type PlatformReleaseReferenceEntry = Readonly<{
  id: string;
  key: PlatformReleaseReferenceKey;
  session: import("@/lib/credentials/session-types").ServerSessionView;
  readActor: PlatformReleaseReferenceReceipt["readActor"];
  readAuthority: PlatformReleaseReferenceReceipt["readAuthority"];
  timeoutAt: number;
}>;
export type PlatformReleaseReferenceEntryOutcome = { status: "ready"; receipt: PlatformReleaseReferenceReceipt }
  | { status: "forbidden" | "unavailable" | "stale-manifest" };
export type PlatformReleaseReferenceObservation = Pick<PlatformReleaseReferenceReceipt, "sourceRevision" | "readActor" | "readAuthority">;
export type PlatformReleaseReferenceState =
  | { status: "ready"; planningReferences: PlatformReleasePlanningReference[] }
  | { status: "not-loaded" | "loading" | "unavailable" | "forbidden" | "stale-manifest" };

export const unloadedPlatformReleaseReferences: PlatformReleaseReferenceState = Object.freeze({ status: "not-loaded" });

export type PlatformReleaseArchiveModel = {
  releases: PlatformReleaseRecord[];
};

export function compareReleaseVersions(left: string, right: string) {
  const parse = (value: string) => value.replace(/^v/, "").split(".").map(Number);
  const leftParts = parse(left);
  const rightParts = parse(right);
  for (let index = 0; index < 3; index += 1) {
    if (leftParts[index] !== rightParts[index]) return (rightParts[index] || 0) - (leftParts[index] || 0);
  }
  return 0;
}

export function isMajorRelease(version: string) {
  return /^v[1-9]\d*\.0\.0$/.test(version);
}

export function highlightedChanges(release: PlatformReleaseContent) {
  const changes = new Map(release.manifest.changes.map((change) => [change.id, change]));
  return release.manifest.highlights.map((id) => changes.get(id)).filter(Boolean) as PlatformReleaseManifest["changes"];
}

export function releaseTitle(release: PlatformReleaseContent) {
  return release.manifest.schemaVersion === 3 && release.manifest.title?.trim()
    ? release.manifest.title.trim()
    : `findmydoc ${release.version}`;
}

export function releaseKindLabel(release: PlatformReleaseContent) {
  return release.manifest.schemaVersion === 3 && release.manifest.releaseMode === "application"
    ? "Anwendungs-Release"
    : "Plattform-Release";
}

export function releaseApplicationNames(release: PlatformReleaseContent) {
  return release.manifest.components.map((component) => component.displayName);
}

export function formatReleaseDate(value: string) {
  return new Intl.DateTimeFormat("de-DE", { day: "2-digit", month: "long", year: "numeric" }).format(new Date(value));
}

export function releaseQuarter(value: string) {
  const date = new Date(value);
  return `${Math.floor(date.getUTCMonth() / 3) + 1}. Quartal ${date.getUTCFullYear()}`;
}
