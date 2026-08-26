import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const matrixModel = await import("../src/features/team-workweek/model/team-workweek-matrix.ts");
const requestModel = await import("../src/features/team-workweek/model/latest-team-workweek-request.ts");
const viewStateModel = await import("../src/features/team-workweek/model/team-workweek-view-state.ts");

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

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

test("the starter matrix keeps all five operating profiles and only their active publication", () => {
  const current = workweek("founder-1", "current", "current-1");
  const rows = matrixModel.projectActiveTeamWorkweekRows(profiles, [
    workweek("founder-1", "prepared", "prepared-1"),
    current,
    workweek("deputy", "current", "current-deputy"),
  ]);

  assert.deepEqual(rows.map(({ profile }) => profile.id), ["ceo", "founder-1", "founder-2", "founder-3", "founder-4"]);
  assert.equal(rows.length, 5);
  assert.equal(rows.find(({ profile }) => profile.id === "founder-1")?.workweek, current);
  assert.equal(rows.find(({ profile }) => profile.id === "founder-2")?.workweek, null);
});

test("only the latest quick-view request can update visible data, errors, and pending state", async () => {
  const first = deferred();
  const second = deferred();
  const requests = [first.promise, second.promise];
  const outcomes = [];
  const runner = requestModel.createLatestTeamWorkweekRequestRunner({
    load: () => requests.shift(),
    onError: (error) => outcomes.push(["error", error.message]),
    onSettled: () => outcomes.push(["settled"]),
    onStart: () => outcomes.push(["started"]),
    onSuccess: (value) => outcomes.push(["success", value]),
  });

  const firstRun = runner.run();
  const secondRun = runner.run();
  second.resolve("fresh");
  await secondRun;
  first.reject(new Error("stale failure"));
  await firstRun;

  assert.deepEqual(outcomes, [
    ["started"],
    ["started"],
    ["success", "fresh"],
    ["settled"],
  ]);
});

test("team detail distinguishes unknown, empty, current, and stale successful data", () => {
  const resolve = viewStateModel.resolvePublishedTeamWorkweekViewState;

  assert.equal(resolve({ hasLoadedSuccessfully: false, message: "", pending: true, workweekCount: 0 }), "loading");
  assert.equal(resolve({ hasLoadedSuccessfully: false, message: "offline", pending: false, workweekCount: 0 }), "initial-error");
  assert.equal(resolve({ hasLoadedSuccessfully: true, message: "", pending: false, workweekCount: 0 }), "empty");
  assert.equal(resolve({ hasLoadedSuccessfully: true, message: "", pending: false, workweekCount: 2 }), "matrix");
  assert.equal(resolve({ hasLoadedSuccessfully: true, message: "offline", pending: false, workweekCount: 2 }), "stale-matrix");
});

test("the global quick view is read-only, modal, responsive, and owns one Team navigation", async () => {
  const [actions, action, dialog, hook, matrix, modalStack, team, route] = await Promise.all([
    readFile("src/features/planning/molecules/planning-header-data-actions.tsx", "utf8"),
    readFile("src/features/team-workweek/molecules/header-team-workweek-action.tsx", "utf8"),
    readFile("src/features/team-workweek/organisms/team-workweek-quick-view-dialog.tsx", "utf8"),
    readFile("src/features/team-workweek/hooks/use-team-workweek-quick-view.ts", "utf8"),
    readFile("src/features/team-workweek/molecules/team-workweek-matrix.tsx", "utf8"),
    readFile("src/shared/model/modal-stack.ts", "utf8"),
    readFile("src/features/team/organisms/team-overview.tsx", "utf8"),
    readFile("src/app/api/team-workweek/team/route.ts", "utf8"),
  ]);

  assert.match(actions, /HeaderTeamWorkweekAction/);
  assert.doesNotMatch(actions, /HeaderEventCalendar/);
  assert.match(action, /aria-label="Team-Arbeitswoche öffnen"/);
  assert.match(action, /pointer:coarse/);
  assert.match(action, /createPortal[\s\S]*document\.body/);
  assert.match(hook, /requestJson[\s\S]*\/api\/team-workweek\/team/);
  assert.match(hook, /setOpen\(true\)[\s\S]*void load\(\)/);
  assert.match(dialog, /useModalDialog<HTMLDivElement>/);
  assert.match(dialog, /aria-modal="true"/);
  assert.match(dialog, /header className="flex shrink-0/);
  assert.match(dialog, /footer className="flex shrink-0/);
  assert.match(modalStack, /element\.inert = true/);
  assert.match(modalStack, /document\.body\.style\.overflow = "hidden"/);
  assert.equal(dialog.match(/>Im Team öffnen</g)?.length, 1);
  assert.doesNotMatch(dialog, /bearbeiten|veröffentlichen|Google abgleichen/i);
  assert.match(matrix, /TEAM_WORKWEEK_DAYS\.map/);
  assert.match(matrix, /DataOverflow/);
  assert.match(matrix, /minWidth=\{compact \? 900 : 1040\}/);
  assert.match(matrix, />Frei</);
  assert.match(team, /TeamRoleSummary/);
  assert.match(team, /PrivateTeamWorkweekCard[\s\S]*actualProfile/);
  assert.match(team, /PublishedTeamWorkweeksCard/);
  assert.match(route, /\.eq\("status", "published"\)/);
  assert.doesNotMatch(route, /google_event_id|refresh_token|access_token|calendar_id/);
});
