import { afterEach, expect, test, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { importTestModule } from "../../helpers/vitest-module.mjs";

afterEach(() => vi.unstubAllEnvs());

async function fixture(change = {}, member = true) {
  vi.stubEnv("VERCEL_ENV", "preview");
  const identity = { sub: "google-subject", iss: "https://accounts.google.com", email: "member@findmydoc.eu", email_verified: true, custom_claims: { hd: "findmydoc.eu" } };
  const context = { mode: "linking", linkingEnforced: true, linked: true, userId: "user-1", profileId: "founder", identity, ...change };
  const isWorkspaceGroupMember = vi.fn().mockResolvedValue(member);
  const access = await importTestModule("src/lib/workspace-access.ts", {
    "server-only": {},
    "./supabase-service-role": { getServerServiceRoleSupabase: () => ({ rpc: async () => ({ data: context, error: null }) }) },
    "./workspace-directory": { isWorkspaceGroupMember },
  });
  return { access, isWorkspaceGroupMember };
}

test("Preview accepts a bound and linked Google identity after live group verification", async () => {
  const { access, isWorkspaceGroupMember } = await fixture();
  await expect(access.requireWorkspaceAccess({ userId: "user-1" })).resolves.toEqual({ userId: "user-1", subject: "google-subject", email: "member@findmydoc.eu" });
  expect(isWorkspaceGroupMember).toHaveBeenCalledWith("member@findmydoc.eu");
});

test.each([{ userId: null }, { profileId: null }, { identity: null }, { linked: false }])("Preview rejects incomplete authoritative bindings %j", async change => {
  const { access, isWorkspaceGroupMember } = await fixture(change);
  await expect(access.requireWorkspaceAccess({ userId: "user-1" })).rejects.toMatchObject({ status: 403 });
  expect(isWorkspaceGroupMember).not.toHaveBeenCalled();
});

test("Preview rejects a nonmember and fails closed when Directory is unavailable", async () => {
  const { access, isWorkspaceGroupMember } = await fixture({}, false);
  await expect(access.requireWorkspaceAccess({ userId: "user-1" })).rejects.toMatchObject({ status: 403 });
  isWorkspaceGroupMember.mockRejectedValue(new Error("Directory unavailable"));
  await expect(access.requireWorkspaceAccess({ userId: "user-1" })).rejects.toMatchObject({ status: 503 });
});

test("Preview reports the configured login mode instead of hiding login", async () => {
  vi.stubEnv("VERCEL_ENV", "preview");
  const route = await importTestModule("src/app/api/auth/login-mode/route.ts", {
    "@/lib/workspace-access": { workspaceAccessContext: async () => ({ mode: "linking", linkingEnforced: true }) },
  });
  const response = await route.GET();
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ mode: "linking", linkingEnforced: true });
  expect(response.headers.get("cache-control")).toBe("no-store");
});


async function linkingPage(context = {}, user = { id: "user-1" }) {
  vi.stubEnv("VERCEL_ENV", "preview");
  const page = await importTestModule("src/app/auth/link-google/page.tsx", {
    "next/link": { default: ({ children, ...props }) => createElement("a", props, children) },
    "@/shared/atoms/app-brand": { AppBrand: () => null },
    "@/lib/supabase-server": {
      getServerAuthSupabase: async () => ({ auth: { getUser: async () => ({ data: { user } }) } }),
    },
    "@/lib/workspace-access": {
      workspaceAccessContext: async () => ({ mode: "linking", linkingEnforced: true, linked: false, profileId: "founder", ...context }),
    },
  });
  return renderToStaticMarkup(await page.default());
}

test("Preview lets a mapped unlinked user submit the Google linking form", async () => {
  const html = await linkingPage();
  expect(html).toContain('<form action="/auth/google-link/start" method="post">');
  expect(html).toContain('type="submit">Mit Google verknüpfen</button>');
});

test("Preview asks an unauthenticated user to sign in before linking", async () => {
  const html = await linkingPage({}, null);
  expect(html).toContain("Mit bestehendem Konto anmelden");
  expect(html).not.toContain('action="/auth/google-link/start"');
});

test("Preview does not offer linking to an unmapped account", async () => {
  const html = await linkingPage({ profileId: null });
  expect(html).toContain("Diesem Konto ist kein Teamprofil zugeordnet.");
  expect(html).not.toContain('action="/auth/google-link/start"');
});

test("Preview does not offer linking outside linking mode", async () => {
  const html = await linkingPage({ mode: "google" });
  expect(html).toContain("Die Kontoverknüpfung ist derzeit nicht geöffnet.");
  expect(html).not.toContain('action="/auth/google-link/start"');
});
