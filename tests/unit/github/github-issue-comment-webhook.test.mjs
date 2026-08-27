import assert from "node:assert/strict";
import { test } from "vitest";
import { importTestModule } from "../../helpers/vitest-module.mjs";

const markerPolicy = await importTestModule(
  "src/features/tasks/model/github-comment-delivery-policy.ts",
);
const mentions = await importTestModule("src/lib/mentions.ts");
const mentionSnapshots = await importTestModule("src/lib/github-comment-mention-snapshot.ts", {
  "@/lib/mentions": mentions,
});

class MockGitHubApiError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

const processor = await importTestModule("src/lib/github-issue-comment-webhook.ts", {
  "server-only": {},
  "@/features/tasks/model/github-comment-delivery-policy": markerPolicy,
  "@/lib/mentions": mentions,
  "@/lib/github-comment-mention-snapshot": mentionSnapshots,
  "./github-app": {
    getGitHubAppInstallationToken: async () => "installation-token",
  },
  "./github": {
    getGitHubIssueComment: async () => {
      throw new Error("production loader must be replaced in processor tests");
    },
    GitHubApiError: MockGitHubApiError,
    isGitHubIssueApiUrl: (value, issueNumber, repository) => (
      value === `https://api.github.com/repos/${repository}/issues/${issueNumber}`
    ),
  },
});

test("the Supabase adapter resolves current and baseline mentions into RPC parameters", async () => {
  const rpcCalls = [];
  const query = {
    select() { return this; },
    eq() { return this; },
    async maybeSingle() {
      return {
        data: {
          author_login: "outside-author",
          body: "Existing @MehmetVolkan",
          source_updated_at: "2026-08-16T12:00:00Z",
          mention_recipient_profile_ids: [],
          mention_recipients_initialized: false,
        },
        error: null,
      };
    },
  };
  const supabase = {
    from(table) {
      if (table === "profiles") {
        return {
          async select() {
            return {
              data: [
                { id: "sebastian", name: "Sebastian", github_login: "SebastianSchuetze" },
                { id: "volkan", name: "Volkan", github_login: "MehmetVolkan" },
              ],
              error: null,
            };
          },
        };
      }
      assert.equal(table, "task_external_comments");
      return query;
    },
    async rpc(name, params) {
      rpcCalls.push({ name, params });
      return { data: "applied", error: null };
    },
  };
  const store = processor.createSupabaseGitHubIssueCommentWebhookStore(supabase);
  await store.applyProjection("delivery-comment-1", "lock-token", {
    operation: "upsert",
    taskId: "task-1619",
    commentUpdatedAt: "2026-08-16T12:17:41Z",
    comment: {
      taskId: "task-1619",
      commentId: 5307392288,
      commentUpdatedAt: "2026-08-16T12:17:41Z",
      authorLogin: "SebastianSchuetze",
      authorAvatarUrl: "",
      body: "Current @MehmetVolkan.",
      htmlUrl: "https://github.com/example/comment",
      createdAt: "2026-08-16T12:17:41Z",
      importedAt: "2026-08-16T12:18:00Z",
    },
  });

  assert.equal(rpcCalls[0].name, "apply_github_issue_comment_webhook_projection_with_mentions");
  assert.deepEqual(rpcCalls[0].params.p_mention_recipient_profile_ids, ["volkan"]);
  assert.deepEqual(rpcCalls[0].params.p_baseline_mention_recipient_profile_ids, ["volkan"]);
  assert.equal(rpcCalls[0].params.p_baseline_source_updated_at, "2026-08-16T12:00:00Z");
});

test("the Supabase adapter surfaces profile and RPC failures for bounded webhook retry", async () => {
  function failingSupabase({ profileError = null, rpcError = null } = {}) {
    const externalQuery = {
      select() { return this; },
      eq() { return this; },
      async maybeSingle() { return { data: null, error: null }; },
    };
    return {
      from(table) {
        if (table === "profiles") {
          return {
            async select() {
              return { data: [], error: profileError };
            },
          };
        }
        return externalQuery;
      },
      async rpc() {
        return { data: null, error: rpcError };
      },
    };
  }
  const input = {
    operation: "upsert",
    taskId: "task-1619",
    commentUpdatedAt: "2026-08-16T12:17:41Z",
    comment: {
      taskId: "task-1619",
      commentId: 5307392288,
      commentUpdatedAt: "2026-08-16T12:17:41Z",
      authorLogin: "outside-author",
      authorAvatarUrl: "",
      body: "Hello @MehmetVolkan",
      htmlUrl: "https://github.com/example/comment",
      createdAt: "2026-08-16T12:17:41Z",
      importedAt: "2026-08-16T12:18:00Z",
    },
  };

  await assert.rejects(
    () => processor.createSupabaseGitHubIssueCommentWebhookStore(
      failingSupabase({ profileError: { message: "profiles unavailable" } }),
    ).applyProjection("delivery", "lock", input),
    /mention profiles could not be loaded: profiles unavailable/,
  );
  await assert.rejects(
    () => processor.createSupabaseGitHubIssueCommentWebhookStore(
      failingSupabase({ rpcError: { message: "rpc unavailable" } }),
    ).applyProjection("delivery", "lock", input),
    /projection could not be applied: rpc unavailable/,
  );
});

function claimedDelivery(overrides = {}) {
  return {
    deliveryId: "delivery-comment-1",
    action: "created",
    repositoryFullName: "findmydoc-platform/website",
    issueNumber: 1619,
    commentId: 5307392288,
    commentUpdatedAt: "2026-08-16T12:17:41Z",
    attempts: 1,
    ...overrides,
  };
}

function commentSnapshot(overrides = {}) {
  return {
    id: 5307392288,
    body: "Webhook comment",
    htmlUrl: "https://github.com/findmydoc-platform/website/issues/1619#issuecomment-5307392288",
    issueUrl: "https://api.github.com/repos/findmydoc-platform/website/issues/1619",
    createdAt: "2026-08-16T12:17:41Z",
    updatedAt: "2026-08-16T12:17:41Z",
    authorLogin: "SebastianSchuetze",
    authorAvatarUrl: "https://avatars.githubusercontent.com/u/1?v=4",
    ...overrides,
  };
}

function storeFixture({
  claimed = claimedDelivery(),
  task = { kind: "found", taskId: "task-1619" },
  localComment = false,
  projectionResult = "applied",
  finalizeResult = true,
} = {}) {
  const state = {
    claims: [],
    taskLookups: [],
    localCommentLookups: [],
    projections: [],
    finalizations: [],
  };
  const store = {
    async claim(deliveryId, lockToken) {
      state.claims.push({ deliveryId, lockToken });
      return claimed;
    },
    async resolveTask(repository, issueNumber) {
      state.taskLookups.push({ repository, issueNumber });
      return task;
    },
    async hasLocalComment(taskId, commentId) {
      state.localCommentLookups.push({ taskId, commentId });
      return localComment;
    },
    async applyProjection(deliveryId, lockToken, input) {
      state.projections.push({ deliveryId, lockToken, input });
      return projectionResult;
    },
    async finalize(deliveryId, lockToken, input) {
      state.finalizations.push({ deliveryId, lockToken, input });
      return finalizeResult;
    },
  };
  return { state, store };
}

test("a current GitHub comment is idempotently upserted into the external discussion", async () => {
  const fixture = storeFixture();
  const result = await processor.processGitHubIssueCommentWebhookDelivery({
    deliveryId: "delivery-comment-1",
    store: fixture.store,
    loadComment: async () => commentSnapshot(),
  });

  assert.deepEqual(result, { kind: "processed", reason: "comment_upserted" });
  assert.deepEqual(fixture.state.taskLookups, [{
    repository: "findmydoc-platform/website",
    issueNumber: 1619,
  }]);
  assert.equal(fixture.state.projections.length, 1);
  const projection = fixture.state.projections[0];
  assert.equal(projection.deliveryId, "delivery-comment-1");
  assert.deepEqual(projection.input, {
    operation: "upsert",
    taskId: "task-1619",
    commentUpdatedAt: "2026-08-16T12:17:41Z",
    comment: {
      taskId: "task-1619",
      commentId: 5307392288,
      commentUpdatedAt: "2026-08-16T12:17:41Z",
      authorLogin: "SebastianSchuetze",
      authorAvatarUrl: "https://avatars.githubusercontent.com/u/1?v=4",
      body: "Webhook comment",
      htmlUrl: "https://github.com/findmydoc-platform/website/issues/1619#issuecomment-5307392288",
      createdAt: "2026-08-16T12:17:41Z",
      importedAt: projection.input.comment.importedAt,
    },
  });
  assert.equal(Number.isNaN(Date.parse(projection.input.comment.importedAt)), false);
  assert.equal(fixture.state.finalizations[0].input.status, "processed");
  assert.equal(fixture.state.finalizations[0].input.statusReason, "comment_upserted");
});

test("a verified deleted event removes the external projection without a provider read", async () => {
  const fixture = storeFixture({ claimed: claimedDelivery({ action: "deleted" }) });
  let loadCalls = 0;
  const result = await processor.processGitHubIssueCommentWebhookDelivery({
    deliveryId: "delivery-comment-1",
    store: fixture.store,
    loadComment: async () => {
      loadCalls += 1;
      throw new MockGitHubApiError("missing", 404);
    },
  });

  assert.deepEqual(result, { kind: "processed", reason: "comment_removed" });
  assert.equal(loadCalls, 0);
  assert.deepEqual(fixture.state.projections[0].input, {
    operation: "delete",
    taskId: "task-1619",
    commentUpdatedAt: "2026-08-16T12:17:41Z",
  });
  assert.equal(fixture.state.finalizations[0].input.statusReason, "comment_removed");
});

test("a provider 404 on create or edit remains retryable and preserves projection", async () => {
  const absentProcessor = await importTestModule("src/lib/github-issue-comment-webhook.ts", {
    "server-only": {},
    "@/features/tasks/model/github-comment-delivery-policy": markerPolicy,
    "@/lib/mentions": mentions,
    "@/lib/github-comment-mention-snapshot": mentionSnapshots,
    "./github-app": {
      getGitHubAppInstallationToken: async () => "installation-token",
    },
    "./github": {
      getGitHubIssueComment: async () => {
        throw new MockGitHubApiError("missing", 404);
      },
      GitHubApiError: MockGitHubApiError,
      isGitHubIssueApiUrl: (value, issueNumber, repository) => (
        value === `https://api.github.com/repos/${repository}/issues/${issueNumber}`
      ),
    },
  });
  for (const action of ["created", "edited"]) {
    const fixture = storeFixture({ claimed: claimedDelivery({ action }) });
    const result = await absentProcessor.processGitHubIssueCommentWebhookDelivery({
      deliveryId: "delivery-comment-1",
      store: fixture.store,
    });

    assert.deepEqual(result, { kind: "retry_scheduled", reason: "projection_error" });
    assert.equal(fixture.state.projections.length, 0);
    assert.equal(fixture.state.finalizations[0].input.status, "retry_scheduled");
    assert.match(fixture.state.finalizations[0].input.lastError, /missing/);
  }
});

test("an outbound FounderOps comment marker prevents a webhook write-back loop", async () => {
  const fixture = storeFixture({ localComment: true });
  const result = await processor.processGitHubIssueCommentWebhookDelivery({
    deliveryId: "delivery-comment-1",
    store: fixture.store,
    loadComment: async () => commentSnapshot({
      body: "Mirrored comment\n\n<!-- fmd-comment-id:77 -->",
    }),
  });

  assert.deepEqual(result, { kind: "ignored", reason: "app_mirrored_comment" });
  assert.deepEqual(fixture.state.localCommentLookups, [{ taskId: "task-1619", commentId: 77 }]);
  assert.deepEqual(fixture.state.projections[0].input, {
    operation: "suppress",
    taskId: "task-1619",
    commentUpdatedAt: "2026-08-16T12:17:41Z",
  });
  assert.equal(fixture.state.finalizations[0].input.status, "ignored");
});

test("a superseded comment snapshot is ignored without changing the projection", async () => {
  const fixture = storeFixture({ projectionResult: "stale" });
  const result = await processor.processGitHubIssueCommentWebhookDelivery({
    deliveryId: "delivery-comment-1",
    store: fixture.store,
    loadComment: async () => commentSnapshot(),
  });

  assert.deepEqual(result, { kind: "ignored", reason: "stale_comment_version" });
  assert.equal(fixture.state.projections.length, 1);
  assert.equal(fixture.state.finalizations[0].input.status, "ignored");
  assert.equal(fixture.state.finalizations[0].input.statusReason, "stale_comment_version");
});

test("an unknown Issue cannot create an external FounderOps comment", async () => {
  const fixture = storeFixture({ task: { kind: "missing" } });
  let loadCalls = 0;
  const result = await processor.processGitHubIssueCommentWebhookDelivery({
    deliveryId: "delivery-comment-1",
    store: fixture.store,
    loadComment: async () => {
      loadCalls += 1;
      return commentSnapshot();
    },
  });

  assert.deepEqual(result, { kind: "ignored", reason: "task_not_found" });
  assert.equal(loadCalls, 0);
  assert.equal(fixture.state.projections.length, 0);
});

test("ambiguous task identity fails closed without loading or storing comment content", async () => {
  const fixture = storeFixture({ task: { kind: "ambiguous" } });
  let loadCalls = 0;
  const result = await processor.processGitHubIssueCommentWebhookDelivery({
    deliveryId: "delivery-comment-1",
    store: fixture.store,
    loadComment: async () => {
      loadCalls += 1;
      return commentSnapshot();
    },
  });

  assert.deepEqual(result, { kind: "failed", reason: "ambiguous_task_mapping" });
  assert.equal(loadCalls, 0);
  assert.equal(fixture.state.projections.length, 0);
  assert.equal(fixture.state.finalizations[0].input.statusReason, "ambiguous_task_mapping");
});

test("a mismatched GitHub comment identity schedules a bounded retry", async () => {
  const fixture = storeFixture();
  const result = await processor.processGitHubIssueCommentWebhookDelivery({
    deliveryId: "delivery-comment-1",
    store: fixture.store,
    loadComment: async () => commentSnapshot({
      issueUrl: "https://api.github.com/repos/findmydoc-platform/website/issues/1620",
    }),
  });

  assert.deepEqual(result, { kind: "retry_scheduled", reason: "projection_error" });
  assert.equal(fixture.state.projections.length, 0);
  assert.equal(fixture.state.finalizations[0].input.status, "retry_scheduled");
  assert.equal(fixture.state.finalizations[0].input.statusReason, "projection_error");
  assert.match(fixture.state.finalizations[0].input.lastError, /identity does not match/);
  assert.equal(Number.isNaN(Date.parse(fixture.state.finalizations[0].input.availableAt)), false);
});

test("the fifth failed attempt becomes terminal and an already-final delivery is skipped", async () => {
  const terminalFixture = storeFixture({ claimed: claimedDelivery({ attempts: 5 }) });
  const terminal = await processor.processGitHubIssueCommentWebhookDelivery({
    deliveryId: "delivery-comment-1",
    store: terminalFixture.store,
    loadComment: async () => {
      throw new Error("GitHub unavailable");
    },
  });
  assert.deepEqual(terminal, { kind: "failed", reason: "projection_error" });
  assert.equal(terminalFixture.state.finalizations[0].input.status, "failed");
  assert.equal(terminalFixture.state.finalizations[0].input.availableAt, undefined);

  const skippedFixture = storeFixture({ claimed: null });
  const skipped = await processor.processGitHubIssueCommentWebhookDelivery({
    deliveryId: "delivery-comment-1",
    store: skippedFixture.store,
    loadComment: async () => commentSnapshot(),
  });
  assert.deepEqual(skipped, { kind: "skipped" });
  assert.equal(skippedFixture.state.taskLookups.length, 0);
  assert.equal(skippedFixture.state.finalizations.length, 0);
});
