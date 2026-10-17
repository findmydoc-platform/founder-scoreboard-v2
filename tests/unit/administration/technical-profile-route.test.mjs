import { afterEach, expect, test, vi } from "vitest";
import { administratorProtocol } from "../../helpers/administrator-protocol.mjs";
import { importTestModule } from "../../helpers/vitest-module.mjs";
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

async function fixture() {
  const protocol = administratorProtocol({ responses: { update_profile_technical_identity_transaction: { profile: { id: "target", auth_user_id: "must-not-leak" } } } });
  const route = await importTestModule("src/app/api/administration/profiles/[id]/technical/route.ts", { "server-only": {} });
  return { ...protocol, patch: payload => route.PATCH(protocol.request("/api/administration/profiles/target/technical", "PATCH", payload), { params: Promise.resolve({ id: "target" }) }) };
}

test("technical administration rejects personal notification preference writes", async () => {
  const current = await fixture();
  expect((await current.patch({ notificationsEnabled: false })).status).toBe(400);
  expect(current.calls).toEqual([]);
});

test("technical administration returns a narrow response and binds the transaction target", async () => {
  const current = await fixture();
  const response = await current.patch({ githubLogin: "valid-login", googleChatUserId: "chat-user", googleChatDmSpace: "spaces/dm" });
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ ok: true });
  expect(current.calls).toMatchObject([{ name: "update_profile_technical_identity_transaction", body: { p_profile_id: "target", p_profile_patch: { github_login: "valid-login", google_chat_user_id: "chat-user", google_chat_dm_space: "spaces/dm" } } }]);
});

test("technical administration preserves the late expiry distinction", async () => {
  const current = await fixture();
  current.state.responses.update_profile_technical_identity_transaction = () => {
    current.state.snapshot = { eligible: true, active: false, expiresAt: null };
    return Response.json({ code: "42501", message: "Denied" }, { status: 403 });
  };
  const response = await current.patch({ githubLogin: "valid-login" });
  expect(response.status).toBe(403);
  expect(await response.json()).toEqual({ code: "administrator_access_expired", error: "Der Adminzugang ist abgelaufen." });
});
