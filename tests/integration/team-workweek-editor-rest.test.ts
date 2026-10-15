import { execFile } from "node:child_process";
import { resolve } from "node:path";
import { promisify } from "node:util";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { NextRequest } from "next/server";
import { expect, it, vi } from "vitest";

const context = vi.hoisted(() => ({ client: null as SupabaseClient | null }));
vi.mock("@/lib/api-response", () => ({
  apiError: (message: string, status: number) => Response.json({ error: message }, { status }),
  requireApiContext: async () => ({ ok: true, permission: { profile: { id: "workweek-rest-regression-owner" } } }),
  readJsonPayload: vi.fn(),
}));
vi.mock("@/lib/authz", () => ({ bearerToken: () => "test-session", requireTeamMember: Symbol("requireTeamMember") }));
vi.mock("@/lib/supabase-user", () => ({ getSupabaseForToken: () => context.client }));

import { GET } from "../../src/app/api/team-workweek/private-draft/route";

it("loads the private editor through PostgREST when versions have multiple publication relationships", async () => {
  const { stdout } = await promisify(execFile)(resolve("node_modules/.bin/supabase"), ["status", "-o", "json"], { encoding: "utf8" });
  const status = JSON.parse(stdout) as { API_URL: string; SERVICE_ROLE_KEY: string };
  const url = new URL(status.API_URL);
  if (!["localhost", "127.0.0.1"].includes(url.hostname) || url.port !== "54321") {
    throw new Error("This regression requires the local Supabase stack.");
  }
  context.client = createClient(url.toString(), status.SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const response = await GET(new NextRequest("http://localhost:3000/api/team-workweek/private-draft"));
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ immediateAllowed: true });
});
