import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("modal dialog delegates global layering and background state to the shared stack", async () => {
  const source = await readFile("src/shared/hooks/use-modal-dialog.ts", "utf8");

  assert.match(source, /registerModal\(dialog\)/);
  assert.match(source, /unregisterModal\(dialog\)/);
  assert.match(source, /if \(!wasTopModal\) return/);
  assert.match(source, /returnTarget\?\.isConnected/);
});

test("only the top-most modal handles escape and tab navigation", async () => {
  const source = await readFile("src/shared/hooks/use-modal-dialog.ts", "utf8");

  assert.match(source, /button:not\(\[disabled\]\):not\(\[tabindex='-1'\]\)/);
  assert.match(source, /if \(!isTopModal\(dialog\)\) return/);
  assert.match(source, /dialog\?\.querySelector\("\[aria-expanded='true'\]"\)/);
  assert.match(source, /returnTarget\?\.isConnected && !returnTarget\.closest\("\[inert\]"\)/);
  assert.match(source, /nextTopModal\?\.isConnected/);
});
