export const platformReleaseComponentCatalog = {
  dashboard: {
    displayName: "Clinic Dashboard",
    productionUrl: "https://clinics.findmydoc.eu",
    repository: "findmydoc-platform/clinic-dashboard",
  },
  website: {
    displayName: "Website",
    productionUrl: "https://findmydoc.eu",
    repository: "findmydoc-platform/website",
  },
} as const;

export const platformReleaseComponentKeys = Object.keys(platformReleaseComponentCatalog) as Array<keyof typeof platformReleaseComponentCatalog>;
export const platformReleaseChangeKinds = ["feature", "fix", "maintenance"] as const;
export const platformReleaseSections = ["dashboard", "platform", "public"] as const;
export const platformReleaseFormFactors = ["desktop", "mobile", "tablet"] as const;

export type PlatformReleaseComponentKey = keyof typeof platformReleaseComponentCatalog;
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
  deploymentRun: string | null;
  commits: PlatformReleaseCommit[];
  pullRequests: PlatformReleasePullRequest[];
};

export type PlatformReleaseChangeV2 = {
  id: string;
  kind: PlatformReleaseChangeKind;
  pullRequests: Array<{ repository: string; number: number }>;
  section: (typeof platformReleaseSections)[number];
  summary: string;
  title: string;
  visualUrls: string[];
};

export type PlatformReleaseChangeV3 = {
  id: string;
  kind: PlatformReleaseChangeKind;
  componentKeys: PlatformReleaseComponentKey[];
  pullRequests: Array<{ repository: string; number: number }>;
  commitShas: string[];
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

type PlatformReleaseManifestBase = {
  version: string;
  summary: string;
  highlights: string[];
  components: PlatformReleaseComponent[];
  visuals: PlatformReleaseVisual[];
  planDigest: string;
  contentDigest: string;
  manifestDigest: string;
  publishedAt: string;
};

export type PlatformReleaseManifestV2 = PlatformReleaseManifestBase & {
  schemaVersion: 2;
  changes: PlatformReleaseChangeV2[];
};

export type PlatformReleaseManifestV3 = PlatformReleaseManifestBase & {
  schemaVersion: 3;
  releaseMode: "application" | "platform";
  notificationMode: "standard" | "silent";
  source: { kind: "native" } | { kind: "github-release-import"; importedAt: string };
  changes: PlatformReleaseChangeV3[];
};

export type PlatformReleaseManifest = PlatformReleaseManifestV2 | PlatformReleaseManifestV3;

export function platformReleaseNotificationState(
  manifest: PlatformReleaseManifest,
  publishedAt: string,
  notification?: { id: number; seen_at: string | null },
) {
  const silent = manifest.schemaVersion === 3 && manifest.notificationMode === "silent";
  return {
    notificationId: notification?.id || null,
    seenAt: notification?.seen_at || (silent ? publishedAt : null),
  };
}

type ValidationResult =
  | { ok: true; manifest: PlatformReleaseManifest }
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

function isExactGitHubUrl(value: unknown, pathname: string) {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname === "github.com" && !url.port
      && url.pathname === pathname && !url.username && !url.password && !url.search && !url.hash;
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

function validComponent(value: unknown, schemaVersion: 2 | 3, version: string): value is PlatformReleaseComponent {
  if (!isObject(value) || !platformReleaseComponentKeys.includes(value.key as PlatformReleaseComponentKey)) return false;
  const catalogEntry = platformReleaseComponentCatalog[value.key as PlatformReleaseComponentKey];
  return typeof value.displayName === "string" && value.displayName.length <= 100
    && isHttpUrl(value.productionUrl)
      && typeof value.repository === "string" && value.repository.length <= 200
    && (schemaVersion === 2 || (
      value.displayName === catalogEntry.displayName
      && value.productionUrl === catalogEntry.productionUrl
      && value.repository === catalogEntry.repository
    ))
      && typeof value.targetSha === "string" && (schemaVersion === 2 ? /^[a-f0-9]{7,64}$/i : /^[a-f0-9]{40}$/).test(value.targetSha)
      && isHttpUrl(value.release)
      && (schemaVersion === 2 || isExactGitHubUrl(value.release, `/${catalogEntry.repository}/releases/tag/${version}`))
      && (isHttpUrl(value.deploymentRun) || (schemaVersion === 3 && value.deploymentRun === null))
      && (schemaVersion === 2 || value.deploymentRun === null || (
        typeof value.deploymentRun === "string"
        && /^\d+$/.test(new URL(value.deploymentRun).pathname.split("/").at(-1) || "")
        && isExactGitHubUrl(value.deploymentRun, `/${catalogEntry.repository}/actions/runs/${new URL(value.deploymentRun).pathname.split("/").at(-1)}`)
      ))
    && Array.isArray(value.commits) && value.commits.length <= 1000 && value.commits.every((commit) => (
      isObject(commit)
      && typeof commit.bump === "string"
      && typeof commit.message === "string" && commit.message.length <= 1000
        && typeof commit.sha === "string" && (schemaVersion === 2 ? /^[a-f0-9]{7,64}$/i : /^[a-f0-9]{40}$/).test(commit.sha)
        && isHttpUrl(commit.url)
      && (schemaVersion === 2 || isExactGitHubUrl(commit.url, `/${catalogEntry.repository}/commit/${commit.sha}`))
      ))
    && Array.isArray(value.pullRequests) && value.pullRequests.length <= 500 && value.pullRequests.every((pullRequest) => (
      validPullRequest(pullRequest)
      && (schemaVersion === 2 || (
        pullRequest.repository === catalogEntry.repository
        && isExactGitHubUrl(pullRequest.url, `/${catalogEntry.repository}/pull/${pullRequest.number}`)
        && pullRequest.commitShas.every((sha) => /^[a-f0-9]{40}$/.test(sha))
        && pullRequest.issues.every((issue) => (
          isExactGitHubUrl(issue.url, `/${issue.repository}/issues/${issue.number}`)
        ))
      ))
    ));
}

function validChangeBase(value: Record<string, unknown>) {
  return typeof value.id === "string" && /^[a-z0-9][a-z0-9._-]{0,127}$/i.test(value.id)
    && platformReleaseChangeKinds.includes(value.kind as PlatformReleaseChangeKind)
    && typeof value.title === "string" && value.title.length <= 500
    && typeof value.summary === "string" && value.summary.length <= 2000
    && isStringArray(value.visualUrls, 50) && value.visualUrls.every(isHttpUrl)
    && Array.isArray(value.pullRequests) && value.pullRequests.length <= 100 && value.pullRequests.every((reference) => (
      isObject(reference)
      && typeof reference.repository === "string" && reference.repository.length <= 200
      && Number.isInteger(reference.number) && Number(reference.number) > 0
    ));
}

function validChangeV2(value: unknown): value is PlatformReleaseChangeV2 {
  return isObject(value)
    && validChangeBase(value)
    && platformReleaseSections.includes(value.section as PlatformReleaseChangeV2["section"]);
}

function validChangeV3(value: unknown): value is PlatformReleaseChangeV3 {
  return isObject(value)
    && validChangeBase(value)
    && Array.isArray(value.componentKeys) && value.componentKeys.length > 0
    && value.componentKeys.length <= platformReleaseComponentKeys.length
    && value.componentKeys.every((key) => platformReleaseComponentKeys.includes(key as PlatformReleaseComponentKey))
    && new Set(value.componentKeys).size === value.componentKeys.length
    && isStringArray(value.commitShas, 1000)
    && value.commitShas.every((sha) => /^[a-f0-9]{40}$/.test(sha));
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

function validSource(value: unknown) {
  if (!isObject(value)) return false;
  if (value.kind === "native") return Object.keys(value).length === 1;
  return value.kind === "github-release-import"
    && Object.keys(value).length === 2
    && typeof value.importedAt === "string"
    && !Number.isNaN(Date.parse(value.importedAt))
    && new Date(value.importedAt).toISOString() === value.importedAt;
}

function validateReferences(manifest: PlatformReleaseManifestV3): string | null {
  const componentKeys = new Set(manifest.components.map((component) => component.key));
  const pullRequestOwners = new Map(manifest.components.flatMap((component) => component.pullRequests.map((pullRequest) => [`${pullRequest.repository}#${pullRequest.number}`, component.key])));
  const commitOwners = new Map(manifest.components.flatMap((component) => component.commits.map((commit) => [commit.sha, component.key])));
  for (const change of manifest.changes) {
    if (change.componentKeys.some((key) => !componentKeys.has(key))) return `Änderung ${change.id} verweist auf eine nicht enthaltene Komponente.`;
    if (change.pullRequests.some((reference) => {
      const owner = pullRequestOwners.get(`${reference.repository}#${reference.number}`);
      return !owner || !change.componentKeys.includes(owner);
    })) return `Änderung ${change.id} verweist auf einen unbekannten oder komponentenfremden Pull Request.`;
    if (change.commitShas.some((sha) => {
      const owner = commitOwners.get(sha);
      return !owner || !change.componentKeys.includes(owner);
    })) return `Änderung ${change.id} verweist auf einen unbekannten oder komponentenfremden Commit.`;
  }
  return null;
}

export function validatePlatformReleaseManifest(value: unknown): ValidationResult {
  if (!isObject(value)) return { ok: false, error: "Manifest muss ein JSON-Objekt sein." };
  if (value.schemaVersion !== 2 && value.schemaVersion !== 3) return { ok: false, error: "Nur Manifest-Schema v2 und v3 werden unterstützt." };
  const schemaVersion = value.schemaVersion;
  if (typeof value.version !== "string" || !/^v\d+\.\d+\.\d+$/.test(value.version)) return { ok: false, error: "Version muss dem Format vX.Y.Z entsprechen." };
  if (typeof value.summary !== "string" || !value.summary.trim() || value.summary.length > 1000) return { ok: false, error: "Zusammenfassung fehlt oder ist zu lang." };
  if (!isStringArray(value.highlights, 6) || value.highlights.length < 1) return { ok: false, error: "Ein bis sechs Highlights sind erforderlich." };
  const changes = value.changes;
  if (!Array.isArray(changes) || changes.length > 500 || !changes.every(schemaVersion === 2 ? validChangeV2 : validChangeV3)) return { ok: false, error: "Änderungen sind ungültig." };
  const changeIds = new Set(changes.map((change) => (change as PlatformReleaseChangeV2 | PlatformReleaseChangeV3).id));
  if (value.highlights.some((id) => !changeIds.has(id))) return { ok: false, error: "Jedes Highlight muss auf eine Änderung verweisen." };
  const components = value.components;
  if (!Array.isArray(components) || !components.every((component) => validComponent(component, schemaVersion, value.version as string))) return { ok: false, error: "Komponenten sind ungültig." };
  const componentKeys = components.map((component) => component.key);
  if (new Set(componentKeys).size !== componentKeys.length) return { ok: false, error: "Jede Komponente darf nur einmal enthalten sein." };
  if (schemaVersion === 2 && components.length !== platformReleaseComponentKeys.length) return { ok: false, error: "Jede Plattform-Komponente muss genau einmal enthalten sein." };
  if (schemaVersion === 3) {
    if (value.releaseMode !== "application" && value.releaseMode !== "platform") return { ok: false, error: "Release-Modus ist ungültig." };
    if (value.releaseMode === "application" && components.length !== 1) return { ok: false, error: "Ein Application-Release muss genau eine Komponente enthalten." };
    if (value.releaseMode === "platform" && components.length < 2) return { ok: false, error: "Ein Platform-Release muss mindestens zwei Komponenten enthalten." };
    if (value.notificationMode !== "standard" && value.notificationMode !== "silent") return { ok: false, error: "Benachrichtigungsmodus ist ungültig." };
    if (!validSource(value.source)) return { ok: false, error: "Release-Quelle ist ungültig." };
    const sourceKind = (value.source as { kind: string }).kind;
    if ((value.releaseMode === "application" && (value.notificationMode !== "silent" || sourceKind !== "github-release-import"))
      || (value.releaseMode === "platform" && (value.notificationMode !== "standard" || sourceKind !== "native"))) {
      return { ok: false, error: "Release-Modus, Benachrichtigung und Quelle passen nicht zusammen." };
    }
    const referenceError = validateReferences(value as unknown as PlatformReleaseManifestV3);
    if (referenceError) return { ok: false, error: referenceError };
  }
  if (!Array.isArray(value.visuals) || value.visuals.length > 200 || !value.visuals.every(validVisual)) return { ok: false, error: "Visuals sind ungültig." };
  if (!isDigest(value.planDigest) || !isDigest(value.contentDigest) || !isDigest(value.manifestDigest)) return { ok: false, error: "Manifest-Digests sind ungültig." };
  if (typeof value.publishedAt !== "string" || Number.isNaN(Date.parse(value.publishedAt))) return { ok: false, error: "Veröffentlichungszeitpunkt ist ungültig." };
  return { ok: true, manifest: value as unknown as PlatformReleaseManifest };
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!isObject(value)) return value;
  return Object.fromEntries(Object.keys(value).sort((left, right) => left.localeCompare(right)).map((key) => [key, stableValue(value[key])]));
}

export function canonicalPlatformReleaseManifest(manifest: PlatformReleaseManifest) {
  const unsignedManifest: Partial<PlatformReleaseManifest> = { ...manifest };
  delete unsignedManifest.manifestDigest;
  return `${JSON.stringify(stableValue(unsignedManifest), null, 2)}\n`;
}
