import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

test("task creation reveals accessible title errors only after interaction", async () => {
  const dialog = await readFile(new URL("src/features/tasks/organisms/new-task-dialog.tsx", root), "utf8");

  assert.match(dialog, /titleTouched \|\| submitAttempted/);
  assert.match(dialog, /onTitleBlur=\{\(\) => setTitleTouched\(true\)\}/);
  assert.match(dialog, /aria-invalid=\{titleError \? true : undefined\}/);
  assert.match(dialog, /aria-errormessage=\{titleError \? titleValidationId : undefined\}/);
  assert.match(dialog, /setSubmitAttempted\(true\)/);
  assert.doesNotMatch(dialog, /Titel braucht mindestens 3 Zeichen/);
});

test("Sub-Issue creation separates inherited RACI from task responsibility", async () => {
  const dialog = await readFile(new URL("src/features/tasks/organisms/new-task-dialog.tsx", root), "utf8");

  assert.match(dialog, /RACI-Kontext/);
  assert.match(dialog, /Vom Deliverable übernommen/);
  assert.match(dialog, /<SectionHeading accent=\{accent\}>Verantwortung<\/SectionHeading>/);
  assert.doesNotMatch(dialog, />RACI vom Deliverable</);
});
