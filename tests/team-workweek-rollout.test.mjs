import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { loadTranspiledModule } from "./helpers/transpile-module.mjs";

const rolloutModel = await import("../src/features/team-workweek/model/team-workweek-rollout.ts");
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

test("the starter switch is server-only, fail-closed, and role-bounded", async () => {
  const [envExample, rollout, headerData] = await Promise.all([
    readFile(".env.example", "utf8"),
    readFile("src/features/team-workweek/server/team-workweek-rollout.ts", "utf8"),
    readFile("src/lib/planning-header-data.ts", "utf8"),
  ]);

  assert.equal(rolloutModel.isTeamWorkweekStarterEnabled(undefined), false);
  assert.equal(rolloutModel.isTeamWorkweekStarterEnabled("false"), false);
  assert.equal(rolloutModel.isTeamWorkweekStarterEnabled("true"), true);
  assert.equal(rolloutModel.isStarterPlatformRole("ceo"), true);
  assert.equal(rolloutModel.isStarterPlatformRole("founder"), true);
  assert.equal(rolloutModel.isStarterPlatformRole("deputy"), false);
  assert.equal(rolloutModel.isStarterPlatformRole("viewer"), false);
  assert.equal(rolloutModel.TEAM_WORKWEEK_STARTER_SIZE, 5);
  assert.match(envExample, /FOUNDEROPS_TEAM_WORKWEEK_STARTER_ENABLED=false/);
  assert.doesNotMatch(envExample, /NEXT_PUBLIC_FOUNDEROPS_TEAM_WORKWEEK/);
  assert.match(rollout, /profileIds\.length !== TEAM_WORKWEEK_STARTER_SIZE/);
  assert.match(headerData, /process\.env\.FOUNDEROPS_TEAM_WORKWEEK_STARTER_ENABLED/);
});

test("the disabled starter stops before database or provider work", async () => {
  const previousValue = process.env.FOUNDEROPS_TEAM_WORKWEEK_STARTER_ENABLED;
  process.env.FOUNDEROPS_TEAM_WORKWEEK_STARTER_ENABLED = "false";
  let databaseCalls = 0;

  try {
    await assert.rejects(
      rolloutServer.requireTeamWorkweekStarterAccess({
        actorProfileId: "sebastian",
        actorRole: "ceo",
        serviceSupabase: {
          from() {
            databaseCalls += 1;
            throw new Error("database must not be reached");
          },
        },
      }),
      (error) => error instanceof rolloutServer.TeamWorkweekRolloutError && error.code === "disabled",
    );
    assert.equal(databaseCalls, 0);
  } finally {
    if (previousValue === undefined) delete process.env.FOUNDEROPS_TEAM_WORKWEEK_STARTER_ENABLED;
    else process.env.FOUNDEROPS_TEAM_WORKWEEK_STARTER_ENABLED = previousValue;
  }
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

test("disabled UI removes both the global and detailed team-workweek surfaces", async () => {
  const [header, renderer, team] = await Promise.all([
    readFile("src/features/planning/organisms/planning-header.tsx", "utf8"),
    readFile("src/features/planning/organisms/planning-workspace-renderer.tsx", "utf8"),
    readFile("src/features/team/organisms/team-overview.tsx", "utf8"),
  ]);

  assert.match(header, /headerData\.capabilities\.teamWorkweekStarter[\s\S]*isStarterPlatformRole/);
  assert.match(header, /teamWorkweek=\{teamWorkweekStarterEnabled \?/);
  assert.match(renderer, /teamWorkweekStarterEnabled=\{headerData\.capabilities\.teamWorkweekStarter/);
  assert.match(team, /teamWorkweekStarterEnabled && actualProfile/);
  assert.match(team, /teamWorkweekStarterEnabled && <PublishedTeamWorkweeksCard/);
});
