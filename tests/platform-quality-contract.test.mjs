import { readFile } from "node:fs/promises";
import { readdir, stat } from "node:fs/promises";
import test from "node:test";
import assert from "node:assert/strict";

const atomicFeatureDirs = ["atoms", "molecules", "organisms", "templates", "hooks", "model"];
const approvedNativeControlFiles = new Set([
  "src/shared/atoms/custom-select.tsx",
  "src/shared/atoms/custom-date-picker.tsx",
]);

async function pathExists(path) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function listFiles(dir, extension) {
  const entries = await readdir(dir);
  const nested = await Promise.all(entries.map(async (entry) => {
    const fullPath = `${dir}/${entry}`;
    const info = await stat(fullPath);
    if (info.isDirectory()) return listFiles(fullPath, extension);
    return fullPath.endsWith(extension) ? [fullPath] : [];
  }));

  return nested.flat();
}

async function listFilesByExtensions(dir, extensions) {
  const fileGroups = await Promise.all([...extensions].map((extension) => listFiles(dir, extension)));
  return fileGroups.flat().sort();
}

test("planning UI keeps feature-first atomic structure", async () => {
  const features = (await readdir("src/features")).sort();
  const allowedFeatureDirs = new Set(atomicFeatureDirs);

  assert.ok(features.length > 0);
  assert.equal(await pathExists("src/components"), false);
  assert.equal(await pathExists("src/hooks"), false);

  for (const feature of features) {
    const featurePath = `src/features/${feature}`;
    const info = await stat(featurePath);
    if (!info.isDirectory()) continue;

    const featureEntries = await readdir(featurePath, { withFileTypes: true });
    for (const entry of featureEntries) {
      if (!entry.isDirectory()) continue;
      assert.equal(
        allowedFeatureDirs.has(entry.name),
        true,
        `${featurePath}/${entry.name} is not an approved feature-first layer`,
      );
    }
  }
});

test("planning UI does not import legacy global component or hook paths", async () => {
  const files = await listFilesByExtensions("src", new Set([".ts", ".tsx"]));
  const violations = [];

  for (const file of files) {
    const source = await readFile(file, "utf8");
    if (/(?:from\s+|import\s*\(\s*)["']@\/components(?:\/|["'])/.test(source)) {
      violations.push(`${file}: @/components`);
    }
    if (/(?:from\s+|import\s*\(\s*)["']@\/hooks(?:\/|["'])/.test(source)) {
      violations.push(`${file}: @/hooks`);
    }
    if (/(?:from\s+|import\s*\(\s*)["']src\/components(?:\/|["'])/.test(source)) {
      violations.push(`${file}: src/components`);
    }
    if (/(?:from\s+|import\s*\(\s*)["']src\/hooks(?:\/|["'])/.test(source)) {
      violations.push(`${file}: src/hooks`);
    }
  }

  assert.deepEqual(violations, []);
});

test("app UI uses custom dropdown and calendar controls", async () => {
  const files = await listFiles("src", ".tsx");
  const violations = [];

  for (const file of files) {
    if (approvedNativeControlFiles.has(file)) continue;
    const source = await readFile(file, "utf8");

    if (
      /<select\b/.test(source)
      || /<\/select>/.test(source)
      || /<option\b/.test(source)
      || /type=["']date["']/.test(source)
      || /type=["']datetime-local["']/.test(source)
    ) {
      violations.push(file);
    }
  }

  assert.deepEqual(violations, []);
});

test("api routes centralize single-error responses", async () => {
  const helper = await readFile("src/lib/api-response.ts", "utf8");
  const routeFiles = await listFiles("src/app/api", ".ts");
  const directSingleErrorResponses = [];
  let helperRouteCount = 0;
  let jsonContextUseCount = 0;
  let setupContextUseCount = 0;

  assert.match(helper, /export function apiError/);
  assert.match(helper, /export function authzError/);
  assert.match(helper, /export function supabaseUnavailable/);
  assert.match(helper, /export async function requireApiContext/);
  assert.match(helper, /export async function readJsonPayload/);
  assert.match(helper, /export async function requireJsonApiContext/);

  for (const file of routeFiles) {
    const source = await readFile(file, "utf8");
    if (source.includes("@/lib/api-response")) helperRouteCount += 1;
    jsonContextUseCount += (source.match(/requireJsonApiContext(?:<|\()/g) || []).length;
    setupContextUseCount += (source.match(/requireApiContext\(/g) || []).length;

    const matches = source.match(/NextResponse\.json\(\{ error: [^,\n{}]+ \}, \{ status: [^{}\n]+ \}\)/g) || [];
    for (const match of matches) {
      directSingleErrorResponses.push(`${file}: ${match}`);
    }
  }

  assert.ok(helperRouteCount >= 35);
  assert.ok(jsonContextUseCount >= 20);
  assert.ok(setupContextUseCount >= 8);
  assert.deepEqual(directSingleErrorResponses, []);
});

test("representative api routes share setup without weakening route guards", async () => {
  const migratedRoutes = [
    "src/app/api/notification-preferences/route.ts",
    "src/app/api/focus/route.ts",
    "src/app/api/sprint-commitments/route.ts",
  ];

  for (const file of migratedRoutes) {
    const source = await readFile(file, "utf8");

    assert.match(source, /requireJsonApiContext<[^>]+>\(request, requirePlanningContributor, \{\}\)/, `${file} should pass its existing founder guard to the shared setup helper`);
    assert.doesNotMatch(source, /getServerSupabase\(\)/, `${file} should not repeat Supabase setup`);
    assert.doesNotMatch(source, /authzError\(permission\)/, `${file} should not repeat authorization error mapping`);
    assert.doesNotMatch(source, /supabaseUnavailable\(\)/, `${file} should not repeat Supabase availability errors`);
  }
});

test("custom controls keep keyboard and aria contracts", async () => {
  const select = await readFile("src/shared/atoms/custom-select.tsx", "utf8");
  const datePicker = await readFile("src/shared/atoms/custom-date-picker.tsx", "utf8");

  assert.match(select, /role="listbox"/);
  assert.match(select, /role="option"/);
  assert.match(select, /aria-activedescendant/);
  assert.match(select, /ArrowDown/);
  assert.match(select, /ArrowUp/);
  assert.match(select, /Home/);
  assert.match(select, /End/);
  assert.match(select, /Enter/);
  assert.match(select, /Escape/);
  assert.match(select, /optionRefs/);

  assert.match(datePicker, /role="dialog"/);
  assert.match(datePicker, /role="grid"/);
  assert.match(datePicker, /role="gridcell"/);
  assert.match(datePicker, /aria-selected/);
  assert.match(datePicker, /ArrowDown/);
  assert.match(datePicker, /ArrowUp/);
  assert.match(datePicker, /PageDown/);
  assert.match(datePicker, /PageUp/);
  assert.match(datePicker, /lastDayOfTargetMonth/);
  assert.doesNotMatch(datePicker, /Math\.min\(date\.getDate\(\), 28\)/);
  assert.match(datePicker, /Heute/);
  assert.match(datePicker, /Löschen/);
  assert.match(datePicker, /dayRefs/);
  assert.match(datePicker, /normalizeTimePart/);
  assert.match(datePicker, /const \[timeDraft, setTimeDraft\]/);
  assert.match(datePicker, /onBlur=\{commitTime\}/);
  assert.match(datePicker, /aria-invalid=\{Boolean\(timeError\)\}/);
  assert.doesNotMatch(datePicker, /onChange=\{\(event\) => changeTime/);
});

test("modal dialogs trap focus close on Escape and restore the trigger", async () => {
  const modalHook = await readFile("src/shared/hooks/use-modal-dialog.ts", "utf8");
  const dialogFiles = [
    "src/features/tasks/organisms/new-task-dialog.tsx",
    "src/features/projects/organisms/initiative-dialog.tsx",
    "src/features/team/organisms/team-profile-edit-dialog.tsx",
    "src/features/tools/molecules/fmd-quick-link-dialog.tsx",
    "src/features/tasks/organisms/task-github-sync-queue.tsx",
    "src/features/tasks/organisms/task-detail-panel.tsx",
  ];

  assert.match(modalHook, /focusableSelector/);
  assert.match(modalHook, /event\.key === "Escape"/);
  assert.match(modalHook, /event\.key !== "Tab"/);
  assert.match(modalHook, /returnTarget\?\.isConnected/);
  assert.match(modalHook, /returnTarget\.focus\(\)/);

  for (const file of dialogFiles) {
    const source = await readFile(file, "utf8");
    assert.match(source, /useModalDialog/);
    assert.match(source, /role="dialog"/);
    assert.match(source, /aria-modal="true"/);
    assert.match(source, /tabIndex=\{-1\}/);
  }
});

test("badge tone policy stays semantic and primitive based", async () => {
  const status = await readFile("src/lib/status.ts", "utf8");
  const primitives = await readFile("src/shared/atoms/ui-primitives.tsx", "utf8");
  const taskCard = await readFile("src/features/tasks/molecules/task-card.tsx", "utf8");
  const taskDetailPanelHeader = await readFile("src/features/tasks/molecules/task-detail-panel-header.tsx", "utf8");
  const notifications = await readFile("src/features/notifications/organisms/notification-inbox.tsx", "utf8");
  const sprintTables = await readFile("src/features/sprint/organisms/sprint-task-tables.tsx", "utf8");

  assert.match(primitives, /export type UiTone/);
  assert.match(primitives, /sky:/);
  assert.match(status, /statusBadgeTone/);
  assert.match(status, /priorityBadgeTone/);
  assert.doesNotMatch(status, /border-|bg-|text-/);
  assert.match(taskCard, /UiBadge/);
  assert.match(taskCard, /statusBadgeTone/);
  assert.doesNotMatch(taskDetailPanelHeader, /statusBadgeTone|priorityBadgeTone/);
  assert.match(notifications, /notificationBadgeTone/);
  assert.match(notifications, /UiBadge/);
  assert.match(sprintTables, /UiBadge/);
  assert.doesNotMatch(`${taskCard}\n${taskDetailPanelHeader}\n${notifications}\n${sprintTables}`, /statusTone|priorityTone|notificationTone/);
});

test("shared data surfaces centralize table shells without domain columns", async () => {
  const dataSurface = await readFile("src/shared/molecules/data-surface.tsx", "utf8");
  const migratedFiles = [
    "src/features/sprint/organisms/sprint-task-tables.tsx",
    "src/features/sprint/organisms/sprint-founder-score-table.tsx",
    "src/features/sprint/molecules/sprint-meeting-attendance-section.tsx",
    "src/features/tasks/organisms/task-table-view.tsx",
    "src/features/tasks/organisms/task-structure-view.tsx",
    "src/features/tasks/organisms/gantt-view.tsx",
  ];

  assert.match(dataSurface, /export function DataSurface/);
  assert.match(dataSurface, /export function DataOverflow/);
  assert.match(dataSurface, /export function DataTable/);
  assert.match(dataSurface, /export function DataHeaderCell/);
  assert.match(dataSurface, /export function DataCell/);
  assert.match(dataSurface, /export function DataEmptyRow/);
  assert.doesNotMatch(dataSurface, /TaskStatus|SprintStatus|reviewStatus|packageId|ownerId/);

  for (const file of migratedFiles) {
    const source = await readFile(file, "utf8");
    assert.match(source, /DataSurface/, `${file} should use shared data surface shell`);
  }
});

test("visible German app copy keeps real UTF-8 umlauts", async () => {
  const files = [
    ...(await listFiles("src", ".tsx")),
    ...(await listFiles("docs", ".md")),
    "README.md",
    "AGENTS.md",
  ];
  const suspiciousFallbacks = /\b(fuer|zurueck|waehlen|loeschen|naechst|koennen|moech|groess|schliess|Ueber|Aender|Oeff)\b/;

  for (const file of files) {
    const source = await readFile(file, "utf8");
    assert.doesNotMatch(source, suspiciousFallbacks, `${file} contains likely ASCII umlaut fallback in visible copy`);
  }
});

test("german utf8 guard verifies persisted task text", async () => {
  const pkg = await readFile("package.json", "utf8");
  const script = await readFile("scripts/verify-task-utf8.mjs", "utf8");
  const skill = await readFile(".agents/skills/fmd-german-utf8/SKILL.md", "utf8");
  const storySkill = await readFile(".agents/skills/fmd-story-writing/SKILL.md", "utf8");
  const rules = await readFile("AGENTS.md", "utf8");

  assert.match(pkg, /verify:task-utf8/);
  assert.match(script, /BROKEN_WORD_QUESTION_MARK/);
  assert.match(script, /MOJIBAKE/);
  assert.match(script, /Supabase/);
  assert.match(skill, /f\?r/);
  assert.match(skill, /U\+00C3/);
  assert.match(skill, /pnpm run verify:task-utf8/);
  assert.match(storySkill, /pnpm run verify:task-utf8/);
  assert.match(rules, /fmd-german-utf8/);
  assert.match(rules, /Supabase or GitHub/);
  assert.match(rules, /pnpm run verify:task-utf8/);
});

test("agent rules and stewardship skill document atomic UI drift guards", async () => {
  const rules = await readFile("AGENTS.md", "utf8");
  const skill = await readFile(".agents/skills/fmd-code-stewardship/SKILL.md", "utf8");
  const audit = await readFile("scripts/code-stewardship-audit.mjs", "utf8");

  assert.match(rules, /Planning UI Structure/);
  assert.match(rules, /src\/features\/<domain>\/\{atoms,molecules,organisms,templates,hooks,model\}/);
  assert.match(rules, /Create only the subdirectories a feature currently uses/);
  assert.match(rules, /Do not create new `src\/components` or `src\/hooks` directories/);
  assert.match(rules, /fmd-code-stewardship/);
  assert.match(skill, /Feature-first Atomic Design/);
  assert.match(skill, /Do not keep empty placeholder directories or commit `.gitkeep` files/);
  assert.match(skill, /compatibility re-export shims/);
  assert.match(skill, /use-planning-app-controller\.ts/);
  assert.match(audit, /FORBIDDEN_STRUCTURE_DIRECTORIES/);
  assert.match(audit, /LEGACY_IMPORT_PATTERNS/);
  assert.match(audit, /NATIVE_CONTROL_PATTERNS/);
});
