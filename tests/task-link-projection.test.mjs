import assert from "node:assert/strict";
import test from "node:test";
import { loadTranspiledModule } from "./helpers/transpile-module.mjs";

const { mapTaskRow } = await loadTranspiledModule("src/lib/planning-task-mappers.ts", {
  "./planning-profile-mappers": {
    profileNameById: (_profiles, profileId) => profileId || "",
  },
});

test("task mapping projects ordered evidence links and linked pull request metadata", () => {
  const task = mapTaskRow(
    {
      id: "task-1",
      title: "Evidence task",
      evidence_link: "https://legacy.example/proof",
    },
    new Map(),
    {
      taskLinks: [
        {
          id: 3,
          task_id: "task-1",
          type: "github_pull_request",
          label: "Close the loop",
          url: "https://github.com/findmydoc-platform/management/pull/88",
          position: 0,
          metadata: {
            repository: "findmydoc-platform/management",
            number: 88,
            status: "merged",
            mergedAt: "2026-07-24T12:00:00Z",
          },
        },
        {
          id: 2,
          task_id: "task-1",
          type: "evidence",
          label: "Second",
          url: "https://notion.so/second",
          position: 1,
          metadata: {},
        },
        {
          id: 1,
          task_id: "task-1",
          type: "evidence",
          label: "First",
          url: "https://github.com/findmydoc-platform/management/issues/1",
          position: 0,
          metadata: {},
        },
      ],
    },
  );

  assert.deepEqual(task.evidenceLinks, [
    "https://github.com/findmydoc-platform/management/issues/1",
    "https://notion.so/second",
  ]);
  assert.equal(task.evidenceLink, task.evidenceLinks[0]);
  assert.deepEqual(task.linkedPullRequests, [{
    title: "Close the loop",
    repository: "findmydoc-platform/management",
    number: 88,
    url: "https://github.com/findmydoc-platform/management/pull/88",
    status: "merged",
    mergedAt: "2026-07-24T12:00:00Z",
  }]);
});

test("legacy single evidence URL remains visible until migrated", () => {
  const task = mapTaskRow({
    id: "task-legacy",
    evidence_link: "https://legacy.example/proof",
  }, new Map());
  assert.deepEqual(task.evidenceLinks, ["https://legacy.example/proof"]);
  assert.equal(task.evidenceLink, "https://legacy.example/proof");
});
