import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("modal dialog locks document scroll and makes background branches inert", async () => {
  const source = await readFile("src/shared/hooks/use-modal-dialog.ts", "utf8");

  assert.match(source, /document\.body\.style\.overflow = "hidden"/);
  assert.match(source, /document\.body\.style\.overscrollBehavior = "none"/);
  assert.match(source, /document\.documentElement\.style\.overflow = "hidden"/);
  assert.match(source, /sibling\.inert = true/);
  assert.match(source, /document\.body\.style\.overflow = previousBodyOverflow/);
  assert.match(source, /document\.body\.style\.overscrollBehavior = previousOverscrollBehavior/);
  assert.match(source, /document\.documentElement\.style\.overflow = previousRootOverflow/);
  assert.match(source, /element\.inert = inert/);
  assert.match(source, /returnTarget\?\.isConnected/);
});

test("only the top-most modal handles escape and tab navigation", async () => {
  const source = await readFile("src/shared/hooks/use-modal-dialog.ts", "utf8");

  assert.match(source, /const modalStack: HTMLElement\[\] = \[\]/);
  assert.match(source, /button:not\(\[disabled\]\):not\(\[tabindex='-1'\]\)/);
  assert.match(source, /modalStack\.push\(dialog\)/);
  assert.match(source, /if \(!isTopModal\(dialog\)\) return/);
  assert.match(source, /dialog\?\.querySelector\("\[aria-expanded='true'\]"\)/);
  assert.match(source, /modalStack\.lastIndexOf\(dialog\)/);
  assert.match(source, /previousTopModal\.inert = true/);
  assert.ok(
    source.indexOf("for (const { element, inert } of inertSiblings)")
      < source.indexOf("previousTopModal.inert = previousTopModalInert"),
  );
  assert.match(source, /returnTarget\?\.isConnected && !returnTarget\.closest\("\[inert\]"\)/);
});
