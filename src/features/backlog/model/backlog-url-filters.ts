import type { TableUrlSchema } from "@/shared/hooks/use-table-url-state";
import type { BacklogTableFilters } from "./backlog-view-model";

function stringUrlField(defaultValue = "") {
  return { defaultValue, parse: (values: string[]) => values[0], serialize: (value: string) => value ? [value] : [] };
}
function enumUrlField<Value extends string>(defaultValue: Value, values: readonly Value[]) {
  return { defaultValue, parse: (raw: string[]) => values.find(value => value === raw[0]), serialize: (value: Value) => [value] };
}

export const backlogFilterSchema: TableUrlSchema<BacklogTableFilters> = {
  level: enumUrlField("deliverable", ["epic", "initiative", "deliverable"] as const),
  query: stringUrlField(),
  scope: enumUrlField("all", ["all", "proposals", "ready", "unscheduled"] as const),
  status: stringUrlField("Alle"),
  readiness: enumUrlField("all", ["all", "ready", "incomplete"] as const),
  priority: stringUrlField("Alle"),
  epic: stringUrlField("Alle"),
  initiative: stringUrlField("Alle"),
  assignee: stringUrlField("Alle"),
  sort: enumUrlField("rank", ["rank", "priority", "title", "approval", "initiative", "assignee", "readiness", "status"] as const),
  direction: enumUrlField("asc", ["asc", "desc"] as const),
};

export function readBacklogUrlFilters(params: URLSearchParams): BacklogTableFilters {
  return Object.fromEntries(Object.entries(backlogFilterSchema).map(([key, field]) =>
    [key, field.parse(params.getAll(`backlog.${key}`)) ?? field.defaultValue])) as BacklogTableFilters;
}
