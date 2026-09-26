import type { SupabaseClient } from "@supabase/supabase-js";
import type { IssueContentContext, IssueContentTask } from "@/lib/github-issue-content";
import { validatePlanningContent } from "./planning-item-content";

// Only local configuration is read. Saving a brief never requires GitHub availability.
export async function planningContentContext(supabase: SupabaseClient, items: readonly IssueContentTask[]): Promise<IssueContentContext> {
  const context: IssueContentContext = { appUrl: process.env.APP_URL };
  if (!items.some((item) => Object.values(item).some((value) => typeof value === "string" && /@all\b/i.test(value)))) return context;
  const [profiles, project] = await Promise.all([
    supabase.from("profiles").select("id,name,github_login"),
    supabase.from("projects").select("github_project_owner,github_mention_team_slug").eq("id", "findmydoc-founder-execution").maybeSingle(),
  ]);
  if (profiles.error || project.error) throw new Error("Kontext für die Inhaltsprüfung konnte nicht geladen werden.");
  context.mentionProfiles = (profiles.data || []).map((row) => ({ id: row.id, name: row.name, githubLogin: row.github_login }));
  if (project.data?.github_project_owner && project.data?.github_mention_team_slug) context.mentionTeam = { organization: project.data.github_project_owner, teamSlug: project.data.github_mention_team_slug };
  return context;
}
export async function validateStoredPlanningContent(supabase: SupabaseClient, item: IssueContentTask) {
  return validatePlanningContent(item, await planningContentContext(supabase, [item]));
}
