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
    "@/lib/google-provider-proof": { verifyGoogleProviderToken: async () => {} },
    "@/lib/supabase-service-role": { getServerServiceRoleSupabase: () => null },
    "@/lib/auth-redirect": { authOrigin: () => "https://founder-ops.findmydoc.eu", safeRelativeNext: () => "/planning" },
    "@/lib/supabase-server": { getServerAuthSupabase: async () => ({ auth: { exchangeCodeForSession: async () => ({ data: { user: { id: "auth-user" }, session: { access_token: "session", refresh_token: "refresh" } }, error: null }), setSession: async () => ({ error: null }), signOut } }) },
  });
  const url = "https://founder-ops.findmydoc.eu/auth/callback?code=example";
  const response = await route.GET({ url, nextUrl: new URL(url) });
  expect(new URL(response.headers.get("location")).pathname).toBe("/auth/error");
  expect(signOut).toHaveBeenCalledWith({ scope: "local" });
});

async function enforcedCallback({ linked, loginNonce = null, cookieNonce = null }) {
  const signOut = vi.fn(async () => ({}));
  const rpc = vi.fn(async () => ({ error: null }));
  const verifyGoogleProviderToken = vi.fn(async () => {});
  const sessionId = "63000000-0000-0000-0000-000000000001";
  const token = `e.${Buffer.from(JSON.stringify({ session_id: sessionId })).toString("base64url")}.s`;
  const route = await importTestModule("src/app/auth/callback/route.ts", {
    "next/headers": { cookies: async () => ({ get: () => ({ value: cookieNonce }), set: vi.fn() }) },
    "@/lib/workspace-access": {
      workspaceAccessContext: async () => ({ mode: "linking", linkingEnforced: true, profileId: "founder", linked }),
      requireWorkspaceAccess: async () => ({ subject: "google-subject" }),
      assertGoogleSession: async () => {},
    },
    "@/lib/workspace-data-fetch": { sha256: value => value },
    "@/lib/google-provider-proof": { verifyGoogleProviderToken },
    "@/lib/supabase-service-role": { getServerServiceRoleSupabase: () => ({ rpc }) },
    "@/lib/auth-redirect": { authOrigin: () => "https://founder-ops.findmydoc.eu", safeRelativeNext: () => "/planning" },
    "@/lib/supabase-server": { getServerAuthSupabase: async () => ({ auth: {
      exchangeCodeForSession: async () => ({ data: { user: { id: "auth-user" }, session: { access_token: token, refresh_token: "refresh", provider_token: "google-provider-token" } }, error: null }),
      setSession: async () => ({ error: null }), signOut,
    } }) },
  });
  const url = `https://founder-ops.findmydoc.eu/auth/callback?code=example${loginNonce ? `&login=${loginNonce}` : ""}`;
  const response = await route.GET({ url, nextUrl: new URL(url) });
  return { response, rpc, signOut, sessionId, verifyGoogleProviderToken };
}

test("an unlinked existing session reaches only the linking page", async () => {
  const { response, rpc } = await enforcedCallback({ linked: false });
  expect(new URL(response.headers.get("location")).pathname).toBe("/auth/link-google");
  expect(rpc).not.toHaveBeenCalled();
});

test("a linked GitHub session is cleared before Google login", async () => {
  const { response, rpc, signOut } = await enforcedCallback({ linked: true });
  expect(new URL(response.headers.get("location")).pathname).toBe("/auth/login");
  expect(signOut).toHaveBeenCalledWith({ scope: "local" });
  expect(rpc).not.toHaveBeenCalled();
});

test("only a nonce-matched Google callback can approve a session", async () => {
  const approved = await enforcedCallback({ linked: true, loginNonce: "valid", cookieNonce: "valid" });
  expect(new URL(approved.response.headers.get("location")).pathname).toBe("/planning");
  expect(approved.rpc).toHaveBeenCalledWith("workspace_record_google_login", {
    p_user_id: "auth-user", p_session_id: approved.sessionId, p_subject: "google-subject",
  });
  expect(approved.verifyGoogleProviderToken).toHaveBeenCalledWith("google-provider-token", { subject: "google-subject" });
  const rejected = await enforcedCallback({ linked: true, loginNonce: "wrong", cookieNonce: "valid" });
  expect(new URL(rejected.response.headers.get("location")).pathname).toBe("/auth/error");
  expect(rejected.rpc).not.toHaveBeenCalled();
  expect(rejected.signOut).toHaveBeenCalledWith({ scope: "local" });
});
