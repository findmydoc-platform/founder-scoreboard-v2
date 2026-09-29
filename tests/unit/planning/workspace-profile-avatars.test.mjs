import assert from "node:assert/strict";
import { beforeEach, test } from "vitest";
import { importTestModule } from "../../helpers/vitest-module.mjs";

const identity = {
  sub: "google-123",
  iss: "https://accounts.google.com",
  email: "member@findmydoc.eu",
  email_verified: true,
  custom_claims: { hd: "findmydoc.eu" },
  picture: "https://lh3.googleusercontent.com/a/profile=s96-c",
};

const contexts = new Map();
const requested = [];
let serviceAvailable = true;
const { withWorkspaceProfileAvatars } = await importTestModule(
  "src/features/planning-items/server/workspace-profile-avatars.ts",
  {
    "server-only": {},
    "@/lib/supabase-service-role": {
      getServerServiceRoleSupabase: () => serviceAvailable ? {
        rpc: async (name, params) => {
          requested.push([name, params]);
          const value = contexts.get(params.p_profile_id);
          return value instanceof Error ? { data: null, error: value } : { data: value, error: null };
        },
      } : null,
    },
  },
);

beforeEach(() => {
  contexts.clear();
  requested.length = 0;
  serviceAvailable = true;
});

test("team avatars come only from each profile's confirmed Google identity", async () => {
  const profiles = [{ id: "linked", name: "Linked" }, { id: "unlinked", name: "Unlinked" }];
  contexts.set("linked", { profileId: "linked", userId: "auth-linked", linked: true, identity });
  contexts.set("unlinked", { profileId: "unlinked", userId: "auth-unlinked", linked: false, identity });

  assert.deepEqual(await withWorkspaceProfileAvatars(profiles), [
    { ...profiles[0], avatarUrl: identity.picture },
    profiles[1],
  ]);
  assert.deepEqual(requested, [
    ["workspace_access_context", { p_profile_id: "linked" }],
    ["workspace_access_context", { p_profile_id: "unlinked" }],
  ]);
});

test("wrong bindings, unverified identities, invalid photos and provider failures fall back to profiles", async () => {
  const profiles = ["wrong-profile", "unverified", "invalid-url", "rpc-error"].map((id) => ({ id, name: id }));
  contexts.set("wrong-profile", { profileId: "someone-else", userId: "auth-user", linked: true, identity });
  contexts.set("unverified", { profileId: "unverified", userId: "auth-user", linked: true, identity: { ...identity, email_verified: false } });
  contexts.set("invalid-url", { profileId: "invalid-url", userId: "auth-user", linked: true, identity: { ...identity, picture: "https://example.com/avatar.png" } });
  contexts.set("rpc-error", new Error("unavailable"));

  assert.deepEqual(await withWorkspaceProfileAvatars(profiles), profiles);
});

test("missing service client leaves the planning board usable", async () => {
  serviceAvailable = false;
  const profiles = [{ id: "member", name: "Member" }];
  assert.deepEqual(await withWorkspaceProfileAvatars(profiles), profiles);
  assert.deepEqual(requested, []);
});
