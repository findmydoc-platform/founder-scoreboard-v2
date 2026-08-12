import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { loadTranspiledModule } from "./helpers/transpile-module.mjs";

const { sprintWorkspaceReducer } = await loadTranspiledModule("src/features/sprint/model/sprint-read-model.ts");

test("Sprint reducer keeps updates inside the focused slice", () => {
  const model = {
    revision: "one",
    project: { id: "project" },
    people: [{ id: "person" }],
    items: [{ id: "item", sprintId: "sprint", scoreFinal: false, status: "Offen" }],
    sprints: [{ id: "sprint", status: "active", scoreLocked: false }],
    commitments: [],
    scores: [],
    strikeStates: [],
    strikeEvents: [],
    objections: [],
    meetings: [],
    attendance: [],
  };
  const patched = sprintWorkspaceReducer(model, { type: "itemPatched", itemId: "item", patch: { status: "Review" } });
  assert.equal(patched.items[0].status, "Review");
  assert.equal(patched.people, model.people);
  assert.equal(patched.sprints, model.sprints);

  const locked = sprintWorkspaceReducer(patched, { type: "sprintLocked", sprintId: "sprint" });
  assert.equal(locked.sprints[0].scoreLocked, true);
  assert.equal(locked.items[0].scoreFinal, true);
});

test("Sprint uses one focused reader and no global PlanningShellState scope", async () => {
  const [page, reader, overview, adapter, client] = await Promise.all([
    readFile("src/app/(workspaces)/workspace-page.tsx", "utf8"),
    readFile("src/features/sprint/model/sprint-read-model.ts", "utf8"),
    readFile("src/features/sprint/organisms/sprint-score-overview.tsx", "utf8"),
    readFile("src/features/sprint/model/sprint-planning-shell-projection.ts", "utf8"),
    readFile("src/features/planning/model/planning-api-client.ts", "utf8"),
  ]);
  assert.match(page, /createSupabaseSprintReadModel/);
  assert.match(page, /initialSprintModel/);
  assert.match(reader, /interface SprintReadModel[\s\S]*load\(/);
  assert.doesNotMatch(reader, /PlanningShellState|server\//);
  assert.match(overview, /useReducer\(sprintWorkspaceReducer, initialModel\)/);
  assert.match(adapter, /sprintWorkspaceModelToPlanningShellState/);
  assert.match(client, /requestSprintWorkspaceData/);
  await assert.rejects(() => readFile("src/lib/planning-data-scopes.ts", "utf8"), /ENOENT/);
});

test("Sprint reader has a deterministic bounded query contract", async () => {
  const source = await readFile("src/features/sprint/server/sprint-read-model-supabase.ts", "utf8");
  for (const table of [
    "sprints", "sprint_commitments", "founder_sprint_scores", "founder_strike_state",
    "strike_events", "score_objections", "meetings", "meeting_attendance",
  ]) assert.match(source, new RegExp(`from\\(\"${table}\"\\)`));
  assert.match(source, /founder_sprint_scores[\s\S]*limit\(500\)/);
  assert.match(source, /score_objections[\s\S]*limit\(300\)/);
  assert.match(source, /meeting_attendance[\s\S]*limit\(300\)/);
  assert.doesNotMatch(source, /notification_|task_comments|task_relationship/);
});
