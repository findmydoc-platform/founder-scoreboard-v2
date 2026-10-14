import assert from "node:assert/strict";
import { test } from "vitest";

const matrixModel = await import("../../../src/features/team-workweek/model/team-workweek-matrix.ts");

function profiles(count) {
  const roles = ["ceo", "founder", "deputy", "viewer"];
  return Array.from({ length: count }, (_, index) => ({
    id: `profile-${index}`,
    name: `Profile ${index}`,
    platformRole: roles[index % roles.length],
  }));
}

test("team-workweek projections include arbitrary team sizes and every platform role", () => {
  for (const count of [1, 4, 5, 7]) {
    const team = profiles(count);
    const projected = matrixModel.teamWorkweekProfiles(team);
    assert.equal(projected.length, count);
    assert.deepEqual(new Set(projected.map((profile) => profile.id)), new Set(team.map((profile) => profile.id)));
    assert.equal(projected[0].platformRole, "ceo");
  }
});
