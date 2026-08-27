import assert from "node:assert/strict";
import { test } from "vitest";

const matrixModel = await import("../../../src/features/team-workweek/model/team-workweek-matrix.ts");
const viewStateModel = await import("../../../src/features/team-workweek/model/team-workweek-view-state.ts");

const profiles = [
  { id: "ceo", name: "CEO", platformRole: "ceo" },
  { id: "founder-1", name: "Founder 1", platformRole: "founder" },
  { id: "founder-2", name: "Founder 2", platformRole: "founder" },
  { id: "founder-3", name: "Founder 3", platformRole: "founder" },
  { id: "founder-4", name: "Founder 4", platformRole: "founder" },
  { id: "deputy", name: "Deputy", platformRole: "deputy" },
  { id: "viewer", name: "Viewer", platformRole: "viewer" },
];

function workweek(ownerProfileId, phase, id) {
  return { id, ownerProfileId, phase };
}

test("the matrix keeps every team profile and only each active publication", () => {
  const current = workweek("founder-1", "current", "current-1");
  const rows = matrixModel.projectActiveTeamWorkweekRows(profiles, [
    workweek("founder-1", "prepared", "prepared-1"),
    current,
    workweek("deputy", "current", "current-deputy"),
  ]);

  assert.deepEqual(rows.map(({ profile }) => profile.id), ["ceo", "founder-1", "founder-2", "founder-3", "founder-4", "deputy", "viewer"]);
  assert.equal(rows.length, 7);
  assert.equal(rows.find(({ profile }) => profile.id === "founder-1")?.workweek, current);
  assert.equal(rows.find(({ profile }) => profile.id === "founder-2")?.workweek, null);
  assert.equal(rows.find(({ profile }) => profile.id === "deputy")?.workweek?.id, "current-deputy");
});

test("team detail distinguishes unknown, empty, current, and stale successful data", () => {
  const resolve = viewStateModel.resolvePublishedTeamWorkweekViewState;

  assert.equal(resolve({ hasLoadedSuccessfully: false, message: "", pending: true, workweekCount: 0 }), "loading");
  assert.equal(resolve({ hasLoadedSuccessfully: false, message: "offline", pending: false, workweekCount: 0 }), "initial-error");
  assert.equal(resolve({ hasLoadedSuccessfully: true, message: "", pending: false, workweekCount: 0 }), "empty");
  assert.equal(resolve({ hasLoadedSuccessfully: true, message: "", pending: false, workweekCount: 2 }), "matrix");
  assert.equal(resolve({ hasLoadedSuccessfully: true, message: "offline", pending: false, workweekCount: 2 }), "stale-matrix");
});
