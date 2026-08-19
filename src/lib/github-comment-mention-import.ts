import type { SupabaseClient } from "@supabase/supabase-js";

export function importGitHubTaskCommentsWithMentions(
  supabase: SupabaseClient,
  taskId: string,
  comments: Record<string, unknown>[],
) {
  return supabase.rpc("import_github_task_comments_with_mentions", {
    p_task_id: taskId,
    p_comments: comments,
  });
}
