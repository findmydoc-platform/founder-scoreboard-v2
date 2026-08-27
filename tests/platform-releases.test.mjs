import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { loadTranspiledModule } from "./helpers/transpile-module.mjs";

const manifestContract = await loadTranspiledModule("src/features/platform-releases/model/platform-release-manifest.ts");
const notificationCatalog = await loadTranspiledModule("src/lib/notification-catalog.ts");
const notificationTarget = await loadTranspiledModule("src/features/notifications/model/notification-target.ts");
const taskDetailReturnNavigation = await loadTranspiledModule("src/features/tasks/model/task-detail-return-navigation.ts");

function fixture() {
  const manifest = {
    schemaVersion: 2,
    version: "v1.2.3",
    summary: "Patient:innen finden schneller passende Termine.",
    highlights: ["search"],
    changes: [{ id: "search", kind: "feature", pullRequests: [{ repository: "findmydoc-platform/website", number: 42 }], section: "public", summary: "Die Suche ist klarer.", title: "Klarere Suche", visualUrls: [] }],
    components: [{
      key: "website",
      displayName: "Website",
      productionUrl: "https://findmydoc.eu",
      repository: "findmydoc-platform/website",
      targetSha: "a1b2c3d",
      release: "https://github.com/findmydoc-platform/website/releases/tag/v1.2.3",
      deploymentRun: "https://github.com/findmydoc-platform/website/actions/runs/1",
      commits: [{ bump: "minor", message: "feat: search", sha: "a1b2c3d", url: "https://github.com/findmydoc-platform/website/commit/a1b2c3d" }],
      pullRequests: [{ number: 42, repository: "findmydoc-platform/website", title: "feat: search", url: "https://github.com/findmydoc-platform/website/pull/42", commitShas: ["a1b2c3d"], issues: [] }],
    }, {
      key: "dashboard",
      displayName: "Clinic Dashboard",
      productionUrl: "https://clinic.findmydoc.eu",
      repository: "findmydoc-platform/clinic-dashboard",
      targetSha: "d4e5f6a",
      release: "https://github.com/findmydoc-platform/clinic-dashboard/releases/tag/v1.2.3",
      deploymentRun: "https://github.com/findmydoc-platform/clinic-dashboard/actions/runs/2",
      commits: [],
      pullRequests: [],
    }],
    visuals: [],
    planDigest: "1".repeat(64),
    contentDigest: "2".repeat(64),
    publishedAt: "2026-08-14T10:00:00.000Z",
    manifestDigest: "0".repeat(64),
  };
  manifest.manifestDigest = createHash("sha256").update(manifestContract.canonicalPlatformReleaseManifest(manifest)).digest("hex");
  return manifest;
}

function applicationFixture() {
  const v2 = fixture();
  const targetSha = "a".repeat(40);
  const manifest = {
    schemaVersion: 3,
    releaseMode: "application",
    notificationMode: "silent",
    source: { kind: "github-release-import", importedAt: "2026-08-17T10:00:00.000Z" },
    version: "v0.45.0",
    summary: "Die Website bündelt die bis dahin veröffentlichten Verbesserungen.",
    highlights: ["website-release"],
    changes: [{
      id: "website-release",
      kind: "feature",
      componentKeys: ["website"],
      pullRequests: [{ repository: "findmydoc-platform/website", number: 42 }],
      commitShas: [],
      summary: "Die Website wurde mit mehreren Verbesserungen veröffentlicht.",
      title: "Verbesserte Website",
      visualUrls: [],
    }],
    components: [{
      ...v2.components[0],
      targetSha,
      release: "https://github.com/findmydoc-platform/website/releases/tag/v0.45.0",
      deploymentRun: null,
      commits: [{ ...v2.components[0].commits[0], sha: targetSha, url: `https://github.com/findmydoc-platform/website/commit/${targetSha}` }],
      pullRequests: [{ ...v2.components[0].pullRequests[0], commitShas: [targetSha] }],
    }],
    visuals: [],
    planDigest: "3".repeat(64),
    contentDigest: "4".repeat(64),
    publishedAt: "2026-08-01T10:00:00.000Z",
    manifestDigest: "0".repeat(64),
  };
  manifest.manifestDigest = createHash("sha256").update(manifestContract.canonicalPlatformReleaseManifest(manifest)).digest("hex");
  return manifest;
}

test("Manifest v2 validation and digest follow the release-runner contract", () => {
  const manifest = fixture();
  assert.equal(manifestContract.validatePlatformReleaseManifest(manifest).ok, true);
  const reordered = { ...manifest, summary: manifest.summary, schemaVersion: 2 };
  assert.equal(manifestContract.canonicalPlatformReleaseManifest(reordered), manifestContract.canonicalPlatformReleaseManifest(manifest));
  assert.equal(manifestContract.validatePlatformReleaseManifest({ ...manifest, highlights: ["missing"] }).ok, false);
  assert.equal(manifestContract.validatePlatformReleaseManifest({ ...manifest, components: manifest.components.map((component) => ({ ...component, release: { url: component.release } })) }).ok, false);
  assert.equal(manifestContract.platformReleaseReferenceUrl({ url: manifest.components[0].release }), manifest.components[0].release);
});

test("Manifest v3 supports registered application releases and optional deployment evidence", () => {
  const manifest = applicationFixture();
  assert.equal(manifestContract.validatePlatformReleaseManifest(manifest).ok, true);
  assert.equal(manifestContract.validatePlatformReleaseManifest({ ...manifest, releaseMode: "platform" }).ok, false);
  assert.equal(manifestContract.validatePlatformReleaseManifest({ ...manifest, components: [{ ...manifest.components[0], repository: "other/repository" }] }).ok, false);
  assert.equal(manifestContract.validatePlatformReleaseManifest({ ...manifest, components: [{ ...manifest.components[0], release: "https://example.com/releases/v0.45.0" }] }).ok, false);
  assert.equal(manifestContract.validatePlatformReleaseManifest({ ...manifest, notificationMode: "other" }).ok, false);
  assert.equal(manifestContract.validatePlatformReleaseManifest({ ...manifest, notificationMode: "standard" }).ok, false);
  assert.equal(manifestContract.validatePlatformReleaseManifest({ ...manifest, components: [{ ...manifest.components[0], release: "https://github.com/findmydoc-platform/website/releases/tag/v0.44.0" }] }).ok, false);
  assert.equal(manifestContract.validatePlatformReleaseManifest({ ...manifest, components: [{ ...manifest.components[0], pullRequests: [{ ...manifest.components[0].pullRequests[0], url: "https://github.com/findmydoc-platform/website/pull/99" }] }] }).ok, false);
  assert.equal(manifestContract.validatePlatformReleaseManifest({ ...manifest, components: [{ ...manifest.components[0], commits: [{ ...manifest.components[0].commits[0], url: `https://github.com/findmydoc-platform/website/commit/${"b".repeat(40)}` }] }] }).ok, false);
  assert.equal(manifestContract.validatePlatformReleaseManifest({ ...manifest, changes: [{ ...manifest.changes[0], componentKeys: ["dashboard"] }] }).ok, false);
});

test("Manifest v3 binds change provenance to the declared components", () => {
  const application = applicationFixture();
  const dashboardSha = "b".repeat(40);
  const dashboardPullRequest = {
    commitShas: [dashboardSha], issues: [], number: 77, repository: "findmydoc-platform/clinic-dashboard",
    title: "feat: dashboard", url: "https://github.com/findmydoc-platform/clinic-dashboard/pull/77",
  };
  const platform = {
    ...application,
    releaseMode: "platform",
    notificationMode: "standard",
    source: { kind: "native" },
    components: [...application.components, {
      key: "dashboard", displayName: "Clinic Dashboard", productionUrl: "https://clinics.findmydoc.eu",
      repository: "findmydoc-platform/clinic-dashboard", targetSha: dashboardSha,
      release: "https://github.com/findmydoc-platform/clinic-dashboard/releases/tag/v0.45.0",
      deploymentRun: "https://github.com/findmydoc-platform/clinic-dashboard/actions/runs/77",
      commits: [{ bump: "minor", message: "feat: dashboard", sha: dashboardSha, url: `https://github.com/findmydoc-platform/clinic-dashboard/commit/${dashboardSha}` }],
      pullRequests: [dashboardPullRequest],
    }],
  };
  assert.equal(manifestContract.validatePlatformReleaseManifest(platform).ok, true);
  assert.equal(manifestContract.validatePlatformReleaseManifest({
    ...platform,
    changes: [{ ...platform.changes[0], pullRequests: [{ repository: dashboardPullRequest.repository, number: dashboardPullRequest.number }] }],
  }).ok, false);
});

test("Silent application releases are already seen without a notification row", () => {
  const manifest = applicationFixture();
  assert.deepEqual(manifestContract.platformReleaseNotificationState(manifest, manifest.publishedAt), {
    notificationId: null,
    seenAt: manifest.publishedAt,
  });
  assert.deepEqual(manifestContract.platformReleaseNotificationState(manifest, manifest.publishedAt, { id: 7, seen_at: null }), {
    notificationId: 7,
    seenAt: manifest.publishedAt,
  });
});

test("Platform Release notifications remain personal and in-app only", () => {
  assert.equal(notificationCatalog.notificationDefinition("platform_release.published").lifecycle, "informational");
  assert.equal(notificationCatalog.shouldSendToGoogleChatDigest("platform_release.published"), false);
  assert.equal(notificationCatalog.shouldSendToGoogleChatDm("platform_release.published"), false);
  assert.deepEqual(notificationTarget.notificationTarget({ entityType: "platform_release", entityId: "v1.2.3" }), {
    workspace: "notifications",
    href: "/team/platform-releases/v1.2.3",
  });
});

test("Platform Release notifications navigate to the release detail after marking seen", async () => {
  const commands = await readFile("src/features/planning/hooks/use-notification-commands.ts", "utf8");
  assert.match(commands, /target\.href !== workspacePath\(target\.workspace\)/);
  assert.match(commands, /navigateAfterNotificationStatusUpdate/);
  assert.match(commands, /router\.push\(target\.href\)/);
  const detail = await readFile("src/features/platform-releases/organisms/platform-release-detail.tsx", "utf8");
  assert.match(detail, /release\.seenAt \|\| !release\.notificationId/);
});

test("Platform Release planning links preserve a safe return to the release detail", async () => {
  const releasePath = "/team/platform-releases/v1.2.3";
  assert.equal(
    taskDetailReturnNavigation.taskDetailHrefWithReturnTo("/tasks/release-task", releasePath),
    "/tasks/release-task?returnTo=%2Fteam%2Fplatform-releases%2Fv1.2.3",
  );
  assert.equal(taskDetailReturnNavigation.safeTaskDetailReturnTo(releasePath), releasePath);
  assert.equal(taskDetailReturnNavigation.safeTaskDetailReturnTo("/planning"), null);
  assert.equal(taskDetailReturnNavigation.safeTaskDetailReturnTo("https://example.com/team/platform-releases/v1.2.3"), null);

  const detail = await readFile("src/features/platform-releases/organisms/platform-release-detail.tsx", "utf8");
  const taskPage = await readFile("src/features/tasks/templates/task-detail-page.tsx", "utf8");
  assert.match(detail, /taskDetailHrefWithReturnTo/);
  assert.match(taskPage, /window\.location\.assign\(returnHref\)/);
  assert.match(taskPage, /backLabel=\{returnLabel\}/);
});





test("Ingest endpoint enforces bearer auth, idempotency and exact digest verification", async () => {
  const route = await readFile("src/app/api/team/platform-releases/v1/releases/route.ts", "utf8");
  assert.match(route, /FOUNDEROPS_PLATFORM_RELEASE_TOKEN/);
  assert.match(route, /timingSafeEqual/);
  assert.match(route, /idempotency-key/);
  assert.match(route, /canonicalPlatformReleaseManifest/);
  assert.match(route, /replayed \? 200 : 201/);
});
