import assert from "node:assert/strict";
import { test } from "vitest";
import { importTestModule } from "../../helpers/vitest-module.mjs";

let reviewTaskRequest = async () => ({ response: { ok: true }, body: {} });

const { useReviewCommands } = await importTestModule("src/features/reviews/hooks/use-review-commands.ts", {
  "@/features/tasks/model/task-api-client": {
    reviewTaskRequest: (...args) => reviewTaskRequest(...args),
    withdrawTaskReviewRequest: async () => ({ response: { ok: true }, body: {} }),
    reopenTaskReviewRequest: async () => ({ response: { ok: true }, body: {} }),
  },
  "@/features/reviews/model/task-review-state": {
    reviewDecisionTaskState: () => ({ status: "Erledigt", scoreFinal: true }),
  },
  "@/lib/platform": { hasGitHubIssue: () => false },
});
const createReviewCommands = useReviewCommands;

function fixture() {
  let data = {
    tasks: [{ id: "task-1", status: "Review", reviewStatus: "requested", reviewRequestedAt: "2026-09-13T10:00:00.000Z" }],
    taskReviews: [],
  };
  const errors = [];
  return {
    errors,
    getData: () => data,
    commands: createReviewCommands({
      apiClient: {},
      githubInstallationAvailable: false,
      setData: (update) => {
        data = typeof update === "function" ? update(data) : update;
      },
      setSaveError: (value) => errors.push(value),
      startTransition: (callback) => {
        void callback();
      },
      syncTaskToGitHub: () => undefined,
    }),
  };
}

test("a transparently recovered review request completes without asking for another submit", async () => {
  reviewTaskRequest = async () => ({
    response: { ok: true, status: 200 },
    body: {
      task: { id: "task-1", status: "Erledigt", reviewStatus: "accepted" },
      review: { id: "review-1", taskId: "task-1", decision: "accepted" },
    },
  });
  const current = fixture();
  const completed = await current.commands.reviewTask(
    current.getData().tasks[0],
    "accepted",
    10,
    { acceptanceCriteriaMet: true, evidenceProvided: true, communicationClear: true, blockerHandled: true },
    "",
  );

  assert.equal(completed, true);
  assert.equal(current.getData().tasks[0].reviewStatus, "accepted");
  assert.deepEqual(current.errors, [""]);
});
