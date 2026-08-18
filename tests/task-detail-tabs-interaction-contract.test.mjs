import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";
import test from "node:test";

const tabs = await readFile("src/features/tasks/molecules/task-detail-tabs.tsx", "utf8");

test("task detail tabs do not scroll the page when a pointer focuses a tab", () => {
  const focusHandler = tabs.match(/onFocus=\{\(\) => \{([\s\S]*?)\}\}/)?.[1] || "";

  assert.match(focusHandler, /setFocusedValue\(tabValue\)/);
  assert.doesNotMatch(focusHandler, /scrollIntoView|scrollTo/);
  assert.doesNotMatch(tabs, /\.scrollIntoView\(/);
});

test("task detail tabs preserve keyboard navigation without viewport scrolling", () => {
  assert.match(tabs, /event\.key === "ArrowLeft"/);
  assert.match(tabs, /event\.key === "ArrowRight"/);
  assert.match(tabs, /event\.key === "Home"/);
  assert.match(tabs, /event\.key === "End"/);
  assert.match(tabs, /event\.key === "Enter"/);
  assert.match(tabs, /tab\?\.focus\(\{ preventScroll: true \}\)/);
  assert.match(tabs, /tabList\.scrollTo\(/);
});

test("activity tab provides a stable product-tour anchor", () => {
  assert.match(tabs, /data-tour-id=\{tabValue === "activity" \? "task-detail-tab-activity" : undefined\}/);
});
