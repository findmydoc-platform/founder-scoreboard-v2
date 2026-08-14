import type { PlatformReleaseManifestV2 } from "./platform-release-manifest";

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

export type PlatformReleaseRecord = {
  version: string;
  summary: string;
  publishedAt: string;
  manifestDigest: string;
  manifest: PlatformReleaseManifestV2;
  planningReferences: PlatformReleasePlanningReference[];
  notificationId: number | null;
  seenAt: string | null;
};

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

export function highlightedChanges(release: PlatformReleaseRecord) {
  const changes = new Map(release.manifest.changes.map((change) => [change.id, change]));
  return release.manifest.highlights.map((id) => changes.get(id)).filter(Boolean) as PlatformReleaseManifestV2["changes"];
}

export function releaseApplicationNames(release: PlatformReleaseRecord) {
  return release.manifest.components.map((component) => component.displayName);
}

export function formatReleaseDate(value: string) {
  return new Intl.DateTimeFormat("de-DE", { day: "2-digit", month: "long", year: "numeric" }).format(new Date(value));
}

export function releaseQuarter(value: string) {
  const date = new Date(value);
  return `${Math.floor(date.getUTCMonth() / 3) + 1}. Quartal ${date.getUTCFullYear()}`;
}
