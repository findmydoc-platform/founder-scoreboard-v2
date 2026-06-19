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
  assert.match(taskDetailPanelHeader, /UiBadge/);
  assert.match(taskDetailPanelHeader, /priorityBadgeTone/);
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
  assert.match(skill, /npm run verify:task-utf8/);
  assert.match(storySkill, /npm run verify:task-utf8/);
  assert.match(rules, /fmd-german-utf8/);
  assert.match(rules, /Supabase or GitHub/);
  assert.match(rules, /npm run verify:task-utf8/);
});

test("agent rules and stewardship skill document atomic UI drift guards", async () => {
  const rules = await readFile("AGENTS.md", "utf8");
  const skill = await readFile(".agents/skills/fmd-code-stewardship/SKILL.md", "utf8");
  const audit = await readFile("scripts/code-stewardship-audit.mjs", "utf8");

  assert.match(rules, /Planning UI Structure/);
  assert.match(rules, /src\/features\/<domain>\/\{atoms,molecules,organisms,templates,hooks,model\}/);
  assert.match(rules, /Do not create new `src\/components` or `src\/hooks` directories/);
  assert.match(rules, /fmd-code-stewardship/);
  assert.match(skill, /Feature-first Atomic Design/);
  assert.match(skill, /compatibility re-export shims/);
  assert.match(skill, /use-planning-app-controller\.ts/);
  assert.match(audit, /FORBIDDEN_STRUCTURE_DIRECTORIES/);
  assert.match(audit, /LEGACY_IMPORT_PATTERNS/);
  assert.match(audit, /NATIVE_CONTROL_PATTERNS/);
});
