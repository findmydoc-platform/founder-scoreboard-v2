import { NextRequest } from "next/server";
import { afterEach, expect, it, vi } from "vitest";
import { administratorProtocol } from "../../helpers/administrator-protocol.mjs";
import { importTestModule } from "../../helpers/vitest-module.mjs";
import { platformReleaseSeed } from "@/features/platform-releases/model/platform-release-seed";

const release = platformReleaseSeed[0];
const endpoint = "/api/team/platform-releases/v1/releases";

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.resetModules(); });

async function releaseProtocol({ denied = false } = {}) {
  const protocol = administratorProtocol({ role: "viewer" });
  const authFetch = globalThis.fetch;
  const reads = [];
  vi.stubGlobal("fetch", async (input, init) => {
    const request = new Request(input, init), url = new URL(request.url);
    if (url.pathname === "/rest/v1/platform_releases") {
      reads.push({ table: "platform_releases", params: url.searchParams });
      if (denied) return Response.json({ message: "Denied" }, { status: 403 });
      return Response.json([{ version: release.version, summary: release.summary, published_at: release.publishedAt, manifest_digest: release.manifestDigest, manifest: release.manifest }]);
    }
    if (url.pathname === "/rest/v1/notification_events") {
      reads.push({ table: "notification_events", params: url.searchParams });
      return Response.json([{ id: 17, entity_id: release.version, seen_at: null }]);
    }
    if (["/rest/v1/active_tasks", "/rest/v1/task_links"].includes(url.pathname)) {
      reads.push({ table: "planning", params: url.searchParams });
      return Response.json({ message: "The reference reader is unavailable" }, { status: 503 });
    }
    return authFetch(request);
  });
  const { GET } = await importTestModule("src/app/api/team/platform-releases/v1/releases/route.ts", { "server-only": {} });
  return { read: path => GET(protocol.request(endpoint + path)), reads };
}

it("publishes release content even when the independent Planning reader is unavailable", async () => {
  const { read, reads } = await releaseProtocol();
  const response = await read(`?area=content&version=${release.version}`);
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("no-store");
  const payload = await response.json();
  expect(payload).toMatchObject({ ok: true, releases: [{ version: release.version, manifestDigest: release.manifestDigest, notificationId: 17 }],
    readActor: { profileId: "synthetic-profile", platformRole: "viewer" } });
  expect(payload.releases[0]).not.toHaveProperty("planningReferences");
  expect(reads.map(read => read.table).sort()).toEqual(["notification_events", "platform_releases"]);
  expect(reads.find(read => read.table === "platform_releases").params.get("version")).toBe(`eq.${release.version}`);
  expect(reads.find(read => read.table === "notification_events").params.get("recipient_profile_id")).toBe("eq.synthetic-profile");
});

it("does not publish an empty content list after a denied release read", async () => {
  const { read } = await releaseProtocol({ denied: true });
  const response = await read("?area=content");
  expect(response.status).toBe(403);
  expect(await response.json()).not.toHaveProperty("releases");
});

const referenceQuery = `?area=references&version=${release.version}&manifestDigest=${release.manifestDigest}`;

async function referenceProtocol(readSnapshot) {
  const protocol = administratorProtocol({ role: "viewer" });
  const authFetch = globalThis.fetch;
  const requests = [];
  const dispatches = [];
  let revision = "source-1";
  let rebound = false;
  vi.stubGlobal("fetch", async (input, init) => {
    const request = new Request(input, init), url = new URL(request.url);
    if (url.pathname === "/rest/v1/rpc/platform_release_reference_publication_context") {
      dispatches.push("source");
      return Response.json({ profile_id: rebound ? "other-profile" : "synthetic-profile", platform_role: "viewer", source_revision: revision });
    }
    if (url.pathname === "/rest/v1/rpc/planning_release_reference_snapshot") {
      dispatches.push("snapshot");
      requests.push(await request.json());
      return readSnapshot({
        revision, requests,
        changeSource(value) { revision = value; },
        changeActor() { rebound = true; },
        ready(references) {
          return Response.json({ status: "ready", source_revision: revision,
            releases: [{ version: release.version, manifestDigest: release.manifestDigest, planningReferences: references }] });
        },
      });
    }
    return authFetch(request);
  });
  const { GET } = await importTestModule("src/app/api/team/platform-releases/v1/releases/route.ts", { "server-only": {} });
  return {
    request(query = referenceQuery, signal) {
      const request = protocol.request(endpoint + query);
      return GET(signal ? new NextRequest(request, { signal }) : request);
    },
    requests, dispatches,
  };
}

it("loads the snapshot first and checks its revision once afterwards", async () => {
  const { request, dispatches } = await referenceProtocol(({ ready }) => ready([]));
  const response = await request();
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ planningReferences: [], sourceRevision: "source-1" });
  expect(dispatches).toEqual(["snapshot", "source"]);
});

it("confirms a manifest conflict between two equal live observations", async () => {
  const { request, requests, dispatches } = await referenceProtocol(() => Response.json({ status: "stale" }));
  const response = await request();
  expect(response.status).toBe(409);
  expect(await response.json()).toMatchObject({ code: "stale_manifest" });
  expect(dispatches).toEqual(["snapshot", "source", "snapshot", "source"]);
  expect(requests[0].p_deadline).toBe(requests[1].p_deadline);
});

it("cannot report stale manifest after a source shift, and can instead publish a current retry", async () => {
  const { request, requests, dispatches } = await referenceProtocol(({ ready, changeSource, requests }) => {
    if (requests.length === 1) return Response.json({ status: "stale" });
    if (requests.length === 2) {
      changeSource("source-2");
      return Response.json({ status: "stale" });
    }
    return ready([]);
  });
  const response = await request();
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ planningReferences: [], sourceRevision: "source-2" });
  expect(dispatches).toEqual(["snapshot", "source", "snapshot", "source", "snapshot", "source"]);
  expect(new Set(requests.map(item => item.p_deadline)).size).toBe(1);
});

it("leaves a continuously shifting manifest unavailable after three snapshots", async () => {
  const { request, dispatches } = await referenceProtocol(({ requests, changeSource }) => {
    changeSource(`next-${requests.length}`);
    return Response.json({ status: "stale" });
  });
  const response = await request();
  expect(response.status).toBe(503);
  expect(await response.json()).not.toHaveProperty("planningReferences");
  expect(dispatches).toEqual(["snapshot", "source", "snapshot", "source", "snapshot", "source"]);
});

it("rejects a snapshot whose original deadline expired before publication", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  const { request, dispatches } = await referenceProtocol(({ requests, ready }) => {
    vi.setSystemTime(new Date(requests[0].p_deadline));
    return ready([]);
  });
  const response = await request();
  expect(response.status).toBe(403);
  expect(await response.json()).not.toHaveProperty("planningReferences");
  expect(dispatches).toEqual(["snapshot"]);
});

it("does not start the snapshot for a request that is already aborted", async () => {
  const controller = new AbortController();
  const { request, dispatches } = await referenceProtocol(({ ready }) => ready([]));
  controller.abort();
  const response = await request(referenceQuery, controller.signal);
  expect(response.status).toBe(503);
  expect(dispatches).toEqual([]);
});

it("publishes a complete separate reference receipt only once its authorized source is still current", async () => {
  const { request, requests } = await referenceProtocol(({ ready, changeSource, requests }) => {
    if (requests.length === 1) { const old = ready([{ repository: "example/repo", pullRequestNumber: 1, taskLinks: [] }]); changeSource("source-2"); return old; }
    return ready([]);
  });
  const response = await request();
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ ok: true, version: release.version, manifestDigest: release.manifestDigest,
    sourceRevision: "source-2", planningReferences: [], readActor: { profileId: "synthetic-profile", platformRole: "viewer" } });
  expect(requests).toHaveLength(2);
  expect(requests[0]).toMatchObject({ p_release_keys: [{ version: release.version, manifestDigest: release.manifestDigest }], p_profile_id: "synthetic-profile" });
});

it("does not publish an apparently empty result after a reference failure", async () => {
  const { request } = await referenceProtocol(() => Response.json({ status: "unavailable" }));
  const response = await request();
  expect(response.status).toBe(503);
  expect(await response.json()).not.toHaveProperty("planningReferences");
});

it("withholds a ready reference receipt when its live actor has rebound", async () => {
  const { request } = await referenceProtocol(({ ready, changeActor }) => {
    changeActor();
    return ready([]);
  });
  const response = await request();
  expect(response.status).toBe(403);
  expect(await response.json()).not.toHaveProperty("planningReferences");
});

it("observes only the reference revision with its live actor receipt", async () => {
  const { request, requests } = await referenceProtocol(() => { throw new Error("Source observation must not read content"); });
  const response = await request("?area=reference-source");
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ ok: true, sourceRevision: "source-1",
    readActor: { profileId: "synthetic-profile", platformRole: "viewer" } });
  expect(requests).toEqual([]);
});
