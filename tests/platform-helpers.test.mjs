import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

async function loadPlatformHelpers() {
  const source = await readFile("src/lib/platform.ts", "utf8");
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
    },
  });
  const cjsModule = { exports: {} };
  Function("exports", "module", outputText)(cjsModule.exports, cjsModule);
  return cjsModule.exports;
}

test("platform role helpers keep operational lead boundary explicit", async () => {
  const { isOperationalLeadRole } = await loadPlatformHelpers();

  assert.equal(isOperationalLeadRole("ceo"), true);
  assert.equal(isOperationalLeadRole("deputy"), true);
  assert.equal(isOperationalLeadRole("founder"), false);
  assert.equal(isOperationalLeadRole("viewer"), false);
  assert.equal(isOperationalLeadRole(""), false);
  assert.equal(isOperationalLeadRole(null), false);
  assert.equal(isOperationalLeadRole(undefined), false);
});
