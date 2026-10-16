import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { NextRequest } from "next/server";
import { beforeEach, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ client: null as SupabaseClient | null, profileId: "owner", authenticated: true }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/api-response", () => ({
  apiError: (error: string, status: number) => Response.json({ error }, { status }),
  requireApiContext: async () => state.authenticated
    ? { ok: true, permission: { profile: state.profileId ? { id: state.profileId } : null } }
    : { ok: false, response: Response.json({ error: "Anmeldung erforderlich." }, { status: 401 }) },
}));
vi.mock("@/lib/authz", () => ({ requireTeamMember: Symbol("requireTeamMember") }));
vi.mock("@/lib/supabase-service-role", () => ({ getServerServiceRoleSupabase: () => state.client }));
import { GET } from "../../../src/app/api/google-workspace/status/route";

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
  state.client = createClient("https://database.example.test", "local-test-service-key", {
    auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: request },
  });
  return request;
}

beforeEach(() => { state.profileId = "owner"; state.authenticated = true; state.client = null; });

it.each([
  { owner: "owner", status: "cleanup_pending", expected: true },
  { owner: "other-owner", status: "cleanup_pending", expected: false },
  { owner: "owner", status: "completed", expected: false },
])("reports pending cleanup only for the mapped owner's unfinished operation: $owner / $status", async ({ owner, status, expected }) => {
  database([{ id: "operation", owner_profile_id: owner, state: status }]);
  const response = await GET(new NextRequest("http://localhost:3000/api/google-workspace/status?owner_profile_id=other-owner"));
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ disconnectPending: expected, connection: { state: "not_connected" } });
});

it("does not turn an unavailable cleanup lookup into a successful idle status", async () => {
  database([], true);
  const response = await GET(new NextRequest("http://localhost:3000/api/google-workspace/status"));
  expect(response.status).toBe(503);
  expect(await response.json()).toEqual({ error: "Google-Verbindungsstatus ist nicht verfügbar." });
});

it.each(["unauthenticated", "unmapped"])("rejects %s sessions before reading server-only cleanup data", async kind => {
  const requests = database([]);
  if (kind === "unauthenticated") state.authenticated = false;
  else state.profileId = "";
  const response = await GET(new NextRequest("http://localhost:3000/api/google-workspace/status"));
  expect(response.status).toBe(kind === "unauthenticated" ? 401 : 403);
  expect(requests).not.toHaveBeenCalled();
});
