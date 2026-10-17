import { createHmac } from "node:crypto";
import { NextRequest } from "next/server";
import { vi } from "vitest";

export function administratorProtocol(initial = {}) {
  const origin = "https://administrator-auth.example.test";
  for (const key of ["NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_URL"]) vi.stubEnv(key, origin);
  for (const key of ["NEXT_PUBLIC_SUPABASE_ANON_KEY", "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "SUPABASE_ANON_KEY", "SUPABASE_PUBLISHABLE_KEY"]) vi.stubEnv(key, "synthetic-anon");
  for (const key of ["SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_SECRET_KEY"]) vi.stubEnv(key, "synthetic-service");
  vi.stubEnv("REQUIRE_SUPABASE_AUTH", "true");
  for (const name of ["GITHUB_APP_ID", "GITHUB_APP_INSTALLATION_ID", "GITHUB_APP_PRIVATE_KEY", "GITHUB_APP_PRIVATE_KEY_PATH", "GOOGLE_CHAT_WEBHOOK_URL", "GOOGLE_CHAT_PRIVATE_KEY", "GOOGLE_CHAT_SERVICE_ACCOUNT_EMAIL"]) vi.stubEnv(name, "");
  const state = { role: "founder", profile: true, snapshot: { eligible: true, active: true, expiresAt: new Date(Date.now() + 3600000).toISOString() }, responses: {}, ...initial };
  const encode = value => Buffer.from(JSON.stringify(value)).toString("base64url");
  const unsigned = `${encode({ alg: "HS256", typ: "JWT" })}.${encode({ iss: `${origin}/auth/v1`, aud: "authenticated", role: "authenticated", sub: "synthetic-user", session_id: "00000000-0000-4000-8000-000000000001", exp: Math.floor(Date.now() / 1000) + 3600 })}`;
  const token = `${unsigned}.${createHmac("sha256", "synthetic-test-key").update(unsigned).digest("base64url")}`;
  const calls = [];
  vi.stubGlobal("fetch", async (input, init) => {
    const request = new Request(input, init), url = new URL(request.url);
    if (url.origin !== origin) throw new Error("Unexpected external provider in administrator protocol");
    if (url.pathname === "/auth/v1/user") {
      if (state.authError) return Response.json({ message: "Sensitive upstream detail", code: "unexpected_failure" }, { status: state.authError });
      if (request.headers.get("authorization") !== `Bearer ${token}`) return Response.json({ message: "Invalid credential" }, { status: 401 });
      return Response.json({ id: "synthetic-user", aud: "authenticated", identities: [], user_metadata: { platform_role: "ceo" } });
    }
    if (url.pathname === "/rest/v1/rpc/workspace_access_context") return Response.json({ mode: "legacy", userId: "synthetic-user", profileId: state.profile ? "synthetic-profile" : null });
    if (url.pathname === "/rest/v1/rpc/current_authenticated_profile") return state.profileError ? Response.json({ code: "PGRST116", message: "Ambiguous profile" }, { status: 400 }) : Response.json(state.profile ? { id: "synthetic-profile", name: "Synthetic Founder", platform_role: state.role } : null);
    if (url.pathname === "/rest/v1/rpc/administrator_access_snapshot") return state.snapshotError ? Response.json({ code: state.snapshotError, message: "Private provider detail" }, { status: 403 }) : Response.json(state.snapshot);
    if (url.pathname.startsWith("/rest/v1/rpc/")) {
      const name = url.pathname.split("/").at(-1), body = await request.json();
      calls.push({ name, body });
      if (name in state.responses) return typeof state.responses[name] === "function" ? state.responses[name](body) : Response.json(state.responses[name]);
    }
    if (url.pathname === "/rest/v1/profiles") return Response.json(state.devProfile || null);
    throw new Error("Unexpected external protocol in administrator test");
  });
  return { state, calls, cookieJar: () => ({ getAll: () => [{ name: "sb-administrator-auth-auth-token", value: `base64-${Buffer.from(JSON.stringify({ access_token: token, refresh_token: "synthetic-refresh", expires_at: Math.floor(Date.now() / 1000) + 3600, expires_in: 3600, token_type: "bearer", user: { id: "synthetic-user" } })).toString("base64url")}` }], set() {} }), request: (path = "/", method = "GET", body, headers = {}) => new NextRequest(`https://app.example.test${path}`, {
    method, headers: { authorization: `Bearer ${token}`, "content-type": "application/json", ...headers }, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }) };
}
