import { afterEach, expect, test, vi } from "vitest";
import { administratorProtocol } from "../../helpers/administrator-protocol.mjs";
import { importTestModule } from "../../helpers/vitest-module.mjs";
import { platformReleaseSeed } from "@/features/platform-releases/model/platform-release-seed";

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.resetModules(); });

test.each([
  { detail: true, path: "src/app/team/platform-releases/[version]/page.tsx" },
  { detail: false, path: "src/app/team/platform-releases/page.tsx" },
])("the Release SSR entry has usable content without observing Planning matching ($path)", async ({ detail, path }) => {
  const release = platformReleaseSeed[0];
  const protocol = administratorProtocol({ role: "viewer" });
  const authFetch = globalThis.fetch;
  const queries = [];
  const matching = [];
  vi.stubGlobal("fetch", async (input, init) => {
    const request = new Request(input, init), url = new URL(request.url);
    if (!url.pathname.startsWith("/rest/v1/") || url.pathname.startsWith("/rest/v1/rpc/")) return authFetch(request);
    const table = url.pathname.split("/").at(-1);
    if (table === "platform_releases") {
      queries.push(url.searchParams);
      const row = { version: release.version, summary: release.summary, published_at: release.publishedAt, manifest_digest: release.manifestDigest, manifest: release.manifest };
      return Response.json(request.headers.get("accept")?.includes("pgrst.object") ? row : [row]);
    }
    if (["active_tasks", "tasks", "task_links"].includes(table)) {
      matching.push(table);
      return Response.json({ message: "Planning matches unavailable" }, { status: 400 });
    }
    if (["notification_events", "profiles", "fmd_tools", "founder_events"].includes(table)) return Response.json([], { headers: { "content-range": "*/0" } });
    return authFetch(request);
  });
  const page = await importTestModule(path, {
    "server-only": {}, "next/headers": { cookies: async () => protocol.cookieJar(), headers: async () => new Headers() },
    "next/cache": { unstable_cache: load => load },
    "next/navigation": { notFound: () => { throw new Error("Unexpected not found"); }, redirect: () => {} },
    "@/features/planning/PlanningApp": { PlanningApp: () => null },
    "@/features/platform-releases/templates/platform-releases-shell": { PlatformReleasesShell: () => null },
    "@/features/platform-releases/organisms/platform-release-archive": { PlatformReleaseArchive: () => null },
    "@/features/platform-releases/organisms/platform-release-detail": { PlatformReleaseDetail: () => null },
    "@/features/platform-releases/organisms/platform-release-owned-detail": { PlatformReleaseOwnedDetail: () => null },
  });
  const result = await page.default({ params: Promise.resolve({ version: release.version }), searchParams: Promise.resolve({ technical: "open" }) });
  const child = result.props.children;
  const content = detail ? child.props.release : child.props.releases[0];
  expect(content).toMatchObject({ version: release.version, summary: release.summary });
  expect(content).not.toHaveProperty("planningReferences");
  expect(matching).toEqual([]);
  expect(queries).toHaveLength(1);
  if (detail) {
    expect(queries[0].get("version")).toBe("eq." + release.version);
    expect(child.props.technicalInitiallyOpen).toBe(true);
  }
});

const documentHeaders = { "sec-fetch-dest": "document", "sec-fetch-mode": "navigate" };

test.each([
  { name: "document", headers: documentHeaders, stream: true },
  { name: "prefetch", headers: { ...documentHeaders, "next-router-prefetch": "1" } },
  { name: "segment prefetch", headers: { ...documentHeaders, "next-router-segment-prefetch": "/release" } },
  { name: "prerender", headers: { ...documentHeaders, "sec-purpose": "prefetch;prerender" } },
  { name: "RSC", headers: { ...documentHeaders, rsc: "1" } },
  { name: "ambiguous", headers: {} },
  { name: "replaced session", headers: documentHeaders, replaced: true },
])("release detail starts independent server references only on an admitted $name", async ({ headers, stream, replaced }) => {
  const release = platformReleaseSeed[0];
  const { planningReferences, ...content } = release;
  const profile = { id: "profile", platformRole: "viewer" };
  const user = { id: "user" };
  const session = { userId: user.id, user, revision: "session", expiresAt: Math.floor(Date.now() / 1_000) + 60 };
  const readAuthority = { userId: user.id, deadline: Date.now() + 20_000 };
  const readActor = { profileId: profile.id, platformRole: profile.platformRole };
  let releaseReferences;
  const readReleaseReferences = vi.fn(() => new Promise(resolve => { releaseReferences = resolve; }));
  const page = await importTestModule("src/app/team/platform-releases/[version]/page.tsx", {
    "server-only": {}, "next/headers": { headers: async () => new Headers(headers) }, "next/server": { after: vi.fn() },
    "next/navigation": { notFound: () => { throw new Error("Unexpected not found"); } },
    "@/lib/supabase-configuration": { requiresSupabaseAuth: () => true },
    "@/lib/credentials": { authorizeCredentialAction: async ({ action }) => action === "session.planning"
      ? { ok: true, user, profile, session }
      : { ok: true, profile, readSession: replaced ? { ...session, revision: "replacement" } : session, readAuthority, account: {
        readReleaseContent: async () => ({ status: "ready", releases: [content], readActor, readAuthority }),
        loadReleaseHeader: async () => ({ headerData: {}, calendarProfiles: null }), readReleaseReferences,
      } } },
    "@/features/planning/PlanningApp": { PlanningApp: () => null },
    "@/features/platform-releases/templates/platform-releases-shell": { PlatformReleasesShell: () => null },
    "@/features/platform-releases/organisms/platform-release-owned-detail": { PlatformReleaseOwnedDetail: () => null },
  });
  const shell = await page.default({ params: Promise.resolve({ version: release.version }), searchParams: Promise.resolve({}) });
  if (!stream) {
    expect(readReleaseReferences).not.toHaveBeenCalled();
    expect(shell.props.initialReleaseReferenceEntry).toBeUndefined();
    return;
  }
  expect(readReleaseReferences).toHaveBeenCalledExactlyOnceWith({ version: release.version, manifestDigest: release.manifestDigest, signal: expect.any(AbortSignal) });
  const descriptor = shell.props.initialReleaseReferenceEntry;
  expect(descriptor).toMatchObject({ key: { version: release.version, manifestDigest: release.manifestDigest }, session, readActor, readAuthority });
  expect(descriptor.timeoutAt).toBeLessThanOrEqual(readAuthority.deadline);
  const entry = shell.props.children;
  const supplemental = entry.props.children;
  expect(entry.props.release).toMatchObject({ summary: release.summary });
  const relay = supplemental.type(supplemental.props);
  expect(relay.type.name).toBe("PlatformReleaseServerReferenceReceipt");
  expect(relay.props).toMatchObject({ id: descriptor.id, result: expect.any(Promise) });
  releaseReferences({ status: "ready", version: release.version, manifestDigest: release.manifestDigest, sourceRevision: "source", planningReferences, readAuthority, readActor });
  expect(await relay.props.result).toMatchObject({ status: "ready", receipt: { planningReferences, sourceRevision: "source" } });
});
