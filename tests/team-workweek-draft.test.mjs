import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const model = await import("../src/features/team-workweek/model/team-workweek-draft.ts");

function draft(effectiveFrom = "2026-08-31") {
  return { effectiveFrom, windows: model.emptyTeamWorkweekWindows() };
}

test("the default is always the next Europe/Berlin Monday", () => {
  assert.equal(model.nextMondayIso(new Date("2026-08-24T10:00:00.000Z")), "2026-08-31");
  assert.equal(model.nextMondayIso(new Date("2026-08-30T10:00:00.000Z")), "2026-08-31");
  assert.equal(model.nextMondayIso(new Date("2026-03-29T00:30:00.000Z")), "2026-03-30");
});

test("the mobile workweek defaults to the current Europe/Berlin weekday", () => {
  assert.equal(model.currentTeamWorkweekDayKey(new Date("2026-08-24T10:00:00.000Z")), "monday");
  assert.equal(model.currentTeamWorkweekDayKey(new Date("2026-08-30T10:00:00.000Z")), "sunday");
});

test("later versions default to the first Monday after the latest published boundary", () => {
  assert.equal(model.nextVersionMondayIso(null, new Date("2026-08-25T10:00:00.000Z")), "2026-08-31");
  assert.equal(model.nextVersionMondayIso("2026-08-31", new Date("2026-08-25T10:00:00.000Z")), "2026-09-07");
  assert.equal(model.nextVersionMondayIso("2026-09-14", new Date("2026-08-25T10:00:00.000Z")), "2026-09-21");
  assert.equal(
    model.validatePrivateTeamWorkweekDraft(draft("2026-09-07"), new Date("2026-08-25T10:00:00.000Z"), "2026-09-14").ok,
    false,
  );
});

test("free days and multiple non-overlapping windows form a valid private draft", () => {
  const value = draft();
  value.windows.monday = [
    { start: "09:00", end: "12:00" },
    { start: "13:00", end: "17:30" },
  ];
  value.windows.friday = [{ start: "08:15", end: "12:00" }];
  const result = model.validatePrivateTeamWorkweekDraft(value, new Date("2026-08-25T10:00:00.000Z"));
  assert.equal(result.ok, true);
  assert.equal(result.draft.windows.tuesday.length, 0);
  assert.deepEqual(model.flattenTeamWorkweekWindows(result.draft.windows), [
    { weekday: 1, startMinute: 540, endMinute: 720 },
    { weekday: 1, startMinute: 780, endMinute: 1050 },
    { weekday: 5, startMinute: 495, endMinute: 720 },
  ]);
});

test("draft validation rejects overlap, invalid bounds, past dates, and target injection", () => {
  const overlapping = draft();
  overlapping.windows.monday = [
    { start: "09:00", end: "12:00" },
    { start: "11:59", end: "13:00" },
  ];
  assert.match(
    model.validatePrivateTeamWorkweekDraft(overlapping, new Date("2026-08-25T10:00:00.000Z")).errors.join(" "),
    /nicht überschneiden/,
  );

  const invalid = draft("2026-08-24");
  invalid.profileId = "another-profile";
  invalid.windows.tuesday = [{ start: "17:00", end: "09:00" }];
  invalid.windows.sunday = [{ start: "00:00", end: "24:00" }];
  const result = model.validatePrivateTeamWorkweekDraft(invalid, new Date("2026-08-25T10:00:00.000Z"));
  assert.equal(result.ok, false);
  assert.match(result.errors.join(" "), /nicht unterstützte Felder/);
  assert.match(result.errors.join(" "), /nicht rückwirkend/);
  assert.match(result.errors.join(" "), /Beginn muss vor Ende/);
  assert.throws(() => model.clockForMinute(1440), /inside one civil day/);
});

test("inflation restores every day and preserves ordered wall-clock windows", () => {
  const windows = model.inflateTeamWorkweekWindows([
    { weekday: 1, start_minute: 780, end_minute: 1020 },
    { weekday: 1, start_minute: 540, end_minute: 720 },
    { weekday: 7, start_minute: 0, end_minute: 1439 },
  ]);
  assert.deepEqual(windows.monday, [
    { start: "09:00", end: "12:00" },
    { start: "13:00", end: "17:00" },
  ]);
  assert.deepEqual(windows.sunday, [{ start: "00:00", end: "23:59" }]);
  assert.deepEqual(windows.wednesday, []);
});



test("API uses the bearer session for RLS and accepts no profile or calendar target", () => {
  const route = readFileSync("src/app/api/team-workweek/private-draft/route.ts", "utf8");
  assert.match(route, /requireApiContext\(request, requirePlanningContributor\)/);
  assert.match(route, /bearerToken\(request\)/);
  assert.match(route, /getSupabaseForToken\(token\)/);
  assert.match(route, /create_private_team_workweek_version/);
  assert.doesNotMatch(route, /getServerServiceRoleSupabase|p_owner_profile_id|input\.profileId|input\.calendarId/);
  assert.doesNotMatch(route, /googleapis|google-workspace/);
});

test("editor exposes the complete private workflow and protects unsaved changes", () => {
  const hook = readFileSync("src/features/team-workweek/hooks/use-private-team-workweek.ts", "utf8");
  const editor = readFileSync("src/features/team-workweek/organisms/private-team-workweek-editor.tsx", "utf8");
  const card = readFileSync("src/features/team-workweek/molecules/private-team-workweek-card.tsx", "utf8");
  const team = readFileSync("src/features/team/organisms/team-overview.tsx", "utf8");
  const renderer = readFileSync("src/features/planning/organisms/planning-workspace-renderer.tsx", "utf8");
  assert.match(editor, /Privat · nicht veröffentlicht/);
  assert.match(editor, /GoogleWorkspaceConnectionCard/);
  assert.match(editor, /Gültigkeitsbeginn/);
  assert.match(editor, /TEAM_WORKWEEK_DAYS\.map/);
  assert.match(editor, /type="time"/);
  assert.match(editor, /aria-label=\{state\.draft\.windows\[day\.key\]\.length \? `\$\{day\.label\}: weiteres Fenster hinzufügen` : `\$\{day\.label\}: Fenster hinzufügen`\}/);
  assert.match(editor, /size="iconMd"/);
  assert.match(editor, /useModalDialog/);
  assert.match(editor, /TeamWorkweekDiscardDialog/);
  assert.match(hook, /beforeunload/);
  assert.match(hook, /validatePrivateTeamWorkweekDraft/);
  assert.match(hook, /useDevProfileOverride: false/);
  assert.match(card, /Grundwoche vorbereiten/);
  assert.match(card, /bestätigte Google-Synchronisierung/);
  assert.match(editor, /In Google & Team veröffentlichen/);
  assert.match(team, /teamWorkweekAvailable && actualProfile/);
  assert.match(renderer, /actualProfile=\{actualProfile\}/);
  assert.match(renderer, /isTeamWorkweekStarterProfile\(data\.profiles, currentProfile\)/);
});
