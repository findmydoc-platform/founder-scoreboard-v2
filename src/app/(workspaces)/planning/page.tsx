import { renderWorkspacePage } from "../workspace-page";
import { planningBoardQueryFromSearchParams } from "@/features/planning/model/planning-board-query";

export const dynamic = "force-dynamic";

export default async function PlanningPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const values = await searchParams;
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) for (const entry of Array.isArray(value) ? value : value === undefined ? [] : [value]) params.append(key, entry);
  const query = planningBoardQueryFromSearchParams(params);
  return renderWorkspacePage("planning", params.has("board.level") || params.has("board.parentId") ? { ...query, view: "board" } : query);
}
