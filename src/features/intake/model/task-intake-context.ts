import type { TaskIntakeContext, TaskIntakeInitiative, TaskIntakeProfile } from "@/features/intake/model/task-intake";
import { ACTIVE_PACKAGES_TABLE, ACTIVE_TASKS_TABLE } from "@/lib/planning-read-model";

type SupabaseReader = ReturnType<typeof import("@/lib/supabase").getServerSupabase>;

export async function loadTaskIntakeContext(supabase: NonNullable<SupabaseReader>, parentTaskIds: string[] = []): Promise<TaskIntakeContext> {
  const [profileResult, initiativeResult, milestoneResult, parentTaskResult] = await Promise.all([
    supabase.from("profiles").select("id,name,github_login"),
    supabase.from(ACTIVE_PACKAGES_TABLE).select("id,title,milestone_id,owner_id,accountable_profile_id,responsible_profile_ids"),
    supabase.from("milestones").select("id"),
    parentTaskIds.length
      ? supabase.from(ACTIVE_TASKS_TABLE).select("id").in("id", parentTaskIds)
      : Promise.resolve({ data: [] }),
  ]);

  if (profileResult.error) throw new Error(profileResult.error.message);
  if (initiativeResult.error) throw new Error(initiativeResult.error.message);
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
    milestoneIds: new Set((milestoneResult.data || []).map((milestone) => milestone.id)),
    parentTaskIds: new Set(((parentTaskResult.data || []) as Array<{ id: string }>).map((task) => task.id)),
  };
}
