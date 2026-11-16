import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Profile, Task } from "@/lib/types";
import { ACTIVE_TASKS_TABLE } from "@/lib/planning-read-model";
import { taskRowColumns, type DbTask } from "@/lib/planning-row-types";
import { mapTaskRow } from "@/lib/planning-task-mappers";
import { taskChildProgress } from "@/features/tasks/model/task-card-presentation";
import { taskDetailReadLimits } from "@/features/tasks/model/task-detail-read-model";
import { loadAllSupabaseRows } from "../model/supabase-pagination";
import { compactPlanningCard, planningCardOmittedFields } from "./planning-card-summary";

export const childListOmittedFields: readonly (keyof Task)[] = [...planningCardOmittedFields, "dependsOn", "evidenceLink"];
const omittedColumns = new Set(["description", "problem_statement", "intended_outcome", "scope_constraints", "acceptance_criteria", "evidence_required", "definition_of_done", "evidence_link", "review_evidence_exception_note", "github_issue_sync_error", "decision_note", "carryover_reason"]);
export const childListRowSelect = taskRowColumns.filter(column => !omittedColumns.has(column)).join(",");

export function mapChildListItem(row: Partial<DbTask>, people: Profile[]) {
  return compactPlanningCard(mapTaskRow(row, people), childListOmittedFields);
}

export async function loadPlanningDirectChildren(supabase: SupabaseClient, parent: DbTask, people: Profile[]) {
  const rows = parent.task_type === "sub_issue" ? [] : await loadAllSupabaseRows<DbTask>((from, to) => supabase.from(ACTIVE_TASKS_TABLE)
    .select(childListRowSelect, { count: "exact" }).eq("parent_task_id", parent.id).order("sort_order").order("id").range(from, to).returns<DbTask[]>(), taskDetailReadLimits.children, true);
  const children = rows.map(row => ({ ...mapChildListItem(row, people), parentApprovalStatus: parent.approval_status }));
  // This summary is certified only after complete counted enumeration. A visible
  // subset or interrupted enumeration cannot establish a progress foundation.
  return { children, childProgress: taskChildProgress(children) };
}
