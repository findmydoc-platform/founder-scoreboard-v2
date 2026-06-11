import { readFile } from "node:fs/promises";
import { readdir, stat } from "node:fs/promises";
import test from "node:test";
import assert from "node:assert/strict";

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

test("app UI uses custom dropdown and calendar controls", async () => {
  const files = await listFiles("src", ".tsx");
  const approved = new Set([
    "src/components/custom-select.tsx",
    "src/components/custom-date-picker.tsx",
  ]);

  for (const file of files) {
    if (approved.has(file)) continue;
    const source = await readFile(file, "utf8");

    assert.doesNotMatch(source, /<select\b/);
    assert.doesNotMatch(source, /<\/select>/);
    assert.doesNotMatch(source, /<option\b/);
    assert.doesNotMatch(source, /type=["']date["']/);
    assert.doesNotMatch(source, /type=["']datetime-local["']/);
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

test("app choice controls use custom components instead of browser-native pickers", async () => {
  const files = (await listFiles("src", ".tsx")).filter((file) => ![
    "src/components/custom-select.tsx",
    "src/components/custom-date-picker.tsx",
  ].includes(file));
  const violations = [];

  for (const file of files) {
    const source = await readFile(file, "utf8");
    if (
      source.includes("<select")
      || source.includes("<option")
      || source.includes('type="date"')
      || source.includes('type="datetime-local"')
    ) {
      violations.push(file);
    }
  }

  assert.deepEqual(violations, []);
});
