export function linkedIssueNumber(row: { github_issue_number?: number | null; issue_number?: string | null; github_issue_url?: string | null; issue_url?: string | null }) {
  if (row.github_issue_number) return Number(row.github_issue_number);
  const legacyNumber = Number(row.issue_number);
  if (Number.isInteger(legacyNumber) && legacyNumber > 0) return legacyNumber;
  const url = row.github_issue_url || row.issue_url || "";
  const match = url.match(/\/issues\/(\d+)(?:$|[?#])/);
  return match ? Number(match[1]) : null;
}
