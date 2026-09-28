import { test, expect, vi } from "vitest";
import { importTestModule } from "../../helpers/vitest-module.mjs";

for (const mode of ["legacy", "linking", "google"]) {
  test(`login uses the authorized provider in ${mode} mode`, async () => {
    let options;
    const route = await importTestModule("src/app/auth/login/route.ts", {
      "@/lib/workspace-access": { workspaceAccessContext: async () => ({ mode }) },
      "@/lib/auth-redirect": { authOrigin: () => "https://founder-ops.findmydoc.eu", safeRelativeNext: () => "/planning" },
      "@/lib/supabase-server": { getServerAuthSupabase: async () => ({ auth: { signInWithOAuth: async input => { options = input; return { data: { url: "https://accounts.google.com/authorize" }, error: null }; } } }) },
    });
    const url = "https://founder-ops.findmydoc.eu/auth/login?provider=github";
    const response = await route.GET({ url, nextUrl: new URL(url) });
    expect(response.status).toBe(307);
    expect(options.provider).toBe(mode === "google" ? "google" : "github");
    if (mode === "google") {
      expect(options.options.scopes).toBe("openid email profile");
      expect(options.options.queryParams).toEqual({ include_granted_scopes: "false", hd: "findmydoc.eu" });
    }
  });
}

test("callback denies an unapproved Workspace identity and clears the new application session", async () => {
  const signOut = vi.fn(async () => ({}));
  const route = await importTestModule("src/app/auth/callback/route.ts", {
    "next/headers": { cookies: async () => ({}) },
    "@/lib/workspace-access": { requireWorkspaceAccess: async () => { throw new Error("Not a member"); } },
    "@/lib/workspace-data-fetch": { sha256: value => value },
    "@/lib/supabase-service-role": { getServerServiceRoleSupabase: () => null },
    "@/lib/auth-redirect": { authOrigin: () => "https://founder-ops.findmydoc.eu", safeRelativeNext: () => "/planning" },
    "@/lib/supabase-server": { getServerAuthSupabase: async () => ({ auth: { exchangeCodeForSession: async () => ({ data: { user: { id: "auth-user" }, session: { access_token: "session", refresh_token: "refresh" } }, error: null }), setSession: async () => ({ error: null }), signOut } }) },
  });
  const url = "https://founder-ops.findmydoc.eu/auth/callback?code=example";
  const response = await route.GET({ url, nextUrl: new URL(url) });
  expect(new URL(response.headers.get("location")).pathname).toBe("/auth/error");
  expect(signOut).toHaveBeenCalledWith({ scope: "local" });
});
