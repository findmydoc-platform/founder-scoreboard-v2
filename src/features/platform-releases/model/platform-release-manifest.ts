export const platformReleaseComponentKeys = ["website", "dashboard"] as const;
export const platformReleaseChangeKinds = ["feature", "fix", "maintenance"] as const;
export const platformReleaseSections = ["dashboard", "platform", "public"] as const;
export const platformReleaseFormFactors = ["desktop", "mobile", "tablet"] as const;

export type PlatformReleaseComponentKey = (typeof platformReleaseComponentKeys)[number];
export type PlatformReleaseChangeKind = (typeof platformReleaseChangeKinds)[number];

export type PlatformReleaseIssueReference = {
  number: number;
  repository: string;
  title: string;
  url: string;
};

export type PlatformReleasePullRequest = {
  number: number;
  repository: string;
  title: string;
  url: string;
  commitShas: string[];
  issues: PlatformReleaseIssueReference[];
};

export type PlatformReleaseCommit = {
  bump: string;
  message: string;
  sha: string;
  url: string;
};

export type PlatformReleaseComponent = {
  key: PlatformReleaseComponentKey;
  displayName: string;
  productionUrl: string;
  repository: string;
  targetSha: string;
  release: string;
  deploymentRun: string;
  commits: PlatformReleaseCommit[];
  pullRequests: PlatformReleasePullRequest[];
};

export type PlatformReleaseChange = {
  id: string;
  kind: PlatformReleaseChangeKind;
  pullRequests: Array<{ repository: string; number: number }>;
  section: (typeof platformReleaseSections)[number];
  summary: string;
  title: string;
  visualUrls: string[];
};

export type PlatformReleaseVisual = {
  altText: string;
  formFactor: (typeof platformReleaseFormFactors)[number];
  label: string;
  releaseEligible: boolean;
  releaseRole?: string;
  repository: string;
  pullRequestNumber: number;
  source: string;
  url: string;
};

export type PlatformReleaseManifestV2 = {
  schemaVersion: 2;
  version: string;
  summary: string;
  highlights: string[];
  changes: PlatformReleaseChange[];
  components: PlatformReleaseComponent[];
  visuals: PlatformReleaseVisual[];
  planDigest: string;
  contentDigest: string;
  manifestDigest: string;
  publishedAt: string;
};

type ValidationResult =
  | { ok: true; manifest: PlatformReleaseManifestV2 }
  | { ok: false; error: string };

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isHttpUrl(value: unknown) {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

export function platformReleaseReferenceUrl(value: unknown) {
  if (isHttpUrl(value)) return value as string;
  if (isObject(value) && isHttpUrl(value.url)) return value.url as string;
  return "";
}

function isStringArray(value: unknown, maximum = 500): value is string[] {
  return Array.isArray(value) && value.length <= maximum && value.every((entry) => typeof entry === "string");
}

function isDigest(value: unknown) {
  return typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
}

function validIssue(value: unknown): value is PlatformReleaseIssueReference {
  return isObject(value)
    && Number.isInteger(value.number) && Number(value.number) > 0
    && typeof value.repository === "string" && value.repository.length <= 200
    && typeof value.title === "string" && value.title.length <= 500
    && isHttpUrl(value.url);
}

function validPullRequest(value: unknown): value is PlatformReleasePullRequest {
  return isObject(value)
    && Number.isInteger(value.number) && Number(value.number) > 0
    && typeof value.repository === "string" && value.repository.length <= 200
    && typeof value.title === "string" && value.title.length <= 500
    && isHttpUrl(value.url)
    && isStringArray(value.commitShas)
    && Array.isArray(value.issues) && value.issues.length <= 200 && value.issues.every(validIssue);
}

function validComponent(value: unknown): value is PlatformReleaseComponent {
  return isObject(value)
    && platformReleaseComponentKeys.includes(value.key as PlatformReleaseComponentKey)
    && typeof value.displayName === "string" && value.displayName.length <= 100
    && isHttpUrl(value.productionUrl)
    && typeof value.repository === "string" && value.repository.length <= 200
    && typeof value.targetSha === "string" && /^[a-f0-9]{7,64}$/i.test(value.targetSha)
    && isHttpUrl(value.release)
    && isHttpUrl(value.deploymentRun)
    && Array.isArray(value.commits) && value.commits.length <= 1000 && value.commits.every((commit) => (
      isObject(commit)
      && typeof commit.bump === "string"
      && typeof commit.message === "string" && commit.message.length <= 1000
      && typeof commit.sha === "string" && /^[a-f0-9]{7,64}$/i.test(commit.sha)
      && isHttpUrl(commit.url)
    ))
    && Array.isArray(value.pullRequests) && value.pullRequests.length <= 500 && value.pullRequests.every(validPullRequest);
}

function validChange(value: unknown): value is PlatformReleaseChange {
  return isObject(value)
    && typeof value.id === "string" && /^[a-z0-9][a-z0-9._-]{0,127}$/i.test(value.id)
    && platformReleaseChangeKinds.includes(value.kind as PlatformReleaseChangeKind)
    && platformReleaseSections.includes(value.section as PlatformReleaseChange["section"])
    && typeof value.title === "string" && value.title.length <= 500
    && typeof value.summary === "string" && value.summary.length <= 2000
    && isStringArray(value.visualUrls, 50) && value.visualUrls.every(isHttpUrl)
    && Array.isArray(value.pullRequests) && value.pullRequests.length <= 100 && value.pullRequests.every((reference) => (
      isObject(reference)
      && typeof reference.repository === "string" && reference.repository.length <= 200
      && Number.isInteger(reference.number) && Number(reference.number) > 0
    ));
}

function validVisual(value: unknown): value is PlatformReleaseVisual {
  return isObject(value)
    && typeof value.altText === "string" && value.altText.length <= 500
    && platformReleaseFormFactors.includes(value.formFactor as PlatformReleaseVisual["formFactor"])
    && typeof value.label === "string" && value.label.length <= 200
    && typeof value.releaseEligible === "boolean"
    && (value.releaseRole === undefined || typeof value.releaseRole === "string")
    && typeof value.repository === "string" && value.repository.length <= 200
    && Number.isInteger(value.pullRequestNumber) && Number(value.pullRequestNumber) > 0
    && typeof value.source === "string" && value.source.length <= 500
    && isHttpUrl(value.url);
}

export function validatePlatformReleaseManifest(value: unknown): ValidationResult {
  if (!isObject(value)) return { ok: false, error: "Manifest muss ein JSON-Objekt sein." };
  if (value.schemaVersion !== 2) return { ok: false, error: "Nur Manifest-Schema v2 wird unterstützt." };
  if (typeof value.version !== "string" || !/^v\d+\.\d+\.\d+$/.test(value.version)) return { ok: false, error: "Version muss dem Format vX.Y.Z entsprechen." };
  if (typeof value.summary !== "string" || !value.summary.trim() || value.summary.length > 1000) return { ok: false, error: "Zusammenfassung fehlt oder ist zu lang." };
  if (!isStringArray(value.highlights, 6) || value.highlights.length < 1) return { ok: false, error: "Ein bis sechs Highlights sind erforderlich." };
  if (!Array.isArray(value.changes) || value.changes.length > 500 || !value.changes.every(validChange)) return { ok: false, error: "Änderungen sind ungültig." };
  const changeIds = new Set(value.changes.map((change) => change.id));
  if (value.highlights.some((id) => !changeIds.has(id))) return { ok: false, error: "Jedes Highlight muss auf eine Änderung verweisen." };
  if (!Array.isArray(value.components) || value.components.length !== platformReleaseComponentKeys.length || !value.components.every(validComponent)) return { ok: false, error: "Komponenten sind ungültig." };
  if (new Set(value.components.map((component) => component.key)).size !== platformReleaseComponentKeys.length) return { ok: false, error: "Jede Plattform-Komponente muss genau einmal enthalten sein." };
  if (!Array.isArray(value.visuals) || value.visuals.length > 200 || !value.visuals.every(validVisual)) return { ok: false, error: "Visuals sind ungültig." };
  if (!isDigest(value.planDigest) || !isDigest(value.contentDigest) || !isDigest(value.manifestDigest)) return { ok: false, error: "Manifest-Digests sind ungültig." };
  if (typeof value.publishedAt !== "string" || Number.isNaN(Date.parse(value.publishedAt))) return { ok: false, error: "Veröffentlichungszeitpunkt ist ungültig." };
  return { ok: true, manifest: value as PlatformReleaseManifestV2 };
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!isObject(value)) return value;
  return Object.fromEntries(Object.keys(value).sort((left, right) => left.localeCompare(right)).map((key) => [key, stableValue(value[key])]));
}

export function canonicalPlatformReleaseManifest(manifest: PlatformReleaseManifestV2) {
  const unsignedManifest: Partial<PlatformReleaseManifestV2> = { ...manifest };
  delete unsignedManifest.manifestDigest;
  return `${JSON.stringify(stableValue(unsignedManifest), null, 2)}\n`;
}
