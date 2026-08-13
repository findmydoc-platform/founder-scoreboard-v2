import { FOUNDEROPS_PLANNING_PROJECT_ID } from "@/features/planning-items/model/planning-items-contract";
import { ACTIVE_TASKS_TABLE } from "@/lib/planning-read-model";

type CanonicalItemClient = {
  from(table: string): {
    select(columns: string): {
      eq(column: string, value: string): {
        eq(column: string, value: string): {
          maybeSingle(): PromiseLike<{
            data: { id?: unknown } | null;
            error: { message: string; code?: string } | null;
          }>;
        };
      };
    };
  };
};

export async function hasCanonicalTeamPlanningItem(
  supabase: unknown,
  itemId: string,
) {
  const result = await (supabase as CanonicalItemClient)
    .from(ACTIVE_TASKS_TABLE)
    .select("id")
    .eq("project_id", FOUNDEROPS_PLANNING_PROJECT_ID)
    .eq("id", itemId)
    .maybeSingle();
  if (result.error) {
    throw Object.assign(new Error(result.error.message), { code: result.error.code });
  }
  return Boolean(result.data);
}
