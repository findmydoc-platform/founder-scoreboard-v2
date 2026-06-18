import type { TaskIntakeContext, TaskIntakeInitiative, TaskIntakeProfile } from "@/lib/task-intake";

type SupabaseReader = ReturnType<typeof import("@/lib/supabase").getServerSupabase>;

export async function loadTaskIntakeContext(supabase: NonNullable<SupabaseReader>, parentTaskIds: string[] = []): Promise<TaskIntakeContext> {
  const [profileResult, initiativeResult, sprintResult, milestoneResult, parentTaskResult] = await Promise.all([
    supabase.from("profiles").select("id,name,github_login"),
    supabase.from("packages").select("id,title,milestone_id,owner_id,accountable_profile_id,responsible_profile_ids"),
    supabase.from("sprints").select("id"),
    supabase.from("milestones").select("id"),
    parentTaskIds.length
      ? supabase.from("tasks").select("id").in("id", parentTaskIds)
      : Promise.resolve({ data: [] }),
  ]);

  if (profileResult.error) throw new Error(profileResult.error.message);
  if (initiativeResult.error) throw new Error(initiativeResult.error.message);
  if (sprintResult.error) throw new Error(sprintResult.error.message);
  if (milestoneResult.error) throw new Error(milestoneResult.error.message);
  if ("error" in parentTaskResult && parentTaskResult.error) throw new Error(parentTaskResult.error.message);

  const profiles: TaskIntakeProfile[] = (profileResult.data || []).map((profile) => ({
    id: profile.id,
    name: profile.name,
    githubLogin: profile.github_login || "",
  }));

  const initiatives: TaskIntakeInitiative[] = (initiativeResult.data || []).map((initiative) => ({
    id: initiative.id,
    title: initiative.title,
    milestoneId: initiative.milestone_id || "",
    ownerId: initiative.owner_id || "",
    accountableProfileId: initiative.accountable_profile_id || "",
    responsibleProfileIds: initiative.responsible_profile_ids || [],
  }));

  return {
    profiles,
    initiatives,
    sprintIds: new Set((sprintResult.data || []).map((sprint) => sprint.id)),
    milestoneIds: new Set((milestoneResult.data || []).map((milestone) => milestone.id)),
    parentTaskIds: new Set(((parentTaskResult.data || []) as Array<{ id: string }>).map((task) => task.id)),
  };
}
