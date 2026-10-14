import assert from "node:assert/strict";
import { test } from "vitest";
import { importTestModule } from "../../helpers/vitest-module.mjs";

test("task share messages cover every issue type with a stable FounderOps link", async () => {
  const share = await importTestModule("src/features/tasks/model/task-share-message.ts");
  const taskUrl = share.buildTaskShareUrl("deliverable-42", "https://founder-ops.findmydoc.eu");
  const message = share.buildTaskShareMessage({
    title: "Contact-404 beheben",
    taskType: "deliverable",
    status: "Offen",
    priority: "P0",
    fixedDate: "2026-06-04",
    targetDate: "",
    approvalStatus: "approved",
    reviewStatus: "not_requested",
  }, taskUrl);

  assert.equal(taskUrl, "https://founder-ops.findmydoc.eu/tasks/deliverable-42");
  assert.match(message, /^Contact-404 beheben/m);
  assert.match(message, /Deliverable · Offen · P0 · Fixtermin: 04\.06\.2026/);
  assert.match(message, /Bitte ansehen und bei Bedarf kurz Rückmeldung geben\./);
  assert.match(message, /https:\/\/founder-ops\.findmydoc\.eu\/tasks\/deliverable-42/);
  assert.equal(share.taskShareTypeLabel("sub_issue"), "Sub-Issue");
  assert.match(share.buildTaskShareMessage({
    title: "Sprint-Ziel",
    taskType: "sub_issue",
    status: "In Arbeit",
    priority: "P2",
    fixedDate: "",
    targetDate: "",
    approvalStatus: null,
    reviewStatus: "not_requested",
  }, taskUrl), /Sub-Issue · In Arbeit · P2/);
});

test("task share requests reflect proposal and active review states", async () => {
  const share = await importTestModule("src/features/tasks/model/task-share-message.ts");
  const taskUrl = "https://founder-ops.findmydoc.eu/tasks/deliverable-42";
  const baseTask = {
    title: "Contact-404 beheben",
    taskType: "deliverable",
    status: "Offen",
    priority: "P0",
    fixedDate: "2026-06-04",
    targetDate: "",
    approvalStatus: "approved",
    reviewStatus: "not_requested",
  };

  assert.match(share.buildTaskShareMessage({
    ...baseTask,
    approvalStatus: "proposed",
  }, taskUrl), /Bitte den Vorschlag prüfen und bei Zustimmung freigeben, damit er eingeplant werden kann\./);

  assert.match(share.buildTaskShareMessage({
    ...baseTask,
    approvalStatus: null,
  }, taskUrl), /Bitte den Vorschlag prüfen und bei Zustimmung freigeben, damit er eingeplant werden kann\./);

  assert.match(share.buildTaskShareMessage({
    ...baseTask,
    approvalStatus: "proposed",
    reviewStatus: "requested",
  }, taskUrl), /Bitte prüfen und den Review freigeben\./);
});
