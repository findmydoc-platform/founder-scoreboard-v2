// Commitment storage uses a timestamp token and advances it by at least one millisecond.
export function isValidCommitmentVersion(value: unknown): value is string {
  if (typeof value !== "string" || !value.trim()) return false;
  return Number.isFinite(new Date(Date.parse(value) + 1).getTime());
}
