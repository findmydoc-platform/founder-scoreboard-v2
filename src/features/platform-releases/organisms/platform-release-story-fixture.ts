import { platformReleaseSeed } from "../model/platform-release-seed";
import type { PlatformReleaseRecord } from "../model/platform-release-model";
import type { PlatformReleaseManifestV3 } from "../model/platform-release-manifest";

export function releaseStoryFixture(highlights = ["clinic-access"]): PlatformReleaseRecord & { manifest: PlatformReleaseManifestV3 } {
  const base = structuredClone(platformReleaseSeed[0]);
  const version = "v0.50.0";
  const summary = "Ein persönlicher Zugang bündelt berechtigte Kliniken und schützt Entwürfe beim Wechsel. Die Production-Abnahme folgt separat.";
  return {
    ...base,
    version,
    summary,
    notificationId: null,
    manifest: {
      ...base.manifest,
      version,
      summary,
      schemaVersion: 3,
      releaseMode: "platform",
      notificationMode: "standard",
      source: { kind: "native" },
      title: "Klinikgruppen im Dashboard vorbereitet",
      highlights,
      changes: [
        ["clinic-access", "Berechtigte Kliniken gemeinsam verwalten"],
        ["post-schedule", "Blog-Veröffentlichungen nachvollziehen"],
        ["admin-access", "Interne Admin-Verwaltung begrenzen"],
        ["maintenance", "Prüfungen und Wartung vereinfachen"],
        ["notifications", "Benachrichtigungen zuverlässig öffnen"],
        ["drafts", "Entwürfe bei Klinikwechseln schützen"],
      ].map(([id, title]) => ({
        id, title, kind: "feature", componentKeys: ["website"], pullRequests: [], commitShas: [],
        summary: `Beispielbeschreibung für ${title}.`, visualUrls: [],
      })),
      visuals: [],
    },
  };
}

export function historicalReleaseStoryFixture() {
  const release = releaseStoryFixture();
  delete release.manifest.title;
  const summary = "Website und Clinic Dashboard bündeln die bisherigen Verbesserungen bei Klinikzugängen, Blog-Veröffentlichungen und interner Verwaltung. Überarbeitete Prüfungen erleichtern außerdem die Wartung und machen Fehler bei der Nutzung nachvollziehbar.";
  return { ...release, summary, manifest: { ...release.manifest, summary } };
}
