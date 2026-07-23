const visibleUiPathPattern = /^src\/(app|features|shared)\/.*\.(tsx|css)$/;

export function parseGitNumstat(output) {
  return String(output || "")
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => {
      const [added, deleted, ...pathParts] = line.split("\t");
      return {
        added: added === "-" ? null : Number(added),
        deleted: deleted === "-" ? null : Number(deleted),
        path: pathParts.join("\t"),
      };
    });
}

export function requiresProductUpdateForDiff(entries) {
  const visibleUiEntries = entries.filter((entry) => (
    visibleUiPathPattern.test(entry.path)
    && !entry.path.startsWith("src/app/api/")
  ));
  if (!visibleUiEntries.length) return false;

  const removesUiFile = visibleUiEntries.some((entry) => (
    entry.added === 0 && typeof entry.deleted === "number" && entry.deleted > 0
  ));
  const removalOnly = visibleUiEntries.every((entry) => (
    typeof entry.added === "number"
    && typeof entry.deleted === "number"
    && entry.added < entry.deleted
  ));

  return !(removesUiFile && removalOnly);
}
