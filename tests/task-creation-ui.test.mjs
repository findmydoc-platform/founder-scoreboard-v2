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

test("Sub-Issue creation exposes only the compact work-step fields", async () => {
  const dialog = await readFile(new URL("src/features/tasks/organisms/new-task-dialog.tsx", root), "utf8");
  const subIssueForm = dialog.slice(dialog.indexOf("function SubIssueForm"), dialog.indexOf("export function NewTaskDialog"));

  assert.match(subIssueForm, /Übergeordnetes Deliverable/);
  assert.match(subIssueForm, /Initiative, Epic und Freigabe werden vom Parent-Deliverable übernommen/);
  assert.match(subIssueForm, /Zuständig/);
  assert.match(subIssueForm, /Kontext/);
  assert.match(subIssueForm, /GitHub-Repository/);
  assert.match(subIssueForm, /<RelationshipFields/);
  assert.doesNotMatch(subIssueForm, /Weitere Optionen|<details|<summary/);
  assert.doesNotMatch(subIssueForm, /<PlanningFields/);
  assert.doesNotMatch(subIssueForm, /<TaskBriefFields/);
  assert.doesNotMatch(subIssueForm, /<ResponsibilityFields/);
});
