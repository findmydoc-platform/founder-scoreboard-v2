import { test, expect, vi } from "vitest";
import { importTestModule } from "../../helpers/vitest-module.mjs";

const identity = { subject: "google-subject", email: "member@findmydoc.eu" };

test("approves only a Google token returning the bound Workspace identity", async () => {
  const network = vi.fn(async () => new Response(JSON.stringify({
    sub: identity.subject, email: identity.email, email_verified: true, hd: "findmydoc.eu",
  }), { status: 200 }));
  vi.stubGlobal("fetch", network);
  try {
    const { verifyGoogleProviderToken } = await importTestModule("src/lib/google-provider-proof.ts", { "server-only": {} });
    await expect(verifyGoogleProviderToken("provider-token", identity)).resolves.toBeUndefined();
    expect(network).toHaveBeenCalledWith("https://openidconnect.googleapis.com/v1/userinfo", expect.objectContaining({
      headers: { Authorization: "Bearer provider-token" }, cache: "no-store",
    }));
  } finally { vi.unstubAllGlobals(); }
});

test.each([
  { sub: "other", email: identity.email, email_verified: true, hd: "findmydoc.eu" },
  { sub: identity.subject, email: identity.email, email_verified: false, hd: "findmydoc.eu" },
  { sub: identity.subject, email: identity.email, email_verified: true, hd: "other.eu" },
])("rejects a provider token for another identity: %#", async payload => {
  vi.stubGlobal("fetch", async () => new Response(JSON.stringify(payload), { status: 200 }));
  try {
    const { verifyGoogleProviderToken } = await importTestModule("src/lib/google-provider-proof.ts", { "server-only": {} });
    await expect(verifyGoogleProviderToken("provider-token", identity)).rejects.toThrow();
  } finally { vi.unstubAllGlobals(); }
});
