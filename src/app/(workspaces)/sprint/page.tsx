import { renderWorkspacePage } from "../workspace-page";

export const dynamic = "force-dynamic";

export default async function SprintPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = new URLSearchParams({ scope: "selected" });
  const values = await searchParams;
  for (const field of ["query", "status", "assignee", "risk", "review", "score", "sort", "direction"]) {
    const value = values?.[`sprintTasks.${field}`];
    if (typeof value === "string" || value?.length) params.set(field, typeof value === "string" ? value : value[0]);
  }
  return renderWorkspacePage("sprint", undefined, params);
}
