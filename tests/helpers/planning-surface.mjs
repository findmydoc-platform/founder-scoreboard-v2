import { readFile, readdir, stat } from "node:fs/promises";

async function listSourceFiles(dir) {
  const entries = await readdir(dir);
  const nested = await Promise.all(entries.map(async (entry) => {
    const fullPath = `${dir}/${entry}`;
    const info = await stat(fullPath);
    if (info.isDirectory()) return listSourceFiles(fullPath);
    return /\.(ts|tsx)$/.test(fullPath) ? [fullPath] : [];
  }));

  return nested.flat();
}

export async function readPlanningSurface() {
  const planningSurfaceFiles = [
    "src/app/page.tsx",
    ...(await listSourceFiles("src/features")),
    ...(await listSourceFiles("src/shared")),
  ].sort();
  const parts = await Promise.all(planningSurfaceFiles.map(async (file) => `// ${file}\n${await readFile(file, "utf8")}`));
  return parts.join("\n\n");
}
