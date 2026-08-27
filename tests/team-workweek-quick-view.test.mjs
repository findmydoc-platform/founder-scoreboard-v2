import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const matrixModel = await import("../src/features/team-workweek/model/team-workweek-matrix.ts");
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

test("the shared header calendar is read-only, responsive, and owns one Team navigation", async () => {
  const [actions, action, dialog, hook, matrix, modalStack, team, route] = await Promise.all([
    readFile("src/features/planning/molecules/planning-header-data-actions.tsx", "utf8"),
    readFile("src/features/planning/molecules/header-calendar-action.tsx", "utf8"),
    readFile("src/features/planning/organisms/header-calendar-dialog.tsx", "utf8"),
    readFile("src/features/planning/hooks/use-header-calendar.ts", "utf8"),
    readFile("src/features/team-workweek/molecules/team-workweek-matrix.tsx", "utf8"),
    readFile("src/shared/model/modal-stack.ts", "utf8"),
    readFile("src/features/team/organisms/team-overview.tsx", "utf8"),
    readFile("src/app/api/team-workweek/team/route.ts", "utf8"),
  ]);

  assert.match(actions, /HeaderCalendarAction/);
  assert.equal(actions.match(/HeaderCalendarAction/g)?.length, 2);
  assert.match(action, /data-tour-id="header-calendar-action"/);
  assert.match(action, /pointer:coarse/);
  assert.match(action, /createPortal[\s\S]*document\.body/);
  assert.match(action, /getBoundingClientRect/);
  assert.match(action, /rect\.bottom \+ 8/);
  assert.match(action, /const passiveCapture = \{ capture: true, passive: true \} as const/);
  assert.match(action, /window\.addEventListener\("scroll", updateAnchor, passiveCapture\)/);
  assert.doesNotMatch(action, /todayEventCount|9\+|unreadCount/);
  assert.match(action, /aria-label="Kalender öffnen"/);
  assert.doesNotMatch(action, /currentWorkers|Arbeitet jetzt/);
  assert.match(hook, /requestJson[\s\S]*\/api\/team-workweek\/team\?from=\$\{range\.from\}&to=\$\{range\.to\}/);
  assert.match(hook, /useEffect\(\(\) => \{\s*if \(!open\) return;[\s\S]*requestAnimationFrame\(\(\) => void loadVisibleRange\(\)\)/);
  assert.match(hook, /useState\(false\)/);
  assert.match(hook, /TEAM_WORKWEEK_PUBLISHED_EVENT/);
  assert.match(dialog, /useModalDialog<HTMLDivElement>/);
  assert.match(action, /restoreFocusRef=\{triggerRef\}/);
  assert.match(action, /matchMedia\("\(min-width: 1024px\)"\)/);
  assert.match(action, /desktopPopover=\{desktopPopover\}/);
  assert.match(dialog, /manageEnvironment: !desktopPopover/);
  assert.match(dialog, /aria-modal=\{desktopPopover \? undefined : "true"\}/);
  assert.match(dialog, /role="tablist"/);
  assert.match(dialog, /role="tabpanel"/);
  assert.match(dialog, /"Termine"/);
  assert.match(dialog, /"Arbeitswoche"/);
  assert.match(dialog, /ArrowRight/);
  assert.match(dialog, /PageUp/);
  assert.match(dialog, /PageDown/);
  assert.match(dialog, /footer className="flex shrink-0/);
  assert.match(dialog, /env\(safe-area-inset-top\)/);
  assert.match(dialog, /env\(safe-area-inset-bottom\)/);
  assert.match(dialog, /overscroll-contain/);
  assert.match(dialog, /--header-calendar-top/);
  assert.match(dialog, /lg:bg-transparent/);
  assert.match(dialog, /FounderOps-Termine/);
  assert.match(dialog, /Arbeitszeiten/);
  assert.match(dialog, /workingNow \?/);
  assert.match(dialog, /Aktualisierung verzögert/);
  assert.doesNotMatch(dialog, /Nächste Events/);
  assert.match(modalStack, /element\.inert = true/);
  assert.match(modalStack, /document\.body\.style\.overflow = "hidden"/);
  assert.equal(dialog.match(/>Im Team öffnen</g)?.length, 1);
  assert.doesNotMatch(dialog, /bearbeiten|veröffentlichen|Google abgleichen/i);
  assert.match(matrix, /TEAM_WORKWEEK_DAYS\.map/);
  assert.match(matrix, /DataOverflow/);
  assert.match(matrix, /minWidth=\{compact \? 840 : 1040\}/);
  assert.match(matrix, /w-40 border-r text-xs tracking-wide/);
  assert.match(matrix, /role="tablist"/);
  assert.match(matrix, /role="tabpanel"/);
  assert.match(matrix, /aria-controls=\{tabPanelId\}/);
  assert.match(matrix, /aria-label=\{day\.label\}/);
  assert.match(matrix, /grid-cols-7/);
  assert.match(matrix, /compact \? "lg:hidden" : "xl:hidden"/);
  assert.match(matrix, /compact \? "hidden lg:block" : "hidden xl:block"/);
  assert.match(matrix, /compact \? "sticky top-0 z-20 rounded-t-lg"/);
  assert.match(matrix, /compact \? "sticky top-11 z-10"/);
  assert.match(matrix, /ArrowRight/);
  assert.match(matrix, /ArrowLeft/);
  assert.match(matrix, />Frei</);
  assert.match(team, /TeamRoleSummary/);
  assert.match(team, /PrivateTeamWorkweekCard[\s\S]*actualProfile/);
  assert.match(team, /PublishedTeamWorkweeksCard/);
  assert.match(route, /\.eq\("status", "published"\)/);
  assert.match(route, /validateCalendarWorkweekRange/);
  assert.match(route, /calendarWorkweeks/);
  assert.doesNotMatch(route, /google_event_id|refresh_token|access_token|calendar_id/);
});
