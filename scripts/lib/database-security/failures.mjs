function rowSummary(rows, fields) {
  return rows
    .slice(0, 12)
    .map((row) => fields.map((field) => row[field]).join(":"))
    .join(", ");
}

export function addRows(failures, label, rows, fields) {
  if (!rows.length) return;
  failures.push(`${label}: ${rowSummary(rows, fields)}`);
}

export function throwIfDatabaseSecurityFailed(failures) {
  if (!failures.length) return;
  throw new Error(
    `Database security contract failed:\n${failures.map((failure) => `- ${failure}`).join("\n")}`,
  );
}
