import { test, expect, vi } from "vitest";
import { importTestModule } from "../../helpers/vitest-module.mjs";

async function startWith(identities, { access = { subject: "google-subject" }, completeError = null } = {}) {
  const calls = [];
  const linkIdentity = vi.fn(async () => ({ data: { url: "https://accounts.google.com/authorize" }, error: null }));
  const setCookie = vi.fn();
  const requireWorkspaceAccess = vi.fn(async () => {
    if (access instanceof Error) throw access;
    return access;
  });
  const route = await importTestModule("src/app/auth/google-link/start/route.ts", {
    "next/headers": { cookies: async () => ({ set: setCookie }) },
    "@/lib/supabase-server": { getServerAuthSupabase: async () => ({ auth: {
      getUser: async () => ({ data: { user: { id: "auth-user", identities } } }), linkIdentity,
    } }) },
    "@/lib/supabase-service-role": { getServerServiceRoleSupabase: () => ({
      rpc: async (name, args) => {
        calls.push({ name, args });
        return { error: name === "workspace_complete_link" ? completeError : null };
      },
    }) },
    "@/lib/auth-redirect": { authOrigin: () => "https://founder-ops.findmydoc.eu" },
    "@/lib/workspace-data-fetch": { sha256: value => value },
    "@/lib/workspace-access": { requireWorkspaceAccess },
  });
  const url = "https://founder-ops.findmydoc.eu/auth/google-link/start";
  const response = await route.POST({ url, headers: new Headers({ origin: "https://founder-ops.findmydoc.eu" }) });
  return { calls, linkIdentity, requireWorkspaceAccess, response, setCookie };
}

test("retry completes an already attached Google identity without another OAuth link", async () => {
  const { calls, linkIdentity, requireWorkspaceAccess, response, setCookie } = await startWith([{ provider: "google" }]);
  expect(response.status).toBe(303);
  expect(new URL(response.headers.get("location")).pathname).toBe("/auth/link-google");
  expect(linkIdentity).not.toHaveBeenCalled();
  expect(requireWorkspaceAccess).toHaveBeenCalledWith({ userId: "auth-user" }, false);
  expect(calls.map(call => call.name)).toEqual(["workspace_begin_link", "workspace_complete_link"]);
  expect(calls[1].args.p_subject).toBe("google-subject");
  expect(calls[1].args.p_nonce_hash).toBe(calls[0].args.p_nonce_hash);
  expect(setCookie).toHaveBeenCalledWith("workspace_link", "", expect.objectContaining({ maxAge: 0 }));
});

test("a new link still starts OAuth after recording its attempt", async () => {
  const { calls, linkIdentity, response, setCookie } = await startWith([]);
  expect(response.status).toBe(303);
  expect(response.headers.get("location")).toBe("https://accounts.google.com/authorize");
  expect(calls.map(call => call.name)).toEqual(["workspace_begin_link"]);
  expect(linkIdentity).toHaveBeenCalledOnce();
  expect(setCookie).toHaveBeenCalledWith("workspace_link", expect.any(String), expect.objectContaining({ httpOnly: true }));
});

test.each([
  { identities: [{ provider: "google" }, { provider: "google" }], access: undefined },
  { identities: undefined, access: undefined },
  { identities: [{ provider: "google" }], access: new Error("group denied") },
  { identities: [{ provider: "google" }], access: null },
])("refuses ambiguous or unauthorized attached identities: %#", async ({ identities, access }) => {
  const { calls, linkIdentity, response } = await startWith(identities, { access });
  expect(linkIdentity).not.toHaveBeenCalled();
  expect(calls.some(call => call.name === "workspace_complete_link")).toBe(false);
  expect(response.status === 403 || new URL(response.headers.get("location")).pathname === "/auth/error").toBe(true);
});

test("a conflicting binding cannot complete the retry", async () => {
  const { calls, linkIdentity, response } = await startWith([{ provider: "google" }], { completeError: { code: "42501" } });
  expect(response.status).toBe(403);
  expect(calls.map(call => call.name)).toEqual(["workspace_begin_link", "workspace_complete_link"]);
  expect(linkIdentity).not.toHaveBeenCalled();
});
