import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { getGitHubAppInstallationToken } from "./github-app";
import { validateGitHubMentionTeam } from "./github-mention-team";
import type { MentionTeam } from "./mentions";

export async function resolveGitHubMentionTeam(organization: string, teamSlug: string): Promise<MentionTeam | undefined> {
  if (!organization || !teamSlug) return undefined;
  try {
    const token = await getGitHubAppInstallationToken();
    const team = await validateGitHubMentionTeam(organization, teamSlug, token);
    return { organization, teamSlug: team.slug };
  } catch {
    return undefined;
  }
}

export async function loadGitHubMentionTeam(supabase: SupabaseClient): Promise<MentionTeam | undefined> {
  const { data, error } = await supabase
    .from("projects")
    .select("github_project_owner,github_mention_team_slug")
    .eq("id", "findmydoc-founder-execution")
    .maybeSingle<{ github_project_owner: string | null; github_mention_team_slug: string | null }>();
  if (error) throw new Error(`GitHub-Erwähnungsteam konnte nicht geladen werden: ${error.message}`);
  const organization = data?.github_project_owner?.trim() || "";
  const teamSlug = data?.github_mention_team_slug?.trim() || "";
  return resolveGitHubMentionTeam(organization, teamSlug);
}
