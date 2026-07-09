import type { FmdTool, Profile } from "@/lib/types";
import {
  fmdToolCategoryLabel,
  fmdToolCategoryOptions,
} from "@/features/tools/model/fmd-tools";

export type FmdQuickLinkCategoryFilter = FmdTool["category"] | "all";
export type FmdQuickLinkDialogMode = "create" | "edit";

export const categoryTabs: Array<{ value: FmdQuickLinkCategoryFilter; label: string }> = [
  { value: "all", label: "Alle" },
  ...fmdToolCategoryOptions,
];

export function canEditFmdQuickLinks(source: "seed" | "supabase", currentProfile: Profile | null) {
  return source === "seed" || Boolean(currentProfile);
}

export function categoryCountsForLinks(tools: FmdTool[]) {
  const counts: Record<FmdQuickLinkCategoryFilter, number> = {
    all: tools.length,
    tool: 0,
    repo: 0,
    knowledge: 0,
    asset: 0,
  };
  tools.forEach((tool) => {
    counts[tool.category] += 1;
  });
  return counts;
}

export function filterFmdQuickLinks(
  tools: FmdTool[],
  categoryFilter: FmdQuickLinkCategoryFilter,
  query: string,
) {
  return tools.filter((tool) => {
    const categoryMatches = categoryFilter === "all" || tool.category === categoryFilter;
    return categoryMatches && matchesToolSearch(tool, query);
  });
}

function matchesToolSearch(tool: FmdTool, query: string) {
  if (!query) return true;
  const haystack = [
    tool.name,
    tool.description,
    tool.owner,
    fmdToolCategoryLabel(tool.category),
    tool.url ? "externer link link vorhanden" : "link fehlt",
  ].join(" ").toLocaleLowerCase("de");
  return haystack.includes(query);
}
