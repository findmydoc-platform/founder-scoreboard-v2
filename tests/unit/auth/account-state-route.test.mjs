import assert from "node:assert/strict";
import { beforeEach, test } from "vitest";
import { importTestModule } from "../../helpers/vitest-module.mjs";

const googleIdentity = {
  sub: "google-123",
  iss: "https://accounts.google.com",
  email: "member@findmydoc.eu",
  email_verified: true,
  custom_claims: { hd: "findmydoc.eu" },
  picture: "https://lh3.googleusercontent.com/a/profile=s96-c",
};

let user = { id: "existing-user" };
let context = { linked: true, identity: googleIdentity };

const route = await importTestModule("src/app/api/auth/account-state/route.ts", {
  "next/server": { NextResponse: { json: (body, init) => Response.json(body, init) } },
  "@/lib/supabase-server": { getServerAuthSupabase: async () => ({ auth: { getUser: async () => ({ data: { user }, error: null }) } }) },
  "@/lib/workspace-access": { workspaceAccessContext: async () => context },
});

beforeEach(() => {
  user = { id: "existing-user" };
  context = { linked: true, identity: googleIdentity };
});

test("account state returns the verified Google image for a linked account", async () => {
  const response = await route.GET();
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  assert.deepEqual(await response.json(), {
    linked: true,
    workspaceEmail: "member@findmydoc.eu",
    workspaceAvatarUrl: "https://lh3.googleusercontent.com/a/profile=s96-c",
  });
});

test("account state omits missing or invalid images", async () => {
  for (const picture of [undefined, "https://attacker.example/image.png"]) {
    context = { linked: true, identity: { ...googleIdentity, picture } };
    assert.deepEqual(await (await route.GET()).json(), { linked: true, workspaceEmail: "member@findmydoc.eu" });
  }
});

test("account state does not expose an image to an unlinked account", async () => {
  context = { linked: false, identity: googleIdentity };
  assert.deepEqual(await (await route.GET()).json(), { linked: false });
});
