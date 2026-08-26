import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { loadTranspiledModule } from "./helpers/transpile-module.mjs";

const rolloutModel = await import("../src/features/team-workweek/model/team-workweek-rollout.ts");
const matrixModel = await import("../src/features/team-workweek/model/team-workweek-matrix.ts");
const rolloutServer = await loadTranspiledModule(
  "src/features/team-workweek/server/team-workweek-rollout.ts",
  {
    "server-only": {},
    "../model/team-workweek-rollout": rolloutModel,
  },
);

const gatedRoutes = [
  "src/app/api/google-workspace/status/route.ts",
  "src/app/api/google-workspace/disconnect/route.ts",
  "src/app/api/team-workweek/private-draft/route.ts",
  "src/app/api/team-workweek/publish/route.ts",
  "src/app/api/team-workweek/reconcile/route.ts",
  "src/app/api/team-workweek/conflict/route.ts",
  "src/app/api/team-workweek/team/route.ts",
];

test("team-workweek access stays role-bounded to the exact five operating profiles", async () => {
  const [envExample, rollout, headerData] = await Promise.all([
    readFile(".env.example", "utf8"),
    readFile("src/features/team-workweek/server/team-workweek-rollout.ts", "utf8"),
    readFile("src/lib/planning-header-data.ts", "utf8"),
  ]);

  assert.equal(rolloutModel.isStarterPlatformRole("ceo"), true);
  assert.equal(rolloutModel.isStarterPlatformRole("founder"), true);
  assert.equal(rolloutModel.isStarterPlatformRole("deputy"), false);
  assert.equal(rolloutModel.isStarterPlatformRole("viewer"), false);
  assert.equal(rolloutModel.TEAM_WORKWEEK_STARTER_SIZE, 5);
  const starterProfiles = [
    { id: "ceo", platformRole: "ceo" },
    ...Array.from({ length: 4 }, (_, index) => ({ id: `founder-${index}`, platformRole: "founder" })),
    { id: "viewer", platformRole: "viewer" },
  ];
  assert.equal(matrixModel.isTeamWorkweekStarterProfile(starterProfiles, starterProfiles[0]), true);
  assert.equal(matrixModel.isTeamWorkweekStarterProfile(starterProfiles.slice(0, 4), starterProfiles[0]), false);
  assert.equal(matrixModel.isTeamWorkweekStarterProfile(starterProfiles, starterProfiles.at(-1)), false);
  assert.doesNotMatch(envExample, /FOUNDEROPS_TEAM_WORKWEEK_STARTER_ENABLED/);
  assert.match(rollout, /profileIds\.length !== TEAM_WORKWEEK_STARTER_SIZE/);
  assert.doesNotMatch(rollout, /process\.env|disabled/);
  assert.doesNotMatch(headerData, /teamWorkweekStarter|FOUNDEROPS_TEAM_WORKWEEK_STARTER_ENABLED/);
});

test("wrong roles stop before the exact-profile database check", async () => {
  let databaseCalls = 0;
  await assert.rejects(
    rolloutServer.requireTeamWorkweekStarterAccess({
      actorProfileId: "deputy",
      actorRole: "deputy",
      serviceSupabase: {
        from() {
          databaseCalls += 1;
          throw new Error("database must not be reached");
        },
      },
    }),
    (error) => error instanceof rolloutServer.TeamWorkweekRolloutError && error.code === "forbidden",
  );
  assert.equal(databaseCalls, 0);
  assert.throws(() => rolloutServer.requireExactStarter(["1", "2", "3", "4"]), (error) => error.code === "configuration");
  assert.doesNotThrow(() => rolloutServer.requireExactStarter(["1", "2", "3", "4", "5"]));
});

test("all owner, team-read, OAuth, and reconciliation entry points stop at the server gate", async () => {
  for (const file of gatedRoutes) {
    const source = await readFile(file, "utf8");
    const handlerCount = source.match(/export async function (?:GET|POST)/g)?.length || 0;
    const gateCount = source.match(/requireTeamWorkweekStarterApiAccess\(/g)?.length || 0;
    assert.equal(gateCount, handlerCount, `${file} must gate every handler`);
  }

  const [connect, callback] = await Promise.all([
    readFile("src/app/api/google-workspace/connect/route.ts", "utf8"),
    readFile("src/app/api/google-workspace/callback/route.ts", "utf8"),
  ]);
  for (const source of [connect, callback]) {
    assert.match(source, /requireTeamWorkweekStarterApiAccess/);
    assert.match(source, /\["ceo", "founder"\]/);
    assert.doesNotMatch(source, /\["ceo", "founder", "deputy"\]/);
  }
  assert.match(callback, /requireTeamWorkweekStarterApiAccess[\s\S]*exchangeGoogleWorkspaceCode/);
});

test("role-bound UI exposes team-workweek surfaces without a deployment switch", async () => {
  const [shell, header, renderer, team] = await Promise.all([
    readFile("src/features/planning/templates/planning-app-shell.tsx", "utf8"),
    readFile("src/features/planning/organisms/planning-header.tsx", "utf8"),
    readFile("src/features/planning/organisms/planning-workspace-renderer.tsx", "utf8"),
    readFile("src/features/team/organisms/team-overview.tsx", "utf8"),
  ]);

  assert.doesNotMatch(shell, /teamWorkweekStarter|featureAvailability/);
  assert.match(header, /teamWorkweekAvailable = isTeamWorkweekStarterProfile/);
  assert.match(header, /apiClient: teamWorkweekAvailable \? controller\.apiClient : undefined/);
  assert.match(renderer, /teamWorkweekAvailable=\{isTeamWorkweekStarterProfile/);
  assert.match(team, /teamWorkweekAvailable && actualProfile/);
  assert.match(team, /teamWorkweekAvailable && <PublishedTeamWorkweeksCard/);
});
