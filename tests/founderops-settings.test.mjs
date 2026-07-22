import assert from "node:assert/strict";
import test from "node:test";
import { loadTranspiledModule } from "./helpers/transpile-module.mjs";

const settingsState = await loadTranspiledModule(
  "src/features/settings/model/founderops-settings-state.ts",
  {
    "@/lib/sprint-review-window": {
      sprintReviewDueAt: (endDate, hours) => `${endDate}:${hours}`,
    },
  },
);

test("FounderOps settings merge the server result without touching locked sprints", () => {
  const lockedSprint = {
    id: "locked",
    endDate: "2026-07-31",
    reviewDueAt: "locked-deadline",
    scoreLocked: true,
  };
  const data = {
    project: { id: "project", reviewObjectionWindowHours: 48 },
    sprints: [
      { id: "open", endDate: "2026-07-31", reviewDueAt: "old-deadline", scoreLocked: false },
      lockedSprint,
    ],
  };

  const merged = settingsState.applyReviewWindowHours(data, 72, [
    { id: "open", reviewDueAt: "server-deadline" },
  ]);

  assert.equal(merged.project.reviewObjectionWindowHours, 72);
  assert.equal(merged.sprints[0].reviewDueAt, "server-deadline");
  assert.equal(merged.sprints[1], lockedSprint);
});

test("FounderOps settings derive only missing unlocked deadlines", () => {
  const data = {
    project: { id: "project", reviewObjectionWindowHours: 48 },
    sprints: [
      { id: "open", endDate: "2026-07-31", reviewDueAt: "old-deadline", scoreLocked: false },
    ],
  };

  const merged = settingsState.applyReviewWindowHours(data, 96);

  assert.equal(merged.sprints[0].reviewDueAt, "2026-07-31:96");
});

test("FounderOps settings replace only the GitHub Project target", () => {
  const data = {
    project: {
      id: "project",
      githubProjectOwner: "findmydoc-platform",
      githubProjectNumber: 21,
      reviewObjectionWindowHours: 48,
    },
    sprints: [],
  };

  const merged = settingsState.applyGitHubProjectSettings(data, "another-org", 7);

  assert.equal(merged.project.githubProjectOwner, "another-org");
  assert.equal(merged.project.githubProjectNumber, 7);
  assert.equal(merged.project.reviewObjectionWindowHours, 48);
});
