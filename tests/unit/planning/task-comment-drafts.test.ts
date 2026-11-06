import { expect, test } from "vitest";
import { createPlanningState } from "@/features/planning/model/internal/planning-state-owner";
import { emptyPlanningShellState } from "@/features/planning/model/planning-shell-state";
import { taskDetailStoryTask } from "@/features/tasks/molecules/task-detail-story-fixtures";

const first = taskDetailStoryTask({ id: "first" });
const second = taskDetailStoryTask({ id: "second" });
function fixture() {
  return createPlanningState({
    userId: "draft-account",
    initialData: { ...emptyPlanningShellState, tasks: [first, second] },
    adapter: { readWorkspace: async () => null, saveTask: async () => ({ task: {} }) },
  });
}

test("returning to an item restores only that item's current unsent comment", () => {
  const { planning } = fixture();
  planning.taskCommentDraft(first.id).update("First item draft");
  expect(planning.taskCommentDraft(second.id).text).toBe("");
  planning.taskCommentDraft(second.id).update("Second item draft");
  expect(planning.taskCommentDraft(first.id).text).toBe("First item draft");
  expect(planning.taskCommentDraft(second.id).text).toBe("Second item draft");
});

test("a completed submission clears its unchanged draft while leaving another item untouched", () => {
  const { planning } = fixture();
  planning.taskCommentDraft(first.id).update("Submitted text");
  planning.taskCommentDraft(second.id).update("Other item draft");
  planning.taskCommentDraft(first.id).clear();
  expect(planning.taskCommentDraft(first.id).text).toBe("");
  expect(planning.taskCommentDraft(second.id).text).toBe("Other item draft");
});

test.each(["Newer unsent text", "Submitted text"])("an older submission cannot clear a newer draft containing %s", text => {
  const { planning } = fixture();
  planning.taskCommentDraft(first.id).update("Submitted text");
  const submitted = planning.taskCommentDraft(first.id);
  planning.taskCommentDraft(first.id).update("");
  planning.taskCommentDraft(first.id).update(text);
  submitted.clear();
  expect(planning.taskCommentDraft(first.id).text).toBe(text);
});

test.each([null, "replacement-account"])("ending or replacing the account with %s clears drafts and rejects retained callbacks", account => {
  const owner = fixture();
  owner.planning.taskCommentDraft(first.id).update("Protected draft");
  const retained = owner.planning.taskCommentDraft(first.id);
  owner.internal.sessionChanged(account);
  retained.update("Late protected edit");
  retained.clear();
  expect(owner.planning.taskCommentDraft(first.id).text).toBe("");
  const replacement = fixture();
  replacement.planning.taskCommentDraft(first.id).update("Replacement draft");
  retained.update("Old owner callback");
  expect(replacement.planning.taskCommentDraft(first.id).text).toBe("Replacement draft");
});

test("a fresh planning owner never restores unsent drafts", () => {
  const previous = fixture();
  previous.planning.taskCommentDraft(first.id).update("Unsent before reload");
  const reloaded = fixture();
  expect(reloaded.planning.taskCommentDraft(first.id).text).toBe("");
});

test("same-account protected-state reset prevents an old composer from changing the new session draft", () => {
  const owner = fixture();
  owner.planning.taskCommentDraft(first.id).update("Previous session draft");
  const retained = owner.planning.taskCommentDraft(first.id);
  owner.internal.suspendProtected();
  owner.internal.acceptHydration({ ...emptyPlanningShellState, tasks: [first] }, "draft-account");
  expect(owner.planning.taskCommentDraft(first.id).text).toBe("");
  owner.planning.taskCommentDraft(first.id).update("Current session draft");
  retained.update("Stale composer update");
  retained.clear();
  expect(owner.planning.taskCommentDraft(first.id).text).toBe("Current session draft");
});

test("an expired session hides drafts and rejects callbacks from its composer", () => {
  let now = 0;
  const owner = createPlanningState({
    userId: "draft-account",
    initialSession: { userId: "draft-account", revision: "session", expiresAt: 1, user: { id: "draft-account" } },
    initialData: { ...emptyPlanningShellState, tasks: [first] },
    adapter: { now: () => now, readWorkspace: async () => null, saveTask: async () => ({ task: {} }) },
  });
  owner.planning.taskCommentDraft(first.id).update("Expires with session");
  const retained = owner.planning.taskCommentDraft(first.id);
  now = 1000;
  expect(owner.planning.taskCommentDraft(first.id).text).toBe("");
  retained.update("Late edit");
  expect(owner.planning.taskCommentDraft(first.id).text).toBe("");
});

test("a denied item cannot expose or change its retained draft", async () => {
  const owner = createPlanningState({
    userId: "draft-account", initialData: { ...emptyPlanningShellState, tasks: [first] },
    adapter: { readWorkspace: async () => null, saveTask: async () => ({ task: {} }), readTaskDetail: async () => { throw Object.assign(new Error("Denied"), { status: 403 }); } },
  });
  owner.planning.taskCommentDraft(first.id).update("Protected item text");
  const retained = owner.planning.taskCommentDraft(first.id);
  await owner.planning.loadTaskDetail(first.id);
  retained.update("Late edit");
  expect(owner.planning.taskCommentDraft(first.id).text).toBe("");
  expect(owner.planning.taskCommentDraft("unknown-item").text).toBe("");
});
