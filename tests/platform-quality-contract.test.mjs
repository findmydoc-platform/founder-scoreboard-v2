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

  assert.ok(features.length > 0);
  assert.equal(await pathExists("src/components"), false);
  assert.equal(await pathExists("src/hooks"), false);

  for (const feature of features) {
    const featurePath = `src/features/${feature}`;
    const info = await stat(featurePath);
    if (!info.isDirectory()) continue;

    for (const dir of atomicFeatureDirs) {
      assert.equal(
        await pathExists(`${featurePath}/${dir}`),
        true,
        `${featurePath} must keep ${dir}`,
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
