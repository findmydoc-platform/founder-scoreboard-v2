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

test("Manifest v2 validation and digest follow the release-runner contract", () => {
  const manifest = fixture();
  assert.equal(manifestContract.validatePlatformReleaseManifest(manifest).ok, true);
  const reordered = { ...manifest, summary: manifest.summary, schemaVersion: 2 };
  assert.equal(manifestContract.canonicalPlatformReleaseManifest(reordered), manifestContract.canonicalPlatformReleaseManifest(manifest));
  assert.equal(manifestContract.validatePlatformReleaseManifest({ ...manifest, highlights: ["missing"] }).ok, false);
  assert.equal(manifestContract.validatePlatformReleaseManifest({ ...manifest, components: manifest.components.map((component) => ({ ...component, release: { url: component.release } })) }).ok, false);
  assert.equal(manifestContract.platformReleaseReferenceUrl({ url: manifest.components[0].release }), manifest.components[0].release);
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

test("Migration keeps immutable release provenance and personal notifications atomic", async () => {
  const migration = await readFile("supabase/migrations/20260814101401_platform_releases.sql", "utf8");
  const databaseSecurityContracts = await readFile("scripts/lib/database-security/contracts.mjs", "utf8");
  assert.match(migration, /create table if not exists public\.platform_releases/);
  assert.match(migration, /manifest_digest text not null unique/);
  assert.match(migration, /create or replace function public\.ingest_platform_release_v1/);
  assert.match(migration, /insert into public\.notification_events/);
  assert.match(migration, /'platform_release\.published'/);
  assert.match(migration, /grant execute on function public\.ingest_platform_release_v1\(jsonb\) to service_role/);
  assert.doesNotMatch(migration, /grant execute on function public\.ingest_platform_release_v1\(jsonb\) to authenticated/);
  assert.match(databaseSecurityContracts, /\["platform_releases_select_team", "platform_releases"\]/);
});

test("Ingest endpoint enforces bearer auth, idempotency and exact digest verification", async () => {
  const route = await readFile("src/app/api/team/platform-releases/v1/releases/route.ts", "utf8");
  assert.match(route, /FOUNDEROPS_PLATFORM_RELEASE_TOKEN/);
  assert.match(route, /timingSafeEqual/);
  assert.match(route, /idempotency-key/);
  assert.match(route, /canonicalPlatformReleaseManifest/);
  assert.match(route, /replayed \? 200 : 201/);
});
