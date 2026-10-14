import { githubJson } from "./github-http";
import { validGitHubProjectOwner } from "./github-project-config";

const githubTeamSlugPattern = /^[a-z0-9](?:[a-z0-9-]{0,98}[a-z0-9])?$/u;

type GitHubTeamResponse = {
  slug?: string;
  name?: string;
  html_url?: string;
  notification_setting?: "notifications_enabled" | "notifications_disabled";
};

export function validGitHubTeamSlug(value: unknown): value is string {
  return typeof value === "string" && githubTeamSlugPattern.test(value);
}

export async function validateGitHubMentionTeam(organization: string, teamSlug: string, token: string) {
  if (!validGitHubProjectOwner(organization) || !validGitHubTeamSlug(teamSlug)) {
    throw new Error("GitHub-Organisation oder Team-Slug ist ungültig.");
  }
  const team = await githubJson<GitHubTeamResponse>(
    `https://api.github.com/orgs/${encodeURIComponent(organization)}/teams/${encodeURIComponent(teamSlug)}`,
    { token, operation: "read", errorMessage: "GitHub-Team konnte nicht gelesen werden" },
  );
  if (team.notification_setting !== "notifications_enabled") {
    throw new Error("Team-Erwähnungen sind für dieses GitHub-Team deaktiviert.");
  }
  return {
    slug: team.slug || teamSlug,
    name: team.name || teamSlug,
    url: team.html_url || `https://github.com/orgs/${organization}/teams/${teamSlug}`,
    notificationsEnabled: true as const,
  };
}
