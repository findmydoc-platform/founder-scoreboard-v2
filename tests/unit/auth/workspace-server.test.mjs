import { test, expect } from "vitest";
import { importTestModule } from "../../helpers/vitest-module.mjs";

const identity = { sub: "google-sub", iss: "https://accounts.google.com", email: "management@findmydoc.eu", email_verified: true, custom_claims: { hd: "findmydoc.eu" } };

test("session and personal-token authorization both lose access immediately on group removal", async () => {
  let member = true;
  let calls = 0;
  const contexts = [];
  const access = await importTestModule("src/lib/workspace-access.ts", {
    "server-only": {},
    "./supabase-service-role": { getServerServiceRoleSupabase: () => ({ rpc: async (_name, args) => {
      contexts.push(args);
      return { data: { mode: "google", userId: "auth-user", profileId: "founder", linked: true, identity }, error: null };
    } }) },
    "./workspace-directory": { isWorkspaceGroupMember: async () => { calls++; return member; } },
  });
  await expect(access.requireWorkspaceAccess({ userId: "auth-user" })).resolves.toMatchObject({ subject: "google-sub" });
  member = false;
  await expect(access.requireWorkspaceAccess({ userId: "auth-user" })).rejects.toMatchObject({ status: 403 });
  await expect(access.requireWorkspaceAccess({ profileId: "founder" })).rejects.toMatchObject({ status: 403 });
  expect(calls).toBe(3);
  expect(contexts.at(-1)).toEqual({ p_user_id: null, p_profile_id: "founder" });
});

test("missing bindings and Directory outages cannot authorize protected data", async () => {
  let linked = false;
  let calls = 0;
  const access = await importTestModule("src/lib/workspace-access.ts", {
    "server-only": {},
    "./supabase-service-role": { getServerServiceRoleSupabase: () => ({ rpc: async () => ({ data: { mode: "google", userId: "auth-user", profileId: "founder", linked, identity } }) }) },
    "./workspace-directory": { isWorkspaceGroupMember: async () => { calls++; throw new Error("Timeout"); } },
  });
  await expect(access.requireWorkspaceAccess({ userId: "auth-user" })).rejects.toMatchObject({ status: 403 });
  expect(calls).toBe(0);
  linked = true;
  await expect(access.requireWorkspaceAccess({ userId: "auth-user" })).rejects.toMatchObject({ status: 503 });
});
