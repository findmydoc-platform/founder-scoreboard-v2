import assert from "node:assert/strict";
import { test } from "vitest";
import { importTestModule } from "../../helpers/vitest-module.mjs";


test("the manual import adapter passes resolved mention snapshots to the atomic RPC", async () => {
  const mentions = await importTestModule("src/lib/mentions.ts");
  const snapshots = await importTestModule("src/lib/github-comment-mention-snapshot.ts", {
    "@/lib/mentions": mentions,
  });
  const adapter = await importTestModule("src/lib/github-comment-mention-import.ts", {
    "@supabase/supabase-js": {},
  });
  const snapshot = snapshots.resolveGitHubCommentMentionSnapshot({
    authorLogin: "outside-author",
    body: "Edited @MehmetVolkan.",
    profiles: [{ id: "volkan", name: "Volkan", githubLogin: "MehmetVolkan" }],
    existing: {
      authorLogin: "outside-author",
      body: "Historical @MehmetVolkan",
      sourceUpdatedAt: "2026-08-19T08:00:00Z",
      mentionRecipientProfileIds: [],
      mentionRecipientsInitialized: false,
    },
  });
  const comments = [{ externalId: "42", ...snapshot }];
  const calls = [];
  const supabase = {
    async rpc(name, params) {
      calls.push({ name, params });
      return { data: { imported: 0 }, error: null };
    },
  };

  await adapter.importGitHubTaskCommentsWithMentions(supabase, "task-42", comments);
  assert.deepEqual(calls, [{
    name: "import_github_task_comments_with_mentions",
    params: { p_task_id: "task-42", p_comments: comments },
  }]);
  assert.deepEqual(snapshot.mentionRecipientProfileIds, ["volkan"]);
  assert.deepEqual(snapshot.baselineMentionRecipientProfileIds, ["volkan"]);
});

test("task comment targets map notification IDs to timeline element IDs", async () => {
  const targets = await importTestModule("src/features/tasks/model/task-comment-target.ts");
  const target = targets.githubTaskCommentTarget("5307392288");
  assert.equal(target, "github:5307392288");
  assert.equal(targets.parseTaskCommentTarget(target), target);
  assert.equal(targets.taskCommentElementId(target), "task-comment-github:5307392288");
  assert.equal(targets.parseTaskCommentTarget("github:"), "");
});
