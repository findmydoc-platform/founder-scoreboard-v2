import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import ts from "typescript";

const nodeRequire = createRequire(import.meta.url);

export async function loadTranspiledModule(path, mocks = {}) {
  const source = await readFile(path, "utf8");
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
    },
  });
  const cjsModule = { exports: {} };
  const localRequire = (specifier) => {
    if (Object.prototype.hasOwnProperty.call(mocks, specifier)) return mocks[specifier];
    return nodeRequire(specifier);
  };
  Function("exports", "module", "require", outputText)(cjsModule.exports, cjsModule, localRequire);
  return cjsModule.exports;
}
