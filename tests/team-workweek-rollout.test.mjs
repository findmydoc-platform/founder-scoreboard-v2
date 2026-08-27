import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const matrixModel = await import("../src/features/team-workweek/model/team-workweek-matrix.ts");

const teamMemberRoutes = [
  "src/app/api/google-workspace/status/route.ts",
  "src/app/api/google-workspace/disconnect/route.ts",
  "src/app/api/team-workweek/private-draft/route.ts",
  "src/app/api/team-workweek/publish/route.ts",
  "src/app/api/team-workweek/reconcile/route.ts",
  "src/app/api/team-workweek/conflict/route.ts",
  "src/app/api/team-workweek/team/route.ts",
];

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

test("all team-workweek API entry points use the mapped-team-member guard without a starter gate", async () => {
  for (const file of teamMemberRoutes) {
    const source = await readFile(file, "utf8");
    const handlerCount = source.match(/export async function (?:GET|POST)/g)?.length || 0;
    const guardCount = source.match(/requireApiContext\(request, requireTeamMember\)/g)?.length || 0;
    assert.equal(guardCount, handlerCount, `${file} must guard every handler`);
    assert.doesNotMatch(source, /TeamWorkweekStarter|team-workweek-rollout|requirePlanningContributor/);
  }

  const [connect, callback] = await Promise.all([
    readFile("src/app/api/google-workspace/connect/route.ts", "utf8"),
    readFile("src/app/api/google-workspace/callback/route.ts", "utf8"),
  ]);
  for (const source of [connect, callback]) {
    assert.match(source, /getServerPlanningAuth\(\["ceo", "founder", "deputy", "viewer"\]\)/);
    assert.doesNotMatch(source, /TeamWorkweekStarter|team-workweek-rollout/);
  }
  assert.match(callback, /getServerServiceRoleSupabase[\s\S]*exchangeGoogleWorkspaceCode/);
});

test("all mapped profiles receive the workweek UI while edits stay bound to the actual profile", async () => {
  const [header, renderer, team, connectionCard] = await Promise.all([
    readFile("src/features/planning/organisms/planning-header.tsx", "utf8"),
    readFile("src/features/planning/organisms/planning-workspace-renderer.tsx", "utf8"),
    readFile("src/features/team/organisms/team-overview.tsx", "utf8"),
    readFile("src/features/team-workweek/molecules/google-workspace-connection-card.tsx", "utf8"),
  ]);

  assert.match(header, /apiClient: actualProfile \? controller\.apiClient : undefined/);
  assert.doesNotMatch(header, /teamWorkweekAvailable|Starter/);
  assert.doesNotMatch(renderer, /teamWorkweekAvailable|Starter/);
  assert.match(team, /actualProfile && \([\s\S]*<PrivateTeamWorkweekCard/);
  assert.match(team, /actualProfile && <PublishedTeamWorkweeksCard/);
  assert.doesNotMatch(team, /teamWorkweekAvailable|Starter/);
  assert.doesNotMatch(connectionCard, /platformRole|Viewer können|canConnect/);
});
