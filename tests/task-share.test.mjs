import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { loadTranspiledModule } from "./helpers/transpile-module.mjs";

test("task share messages cover every issue type with a stable FounderOps link", async () => {
  const share = await loadTranspiledModule("src/features/tasks/model/task-share-message.ts");
  const taskUrl = share.buildTaskShareUrl("deliverable-42", "https://founder-ops.findmydoc.eu");
  const message = share.buildTaskShareMessage({
    title: "Contact-404 beheben",
    taskType: "deliverable",
    status: "Offen",
    priority: "P0",
    deadline: "2026-06-04",
  }, taskUrl);

  assert.equal(taskUrl, "https://founder-ops.findmydoc.eu/tasks/deliverable-42");
  assert.match(message, /^Contact-404 beheben/m);
  assert.match(message, /Deliverable · Offen · P0 · Ziel: 04\.06\.2026/);
  assert.match(message, /Bitte prüfen und kurz Rückmeldung geben:/);
  assert.match(message, /https:\/\/founder-ops\.findmydoc\.eu\/tasks\/deliverable-42/);
  assert.equal(share.taskShareTypeLabel("sub_issue"), "Sub-Issue");
  assert.match(share.buildTaskShareMessage({
    title: "Sprint-Ziel",
    taskType: "sub_issue",
    status: "In Arbeit",
    priority: "P2",
    deadline: "Sprint 1",
  }, taskUrl), /Ziel: Sprint 1/);
});

test("task share UI keeps copy feedback local and closes only after Google Chat opens", async () => {
  const popover = await readFile("src/features/tasks/molecules/task-share-popover.tsx", "utf8");
  const headerActions = await readFile("src/features/tasks/molecules/task-detail-header-actions.tsx", "utf8");

  assert.match(headerActions, /<TaskSharePopover task=\{task\} \/>/);
  assert.match(popover, /data-tour-id="task-share-trigger"/);
  assert.match(popover, /data-tour-id="task-share-popover"/);
  assert.match(popover, /Nachricht kopieren & Google Chat öffnen/);
  assert.match(popover, /const chatWindow = window\.open\("", "_blank"\)/);
  assert.match(popover, /chatWindow\.location\.replace\(googleChatUrl\)[^]*setOpen\(false\)/);
  assert.match(popover, /if \(!chatWindow\)[^]*setError\(/);
  assert.match(popover, /linkCopied \? "Link kopiert" : "Nur Link kopieren"/);
  assert.doesNotMatch(popover, /Kopiert · Google Chat geöffnet|wurde kopiert/);
});
