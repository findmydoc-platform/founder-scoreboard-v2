import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { administratorProtocol } from "../../helpers/administrator-protocol.mjs";
vi.mock("server-only", () => ({}));
import { GET } from "../../../src/app/api/google-workspace/status/route";
let protocol: ReturnType<typeof administratorProtocol>;
const state = { profileId: "owner", authenticated: true };
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
function database(rows: Array<{ id: string; owner_profile_id: string; state: string }>, failed = false) {
  const request = vi.fn(async (input: RequestInfo | URL) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith("/google_workspace_connections")) return Response.json(null);
    if (!url.pathname.endsWith("/google_workspace_disconnect_operations")) throw new Error("Unexpected database request");
    if (failed) return Response.json({ code: "XX000", message: "Unavailable" }, { status: 500 });
    // Honor actual PostgREST filters, so removing either owner or state filtering changes the response.
    const owner = url.searchParams.get("owner_profile_id");
    const excludedState = url.searchParams.get("state");
    const visible = rows.filter(row => (!owner || owner === `eq.${row.owner_profile_id}`)
      && (!excludedState || excludedState !== `neq.${row.state}`));
    return Response.json(visible.slice(0, Number(url.searchParams.get("limit") || rows.length)).map(({ id }) => ({ id })));
  });
  const authFetch = globalThis.fetch;
  vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) => { const operation = new Request(input, init); return new URL(operation.url).pathname.includes("/rpc/") || new URL(operation.url).pathname.startsWith("/auth/") ? authFetch(operation) : request(operation.url); });
  return request;
}

beforeEach(() => { state.profileId = "owner"; state.authenticated = true; protocol = administratorProtocol({ profileId: "owner" }); });

it.each([
  { owner: "owner", status: "cleanup_pending", expected: true },
  { owner: "other-owner", status: "cleanup_pending", expected: false },
  { owner: "owner", status: "completed", expected: false },
])("reports pending cleanup only for the mapped owner's unfinished operation: $owner / $status", async ({ owner, status, expected }) => {
  database([{ id: "operation", owner_profile_id: owner, state: status }]);
  const response = await GET(protocol.request("/api/google-workspace/status?owner_profile_id=other-owner"));
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ disconnectPending: expected, connection: { state: "not_connected" } });
});

it("does not turn an unavailable cleanup lookup into a successful idle status", async () => {
  database([], true);
  const response = await GET(protocol.request("/api/google-workspace/status"));
  expect(response.status).toBe(503);
  expect(await response.json()).toEqual({ error: "Google-Verbindungsstatus ist nicht verfügbar." });
});

it.each(["unauthenticated", "unmapped"])("rejects %s sessions before reading server-only cleanup data", async kind => {
  const requests = database([]);
  if (kind === "unmapped") protocol.state.profile = false;
  const response = await GET(protocol.request("/api/google-workspace/status", "GET", undefined, kind === "unauthenticated" ? { authorization: "Bearer unrelated" } : {}));
  expect(response.status).toBe(kind === "unauthenticated" ? 401 : 403);
  expect(requests).not.toHaveBeenCalled();
});
