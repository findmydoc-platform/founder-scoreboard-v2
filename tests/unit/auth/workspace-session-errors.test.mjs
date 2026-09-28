import { afterEach, expect, test, vi } from "vitest";
import { importTestModule } from "../../helpers/vitest-module.mjs";

const token = `header.${Buffer.from(JSON.stringify({ session_id: "session-1", amr: [{ method: "oauth" }] })).toString("base64url")}.signature`;
const originalFetch = globalThis.fetch;
const originalUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const originalKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalUrl === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  else process.env.NEXT_PUBLIC_SUPABASE_URL = originalUrl;
  if (originalKey === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  else process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = originalKey;
  vi.restoreAllMocks();
});

async function fixture({ mode = "linking", getUser, context, session } = {}) {
  const service = {
    auth: { getUser: getUser || vi.fn().mockResolvedValue({ data: { user: { id: "user-1" } }, error: null }) },
    rpc: vi.fn(async name => {
      if (name === "workspace_access_context") return context || { data: { mode, linkingEnforced: true }, error: null };
      return session || { data: true, error: null };
    }),
  };
  const access = await importTestModule("src/lib/workspace-access.ts", {
    "server-only": {},
    "./supabase-service-role": { getServerServiceRoleSupabase: () => service },
    "./workspace-directory": { isWorkspaceGroupMember: vi.fn() },
  });
  return { access, service };
}

test.each([
  ["Auth transport", { getUser: vi.fn().mockRejectedValue(new Error("network down")) }],
  ["context RPC", { context: { data: null, error: new Error("database down") } }],
  ["session RPC", { session: { data: null, error: new Error("database down") } }],
])("%s failures remain unavailable rather than requesting another login", async (_label, options) => {
  const { access } = await fixture(options);
  await expect(access.assertGoogleSession(token, "user-1")).rejects.toMatchObject({ status: 503, code: "workspace_access_unavailable" });
});

test("provider settings failure remains unavailable", async () => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://database.example";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "test-key";
  globalThis.fetch = vi.fn().mockRejectedValue(new Error("settings unavailable"));
  const { access } = await fixture({ mode: "google" });
  await expect(access.assertGoogleSession(token, "user-1")).rejects.toMatchObject({ status: 503, code: "workspace_access_unavailable" });
});

test.each([
  ["wrong owner", { getUser: vi.fn().mockResolvedValue({ data: { user: { id: "other-user" } }, error: null }) }],
  ["unapproved session", { session: { data: false, error: null } }],
])("%s still requires a new Google login", async (_label, options) => {
  const { access } = await fixture(options);
  await expect(access.assertGoogleSession(token, "user-1")).rejects.toMatchObject({ status: 403, code: "workspace_google_login_required" });
});

test("a valid approved session remains usable", async () => {
  const { access } = await fixture();
  await expect(access.assertGoogleSession(token, "user-1")).resolves.toBe("session-1");
});
