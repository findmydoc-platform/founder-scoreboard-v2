import { generateKeyPairSync } from "node:crypto";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { administratorProtocol } from "../../helpers/administrator-protocol.mjs";
import { importTestModule } from "../../helpers/vitest-module.mjs";
import { FOUNDEROPS_GITHUB_REPOSITORIES, FOUNDEROPS_GITHUB_PROJECT_FIELDS } from "@/lib/github-project-config";

const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
let protocol;
let providerCalls;
beforeEach(() => {
  vi.resetModules();
  protocol = administratorProtocol();
  providerCalls = [];
  for (const [key, value] of Object.entries({ GITHUB_APP_ID: "123", GITHUB_APP_INSTALLATION_ID: "456", GITHUB_APP_PRIVATE_KEY: privateKey.export({ type: "pkcs8", format: "pem" }), GITHUB_APP_PRIVATE_KEY_PATH: "" })) vi.stubEnv(key, value);
  const authFetch = globalThis.fetch;
  vi.stubGlobal("fetch", async (input, init) => {
    const request = new Request(input, init), url = new URL(request.url);
    if (url.hostname !== "api.github.com") return authFetch(request);
    providerCalls.push(url.pathname);
    if (url.pathname === "/app/installations/456/access_tokens") return Response.json({ token: "synthetic-installation", expires_at: new Date(Date.now() + 3600000).toISOString() });
    if (url.pathname === "/graphql") {
      if (protocol.state.providerDenied) return Response.json({ message: "Forbidden" }, { status: 403 });
      return Response.json({ data: { organization: { projectV2: { id: "synthetic-project", number: 22, title: "FounderOps", closed: false, url: "https://github.com/orgs/findmydoc-platform/projects/22", repositories: { nodes: FOUNDEROPS_GITHUB_REPOSITORIES.map(nameWithOwner => ({ nameWithOwner })), totalCount: FOUNDEROPS_GITHUB_REPOSITORIES.length }, fields: { nodes: FOUNDEROPS_GITHUB_PROJECT_FIELDS } } } } });
    }
    if (url.pathname === "/orgs/findmydoc-platform/teams/founderops") return Response.json({ slug: "founderops", name: "FounderOps", notification_setting: "notifications_enabled" });
    throw new Error("Unexpected synthetic GitHub protocol");
  });
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
const payload = { expectedGithubProjectOwner: "findmydoc-platform", expectedGithubProjectNumber: 21, githubProjectOwner: "findmydoc-platform", githubProjectNumber: 22 };
async function patch(body = payload) {
  const route = await importTestModule("src/app/api/founderops-settings/github-project/route.ts", { "server-only": {} });
  return route.PATCH(protocol.request("/api/founderops-settings/github-project", "PATCH", body));
}

test("GitHub Project preserves post-guard expiry classification through actual provider and user-RPC protocols", async () => {
  protocol.state.responses.update_administration_github_project_transaction_v2 = () => {
    protocol.state.snapshot = { eligible: true, active: false, expiresAt: null };
    return Response.json({ code: "42501" }, { status: 403 });
  };
  const response = await patch({ ...payload, expectedGithubMentionTeamSlug: "founderops", githubMentionTeamSlug: "founderops" });
  expect(response.status).toBe(403);
  expect(await response.json()).toEqual({ code: "administrator_access_expired", error: "Der Adminzugang ist abgelaufen." });
  expect(protocol.calls[0].name).toBe("update_administration_github_project_transaction_v2");
});

test("GitHub Project preserves the legacy payload without a mention team", async () => {
  protocol.state.responses.update_administration_github_project_transaction_v2 = { project: { id: "findmydoc-founder-execution", githubProjectOwner: "findmydoc-platform", githubProjectNumber: 22, githubMentionTeamSlug: null } };
  const response = await patch();
  expect(response.status).toBe(200);
  expect(protocol.calls[0].body).toMatchObject({ p_expected_team_slug: "", p_github_mention_team_slug: null });
  expect((await response.json()).mentionTeam).toBeNull();
});

test("an inactive administrator cannot start project validation", async () => {
  protocol.state.snapshot = { eligible: true, active: false, expiresAt: null };
  expect((await patch()).status).toBe(403);
  expect(providerCalls).toEqual([]);
  expect(protocol.calls).toEqual([]);
});

test("project provider denial preserves 422 and never starts the settings transaction", async () => {
  protocol.state.providerDenied = true;
  expect((await patch()).status).toBe(422);
  expect(protocol.calls).toEqual([]);
});

test.each([["P0001", 409], ["P0002", 404], ["22023", 400], ["unexpected", 500]])("project transaction %s keeps its existing response contract", async (code, status) => {
  protocol.state.responses.update_administration_github_project_transaction_v2 = () => Response.json({ code, message: "Sensitive upstream detail" }, { status: 400 });
  const response = await patch();
  expect(response.status).toBe(status);
  expect(JSON.stringify(await response.json())).not.toContain("Sensitive upstream detail");
});
