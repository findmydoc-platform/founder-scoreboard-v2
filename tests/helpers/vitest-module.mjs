import { statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { vi } from "vitest";

let importSequence = 0;

function resolveMockSpecifier(specifier, targetPath) {
  if (!specifier.startsWith(".")) return specifier;
  const unresolvedPath = resolve(dirname(targetPath), specifier);
  const candidates = [
    unresolvedPath,
    ...[".ts", ".tsx", ".mjs", ".js", ".jsx", ".json"].map((extension) => (
      `${unresolvedPath}${extension}`
    )),
    ...["index.ts", "index.tsx", "index.mjs", "index.js"].map((entry) => (
      resolve(unresolvedPath, entry)
    )),
  ];
  const resolvedPath = candidates.find((candidate) => {
    try {
      return statSync(candidate).isFile();
    } catch {
      return false;
    }
  });
  return pathToFileURL(resolvedPath ?? unresolvedPath).href;
}

export async function importTestModule(path, mocks = {}) {
  const targetPath = resolve(process.cwd(), path);
  const mockSpecifiers = Object.keys(mocks).map((specifier) => (
    resolveMockSpecifier(specifier, targetPath)
  ));

  for (const [index, mock] of Object.values(mocks).entries()) {
    vi.doMock(mockSpecifiers[index], () => mock);
  }

  try {
    importSequence += 1;
    const targetUrl = `${pathToFileURL(targetPath).href}?test-import=${importSequence}`;
    return await import(targetUrl);
  } finally {
    for (const specifier of mockSpecifiers) vi.doUnmock(specifier);
  }
}
