import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { loadTranspiledModule } from "./helpers/transpile-module.mjs";

const contract = await loadTranspiledModule("src/features/agent/model/agent-contract.ts");
const { requireAgentScope } = await loadTranspiledModule(
  "src/features/agent/model/agent-auth.ts",
  { "@/features/agent/model/agent-contract": contract },
);
const projection = await loadTranspiledModule(
  "src/features/agent/model/agent-planning-projection.ts",
  {
    "@/features/agent/model/agent-contract": contract,
    "@/lib/status": { normalizeStatus: (status) => status },
  },
);
const planningUnavailableError = new Error("Planning unavailable");
const routeHandler = await loadTranspiledModule(
  "src/features/agent/model/agent-route-handler.ts",
  {
    "next/server": {
      NextResponse: {
        json: (body, init = {}) => ({ body, status: init.status || 200 }),
      },
    },
    "@/features/agent/model/agent-auth": {
      requireAgentScope: (request) => request.authorized
        ? { ok: true, scopes: contract.agentScopes, actor: "ceo-agent" }
        : { ok: false, status: 401, error: "Agent token is required." },
    },
    "@/lib/planning-data-availability": {
      isPlanningDataUnavailableError: (error) => error === planningUnavailableError,
    },
  },
);

function requestWithToken(token = "") {
  return { headers: new Headers(token ? { authorization: `Bearer ${token}` } : {}) };
}

function task(id, overrides = {}) {
  return {
    id,
    title: id,
    taskType: "deliverable",
    status: "Offen",
    priority: "P2",
    assigneeId: "founder-1",
    assignee: "Founder One",
    ownerId: "founder-1",
    owner: "Founder One",
    sprintId: "sprint-1",
    packageId: "initiative-1",
    reviewOwnerProfileId: "reviewer-1",
    reviewStatus: "not_requested",
    scoreFinal: false,
    scorePoints: 0,
    scoreRelevant: true,
    hours: 4,
    startDate: "",
    endDate: "",
    deadline: "",
    description: "Problem",
    problemStatement: "Problem",
    intendedOutcome: "Outcome",
    scopeConstraints: "",
    acceptanceCriteria: "Criteria",
    evidenceRequired: "Evidence",
    definitionOfDone: "Done",
    evidenceLink: "",
    githubIssueUrl: "",
    issueUrl: "",
    ...overrides,
  };
}

function planningData() {
  return {
    project: { id: "project-1" },
    profiles: [
      { id: "founder-1", name: "Founder One", platformRole: "founder", githubLogin: "founder" },
      { id: "reviewer-1", name: "Reviewer One", platformRole: "ceo", githubLogin: "reviewer" },
    ],
    sprints: [{ id: "sprint-1" }],
    milestones: [{ id: "milestone-1" }],
    packages: [{
      id: "initiative-1",
      title: "Initiative One",
      milestoneId: "milestone-1",
      ownerId: "reviewer-1",
      accountableProfileId: "reviewer-1",
      responsibleProfileIds: ["founder-1"],
      consultedProfileIds: [],
      informedProfileIds: [],
      status: "active",
      priority: "P1",
      targetDate: "",
      goal: "Goal",
      successCriteria: "Success",
      scopeConstraints: "",
    }],
    tasks: [
      task("blocked-task", { reviewStatus: "requested" }),
      task("blocking-task", { assigneeId: "reviewer-1", assignee: "Reviewer One", ownerId: "reviewer-1", owner: "Reviewer One", evidenceLink: "https://example.com/evidence" }),
      task("sub-issue", { taskType: "sub_issue", scoreRelevant: false }),
    ],
    taskComments: [
      { id: 2, taskId: "blocked-task", comment: "Latest" },
      { id: 1, taskId: "blocked-task", comment: "Older" },
    ],
    taskExternalComments: [{ id: 3, taskId: "blocked-task", htmlUrl: "https://example.com/comment" }],
    taskBlockers: [{ id: 4, taskId: "blocked-task", status: "open", reason: "Reason", impact: "Impact" }],
    taskRelations: [{ id: 5, taskId: "blocked-task", relatedTaskId: "blocking-task", relationType: "blocked_by" }],
  };
}

test("agent token guard fails closed and accepts only the configured bearer token", () => {
  const previousHash = process.env.FOUNDEROPS_AGENT_TOKEN_SHA256;
  const token = "valid-agent-token";
  process.env.FOUNDEROPS_AGENT_TOKEN_SHA256 = createHash("sha256").update(token).digest("hex");
  try {
    assert.deepEqual(requireAgentScope(requestWithToken(), "read:planning"), {
      ok: false,
      status: 401,
      error: "Agent token is required.",
    });
    assert.equal(requireAgentScope(requestWithToken("wrong"), "read:planning").ok, false);
    assert.equal(requireAgentScope(requestWithToken(token), "read:planning").ok, true);
    assert.equal(requireAgentScope(requestWithToken(token), "unsupported:scope").status, 403);
  } finally {
    if (previousHash === undefined) delete process.env.FOUNDEROPS_AGENT_TOKEN_SHA256;
    else process.env.FOUNDEROPS_AGENT_TOKEN_SHA256 = previousHash;
  }
});

test("central agent route handler enforces auth and maps planning outages", async () => {
  let handlerCalled = false;
  const unauthorized = await routeHandler.handleAgentRequest({ authorized: false }, "read:planning", async () => {
    handlerCalled = true;
    return { status: 200 };
  });
  assert.equal(handlerCalled, false);
  assert.deepEqual(unauthorized, {
    body: { ok: false, error: "Agent token is required." },
    status: 401,
  });

  const unavailable = await routeHandler.handleAgentRequest({ authorized: true }, "read:planning", async () => {
    throw planningUnavailableError;
  });
  assert.deepEqual(unavailable, {
    body: { ok: false, error: "Planning unavailable" },
    status: 503,
  });
});

test("agent projection builds summaries from shared indexes without changing its API contract", () => {
  const data = planningData();
  const result = projection.projectAgentTasks(data, { blocked: true, limit: 500 }, "supabase");

  assert.equal(result.source, "supabase");
  assert.equal(result.filters.limit, 200);
  assert.equal(result.tasks.length, 1);
  assert.equal(result.tasks[0].id, "blocked-task");
  assert.equal(result.tasks[0].initiativeTitle, "Initiative One");
  assert.equal(result.tasks[0].reviewOwnerName, "Reviewer One");
  assert.deepEqual(result.tasks[0].relations, { waitsOn: 1, blocks: 0, related: 0 });
  assert.deepEqual(result.tasks[0].comments, {
    internalCount: 2,
    externalCount: 1,
    latestInternalComment: "Latest",
    latestExternalCommentUrl: "https://example.com/comment",
  });
  assert.deepEqual(result.tasks[0].blockers, {
    openCount: 1,
    latestReason: "Reason",
    latestImpact: "Impact",
  });
});

test("agent context metrics use the same indexed planning model", () => {
  const result = projection.projectAgentContext(planningData(), "supabase");

  assert.deepEqual(result.context.metrics, {
    taskCount: 3,
    openTaskCount: 3,
    openReviewCount: 1,
    tasksWithoutEvidenceCount: 1,
    blockedTaskCount: 1,
  });
  assert.equal(result.context.constraints.noAiModelInsideFounderOps, true);
  assert.equal(result.context.constraints.noDirectDatabaseCredentials, true);
});
