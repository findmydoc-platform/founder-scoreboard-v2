import { readFile } from "node:fs/promises";
import ts from "typescript";

export async function loadTranspiledModule(path) {
  const source = await readFile(path, "utf8");
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
