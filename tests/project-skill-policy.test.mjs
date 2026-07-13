import assert from "node:assert/strict";
import { access, readFile, readdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repositoryRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const projectSkillsRoot = join(repositoryRoot, ".agents", "skills");
const approvedSkills = ["release-publish", "supabase-migrations"];

async function pathExists(path) {
  return access(path).then(() => true, () => false);
}

test("project skills are limited to the approved operational workflows", async () => {
  const entries = await readdir(projectSkillsRoot, { withFileTypes: true });
  const directories = entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();

  assert.deepEqual(directories, approvedSkills);
  assert.equal(await pathExists(join(repositoryRoot, "skills")), false);

  for (const directory of directories) {
    const source = await readFile(join(projectSkillsRoot, directory, "SKILL.md"), "utf8");
    const frontmatter = source.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n/);

    assert.ok(frontmatter, `${directory} must contain YAML frontmatter`);

    const fields = frontmatter[1]
      .split(/\r?\n/)
      .filter((line) => /^[a-z][a-z0-9_-]*\s*:/.test(line))
      .map((line) => line.slice(0, line.indexOf(":")))
      .sort();
    const name = frontmatter[1].match(/^name:\s*["']?([^\r\n"']+)["']?\s*$/m)?.[1];
    const bodyLineCount = source.slice(frontmatter[0].length).split(/\r?\n/).length;

    assert.deepEqual(fields, ["description", "name"], `${directory} frontmatter must contain only name and description`);
    assert.equal(name, directory, `${directory} must match its frontmatter name`);
    assert.ok(bodyLineCount <= 200, `${directory} body exceeds 200 lines`);
  }
});
