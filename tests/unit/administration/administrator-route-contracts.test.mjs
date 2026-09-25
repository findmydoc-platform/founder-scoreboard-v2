import assert from "node:assert/strict";
import { beforeEach, test } from "vitest";
import { importTestModule } from "../../helpers/vitest-module.mjs";

let rpcError = null;
let rpcData = null;
const rpcCalls = [];
let administrationReadResult = { status: "forbidden" };

const nextServer = { NextResponse: { json: (body, init) => Response.json(body, init) } };
const apiResponse = {
  apiError: (error, status) => Response.json({ error }, { status }),
  authzError: (permission) => Response.json({
    error: permission.error,
    ...(permission.code ? { code: permission.code } : {}),
  }, { status: permission.status }),
};
const supabase = {
  rpc: async (name, params) => {
    rpcCalls.push([name, params]);
    return { data: rpcData, error: rpcError };
  },
};

const eligibilityRoute = await importTestModule("src/app/api/administrator-access/profiles/[id]/route.ts", {
  "next/server": nextServer,
  "@/lib/api-response": apiResponse,
  "@/lib/authz": {
    bearerToken: () => "session-token",
    requireAdministratorEligibilityManager: async () => ({ ok: true, profile: { id: "administrator" } }),
    resolveAdministratorAccessFailure: async () => ({
      ok: false,
      status: 403,
      code: "administrator_access_expired",
      error: "Der Adminzugang ist abgelaufen.",
    }),
  },
  "@/lib/supabase": { getSupabaseForToken: () => supabase },
});

const githubRoute = await importTestModule("src/app/api/founderops-settings/github-project/route.ts", {
  "next/server": nextServer,
  "@/lib/api-input": { auditRequestMetadata: () => ({ request_ip: "127.0.0.1", user_agent: "test" }) },
  "@/lib/api-response": apiResponse,
  "@/lib/authz": {
    bearerToken: () => "session-token",
    requireActiveAdministrator: async () => ({ ok: true, profile: { id: "administrator" } }),
    resolveAdministratorAccessFailure: async () => ({
      ok: false,
      status: 403,
      code: "administrator_access_expired",
      error: "Der Adminzugang ist abgelaufen.",
    }),
  },
  "@/lib/github-app": { getGitHubAppInstallationToken: async () => "installation-token" },
  "@/lib/github-project": {
    validateFounderOpsGitHubProject: async () => ({
      title: "FounderOps",
      url: "https://github.com/orgs/findmydoc-platform/projects/21",
      repositories: [],
      fields: [],
    }),
  },
  "@/lib/github-mention-team": {
    validGitHubTeamSlug: (value) => typeof value === "string" && value.length > 0,
    validateGitHubMentionTeam: async () => ({ slug: "founderops", name: "FounderOps", url: "https://github.com/orgs/findmydoc-platform/teams/founderops", notificationsEnabled: true }),
  },
  "@/lib/github-project-config": {
    validGitHubProjectNumber: (value) => Number.isInteger(value) && value > 0,
    validGitHubProjectOwner: (value) => typeof value === "string" && value.length > 0,
  },
  "@/lib/supabase": { getSupabaseForToken: () => supabase },
});

const administrationDataRoute = await importTestModule("src/app/api/administration-data/route.ts", {
  "next/server": nextServer,
  "@/features/administration/server/administration-read-model-supabase": {
    createSupabaseAdministrationReadModel: () => ({ load: async () => administrationReadResult }),
  },
  "@/lib/api-response": apiResponse,
  "@/lib/authz": {
    bearerToken: () => "session-token",
    requireAdministratorEligibilityManager: async () => ({
      ok: true,
      profile: { id: "administrator" },
      authority: { capabilities: { manageAdministratorEligibility: true } },
    }),
    resolveAdministratorAccessFailure: async () => ({
      ok: false,
      status: 403,
      code: "administrator_access_expired",
      error: "Der Adminzugang ist abgelaufen.",
    }),
  },
  "@/lib/supabase": { getSupabaseForToken: () => supabase },
});

beforeEach(() => {
  rpcCalls.length = 0;
  rpcError = null;
  rpcData = null;
  administrationReadResult = { status: "forbidden" };
});

function patchRequest(url, body) {
  return new Request(url, { method: "PATCH", body: JSON.stringify(body) });
}

test("eligibility adapter rejects malformed input before its RPC", async () => {
  const response = await eligibilityRoute.PATCH(
    patchRequest("http://localhost/api/administrator-access/profiles/volkan", { eligible: "yes" }),
    { params: Promise.resolve({ id: "volkan" }) },
  );

  assert.equal(response.status, 400);
  assert.equal(rpcCalls.length, 0);
});

test("eligibility adapter maps post-guard authority loss to the late expiry code", async () => {
  rpcError = { code: "42501" };

  const response = await eligibilityRoute.PATCH(
    patchRequest("http://localhost/api/administrator-access/profiles/volkan", { eligible: false }),
    { params: Promise.resolve({ id: "volkan" }) },
  );

  assert.equal(response.status, 403);
  assert.deepEqual(await response.json(), {
    code: "administrator_access_expired",
    error: "Der Adminzugang ist abgelaufen.",
  });
});

test("GitHub Project adapter maps post-guard authority loss to the late expiry code", async () => {
  rpcError = { code: "42501" };

  const response = await githubRoute.PATCH(patchRequest(
    "http://localhost/api/founderops-settings/github-project",
    {
      expectedGithubProjectOwner: "findmydoc-platform",
      expectedGithubProjectNumber: 21,
      expectedGithubMentionTeamSlug: "founderops",
      githubProjectOwner: "findmydoc-platform",
      githubProjectNumber: 22,
      githubMentionTeamSlug: "founderops",
    },
  ));

  assert.equal(response.status, 403);
  assert.deepEqual(await response.json(), {
    code: "administrator_access_expired",
    error: "Der Adminzugang ist abgelaufen.",
  });
  assert.equal(rpcCalls[0][0], "update_administration_github_project_transaction_v2");
});

test("GitHub Project adapter preserves the legacy payload without a mention team", async () => {
  rpcData = {
    project: {
      id: "findmydoc-founder-execution",
      githubProjectOwner: "findmydoc-platform",
      githubProjectNumber: 22,
      githubMentionTeamSlug: null,
    },
  };

  const response = await githubRoute.PATCH(patchRequest(
    "http://localhost/api/founderops-settings/github-project",
    {
      expectedGithubProjectOwner: "findmydoc-platform",
      expectedGithubProjectNumber: 21,
      githubProjectOwner: "findmydoc-platform",
      githubProjectNumber: 22,
    },
  ));

  assert.equal(response.status, 200);
  assert.equal(rpcCalls[0][1].p_expected_team_slug, "");
  assert.equal(rpcCalls[0][1].p_github_mention_team_slug, null);
  assert.equal((await response.json()).mentionTeam, null);
});

test("administration read adapter clears clients with the late expiry code", async () => {
  const response = await administrationDataRoute.GET(new Request("http://localhost/api/administration-data"));

  assert.equal(response.status, 403);
  assert.deepEqual(await response.json(), {
    code: "administrator_access_expired",
    error: "Der Adminzugang ist abgelaufen.",
  });
});
