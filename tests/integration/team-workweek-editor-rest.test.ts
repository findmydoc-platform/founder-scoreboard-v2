import { execFile } from "node:child_process";
import { resolve } from "node:path";
import { promisify } from "node:util";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { NextRequest } from "next/server";
import { expect, it, vi } from "vitest";

const context = vi.hoisted(() => ({ client: null as SupabaseClient | null, service: null as SupabaseClient | null, owner: "workweek-rest-regression-owner" }));
vi.mock("@/lib/api-response", () => ({
  apiError: (message: string, status: number) => Response.json({ error: message }, { status }),
  requireApiContext: async () => ({ ok: true, permission: { profile: { id: context.owner } } }),
  readJsonPayload: vi.fn(),
}));
vi.mock("@/lib/authz", () => ({ bearerToken: () => "test-session", requireTeamMember: Symbol("requireTeamMember") }));
vi.mock("@/lib/supabase-user", () => ({ getSupabaseForToken: () => context.client }));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase-service-role", () => ({ getServerServiceRoleSupabase: () => context.service }));

import { GET } from "../../src/app/api/team-workweek/private-draft/route";

it("loads the private editor through PostgREST when versions have multiple publication relationships", async () => {
  const { stdout } = await promisify(execFile)(resolve("node_modules/.bin/supabase"), ["status", "-o", "json"], { encoding: "utf8" });
  const status = JSON.parse(stdout) as { API_URL: string; SERVICE_ROLE_KEY: string };
  const url = new URL(status.API_URL);
  if (!["localhost", "127.0.0.1"].includes(url.hostname)) {
    throw new Error("This regression requires the local Supabase stack.");
  }
  context.client = createClient(url.toString(), status.SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  // Authentication is outside this query regression; relationship resolution uses real PostgREST.
  vi.spyOn(context.client, "rpc").mockResolvedValue({ data: null, error: null, count: null, status: 200, statusText: "OK" } as never);
  const response = await GET(new NextRequest("http://localhost:3000/api/team-workweek/private-draft"));
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ immediateAllowed: true });
});


it("reopens an owner draft without granting users access to server-only Google conflicts", async () => {
  const { stdout } = await promisify(execFile)(resolve("node_modules/.bin/supabase"), ["status", "-o", "json"], { encoding: "utf8" });
  const status = JSON.parse(stdout) as { API_URL: string; SERVICE_ROLE_KEY: string; ANON_KEY: string };
  if (!["localhost", "127.0.0.1"].includes(new URL(status.API_URL).hostname)) throw new Error("Local database required.");
  const options = { auth: { persistSession: false, autoRefreshToken: false } };
  const service = createClient(status.API_URL, status.SERVICE_ROLE_KEY, options);
  const email = `workweek-load-${crypto.randomUUID()}@example.test`;
  const password = crypto.randomUUID();
  const created = await service.auth.admin.createUser({ email, password, email_confirm: true });
  expect(created.error).toBeNull();
  const userId = created.data.user!.id;
  const owner = `load-${userId}`;
  const user = createClient(status.API_URL, status.ANON_KEY, options);
  try {
    expect((await service.from("profiles").insert({ id: owner, auth_user_id: userId, name: "Draft owner", platform_role: "founder" })).error).toBeNull();
    expect((await user.auth.signInWithPassword({ email, password })).error).toBeNull();
    const { workweekStart } = await import("../../src/features/team-workweek/model/team-workweek-week");
    const week = workweekStart();
    const edit = await user.rpc("team_workweek_edit_context", { p_week_start: week });
    expect(edit.error).toBeNull();
    const draft = await user.rpc("create_private_selected_team_workweek_version", {
      p_week_start: week, p_context_token: edit.data.contextToken,
      p_windows: [{ weekday: 1, startMinute: 540, endMinute: 960 }],
    });
    expect(draft.error).toBeNull();
    // Reproduce the production role boundary through the actual Data API.
    expect((await user.from("team_workweek_google_conflicts").select("id")).error?.code).toBe("42501");
    context.client = user;
    context.service = service;
    context.owner = owner;
    const response = await GET(new NextRequest(`http://localhost:3000/api/team-workweek/private-draft?week=${week}`));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ version: { id: draft.data.id, windows: { monday: [{ start: "09:00", end: "16:00" }] } } });
    expect((await user.from("team_workweek_google_conflicts").select("id")).error?.code).toBe("42501");
  } finally {
    await service.from("team_workweek_versions").delete().eq("owner_profile_id", owner);
    await service.from("profiles").delete().eq("id", owner);
    await service.auth.admin.deleteUser(userId);
    context.owner = "workweek-rest-regression-owner";
    context.client = null;
    context.service = null;
  }
});
