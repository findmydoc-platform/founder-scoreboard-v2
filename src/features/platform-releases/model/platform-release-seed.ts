import type { PlatformReleaseManifestV2, PlatformReleaseManifestV3 } from "./platform-release-manifest";
import type { PlatformReleaseRecord } from "./platform-release-model";

const digest = "7f3c9b2a8d4e6f105b7c9d1e3f5a7b9c2d4e6f80123456789abcdef012345678";

function release(version: string, publishedAt: string, summary: string, titles: string[], major = false): PlatformReleaseRecord {
  const changes = titles.map((title, index) => ({
    id: `change-${version}-${index + 1}`,
    kind: index === titles.length - 1 ? "fix" as const : "feature" as const,
    pullRequests: [{ repository: index % 2 ? "findmydoc-platform/clinic-dashboard" : "findmydoc-platform/website", number: 1842 - index }],
    section: index % 2 ? "dashboard" as const : "public" as const,
    title,
    summary: [
      "Relevanz, Verfügbarkeit und Bewertungen werden jetzt verständlicher zusammengeführt.",
      "Die Suche versteht Tippfehler und Synonyme und liefert dadurch schneller passende Ergebnisse.",
      "Entfernung und Sprechzeiten lassen sich einfacher und genauer auswählen.",
      "Die Berechnung zeigt kürzere Wege zuverlässiger an.",
      "Ergebnislisten bleiben auch bei vielen Treffern übersichtlich.",
      "Mehrere seltene Darstellungsfehler wurden behoben.",
    ][index] || "Diese Änderung verbessert Stabilität und Verständlichkeit.",
    visualUrls: index === 0 && version === "v0.52.0" ? ["/product-updates/2026-08-13-planning-api-v2/planning-api-v2.png"] : [],
  }));
  const pullRequests = changes.slice(0, 3).map((change, index) => ({
    number: 1842 - index,
    repository: change.pullRequests[0].repository,
    title: index === 0 ? "feat(search): fuzzy and synonym search" : index === 1 ? "feat(filters): extend distance filters" : "fix(search): correct distance calculation",
    url: `https://github.com/${change.pullRequests[0].repository}/pull/${1842 - index}`,
    commitShas: [`a1b2c3${index}`],
    issues: [{ number: 214 + index, repository: "findmydoc-platform/management", title: titleSafe(change.title), url: `https://github.com/findmydoc-platform/management/issues/${214 + index}` }],
  }));
  const component = (key: "website" | "dashboard", displayName: string, repository: string, productionUrl: string): PlatformReleaseManifestV2["components"][number] => ({
    key,
    displayName,
    productionUrl,
    repository,
    targetSha: key === "website" ? "a1b2c3d" : "d4e5f6a",
    release: `https://github.com/${repository}/releases/tag/${version}`,
    deploymentRun: `https://github.com/${repository}/actions/runs/2387`,
    commits: pullRequests.filter((request) => request.repository === repository).map((request, index) => ({ bump: "patch", message: request.title, sha: request.commitShas[0], url: `https://github.com/${repository}/commit/${request.commitShas[0]}${index}` })),
    pullRequests: pullRequests.filter((request) => request.repository === repository),
  });
  const manifest: PlatformReleaseManifestV2 = {
    schemaVersion: 2,
    version,
    summary,
    highlights: changes.slice(0, 6).map((change) => change.id),
    changes,
    components: [
      component("website", "Website", "findmydoc-platform/website", "https://findmydoc.eu"),
      component("dashboard", "Clinic Dashboard", "findmydoc-platform/clinic-dashboard", "https://clinics.findmydoc.eu"),
    ],
    visuals: changes[0]?.visualUrls.map((url) => ({ altText: "Übersicht der verbesserten Suchergebnisse", formFactor: "desktop", label: "Neue Ergebnisdarstellung", releaseEligible: true, releaseRole: "primary", repository: "findmydoc-platform/website", pullRequestNumber: 1842, source: "ui-ux", url })) || [],
    planDigest: digest,
    contentDigest: digest,
    manifestDigest: digest,
    publishedAt,
  };
  return {
    version,
    summary,
    publishedAt,
    manifestDigest: digest,
    manifest,
    planningReferences: major ? [] : [
      { repository: "findmydoc-platform/website", pullRequestNumber: 1842, taskLinks: [
        { id: "F0-214-D3-S1", title: "Fuzzy-Suche umsetzen", type: "sub_issue", href: "/tasks/F0-214-D3-S1", issueNumber: 214 },
        { id: "F0-214-D3", title: "Smart Match Release", type: "deliverable", href: "/tasks/F0-214-D3" },
        { id: "F0-214", title: "Schnellere Arzttermin-Suche", type: "initiative", href: "/initiatives/F0-214" },
      ] },
    ],
    notificationId: version === "v0.52.0" ? 9001 : null,
    seenAt: version === "v0.52.0" ? null : publishedAt,
  };
}

function titleSafe(value: string) {
  return value.slice(0, 120);
}

function applicationRelease(): PlatformReleaseRecord {
  const manifest: PlatformReleaseManifestV3 = {
    schemaVersion: 3,
    releaseMode: "application",
    notificationMode: "silent",
    source: { kind: "github-release-import", importedAt: "2026-08-17T10:00:00.000Z" },
    version: "v0.45.0",
    summary: "Die Website bündelt eine klarere Suche und verlässlichere Klinikprofile.",
    highlights: ["website-search"],
    changes: [{
      id: "website-search",
      kind: "feature",
      componentKeys: ["website"],
      pullRequests: [{ repository: "findmydoc-platform/website", number: 1600 }],
      commitShas: ["c1d2e3f"],
      title: "Klarere Website-Suche",
      summary: "Patient:innen erkennen passende Kliniken schneller und erhalten verlässlichere Profildaten.",
      visualUrls: [],
    }],
    components: [{
      key: "website",
      displayName: "Website",
      productionUrl: "https://findmydoc.eu",
      repository: "findmydoc-platform/website",
      targetSha: "c1d2e3f",
      release: "https://github.com/findmydoc-platform/website/releases/tag/v0.45.0",
      deploymentRun: null,
      commits: [{ bump: "minor", message: "feat: improve search", sha: "c1d2e3f", url: "https://github.com/findmydoc-platform/website/commit/c1d2e3f" }],
      pullRequests: [{ number: 1600, repository: "findmydoc-platform/website", title: "feat: improve search", url: "https://github.com/findmydoc-platform/website/pull/1600", commitShas: ["c1d2e3f"], issues: [] }],
    }],
    visuals: [],
    planDigest: digest,
    contentDigest: digest,
    manifestDigest: digest,
    publishedAt: "2026-05-20T10:00:00.000Z",
  };
  return {
    version: manifest.version,
    summary: manifest.summary,
    publishedAt: manifest.publishedAt,
    manifestDigest: manifest.manifestDigest,
    manifest,
    planningReferences: [],
    notificationId: null,
    seenAt: manifest.publishedAt,
  };
}

export const platformReleaseSeed: PlatformReleaseRecord[] = [
  release("v1.0.0", "2026-09-03T08:30:00.000Z", "findmydoc bringt Suche und Praxissteuerung in einer stabilen Hauptversion zusammen.", ["Gemeinsame Plattformbasis", "Verlässliche Release-Nachweise"], true),
  release("v0.52.0", "2026-08-11T08:24:00.000Z", "Patient:innen finden schneller passende Arzttermine.", ["Relevantere Ergebnisse für Patient:innen", "Fuzzy- und Synonym-Suche", "Neue Optionen für Entfernung und Sprechzeiten", "Kürzere Wege durch präzisere Berechnung", "Bessere Übersicht in den Ergebnissen", "Stabiler und schneller"]),
  release("v0.51.0", "2026-07-28T09:10:00.000Z", "Praxen steuern Verfügbarkeiten übersichtlicher.", ["Klarere Verfügbarkeiten", "Einfachere Tagesansicht"]),
  release("v0.50.0", "2026-07-09T07:45:00.000Z", "Die Terminsuche reagiert schneller und verständlicher.", ["Schnellere Terminsuche", "Verständlichere Fehlermeldungen"]),
  release("v0.49.0", "2026-06-18T11:00:00.000Z", "Patient:innen erkennen passende Praxen auf einen Blick.", ["Bessere Praxisübersicht", "Klarere Kontaktdaten"]),
  release("v0.48.0", "2026-06-04T10:15:00.000Z", "Clinic-Teams verwalten Standorte zuverlässiger.", ["Zuverlässigere Standortverwaltung", "Verbesserte Teamansicht"]),
  applicationRelease(),
];
