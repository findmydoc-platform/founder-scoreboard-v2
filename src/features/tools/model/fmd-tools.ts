import type { FmdTool } from "@/lib/types";

export const maxCuratedFmdToolLinks = 5;

export type FmdToolDraft = {
  name: string;
  category: FmdTool["category"];
  description: string;
  url: string;
  owner: string;
  isCurated: boolean;
};

export const fmdToolCategoryOptions: Array<{ value: FmdTool["category"]; label: string }> = [
  { value: "tool", label: "Werkzeuge" },
  { value: "repo", label: "Repos & Automationen" },
  { value: "knowledge", label: "Wissen" },
  { value: "asset", label: "Assets" },
];

export function fmdToolCategoryLabel(category: FmdTool["category"]) {
  return fmdToolCategoryOptions.find((option) => option.value === category)?.label || category;
}

export function defaultFmdToolDraft(owner = ""): FmdToolDraft {
  return {
    name: "",
    category: "tool",
    description: "",
    url: "",
    owner,
    isCurated: false,
  };
}

export function draftFromFmdTool(tool: FmdTool): FmdToolDraft {
  return {
    name: tool.name,
    category: tool.category,
    description: tool.description,
    url: tool.url,
    owner: tool.owner,
    isCurated: tool.isCurated,
  };
}

export function fmdToolStatusFromUrl(url: string): FmdTool["status"] {
  return url.trim() ? "active" : "missing_link";
}

export function sortFmdTools(tools: FmdTool[]) {
  return [...tools].sort((a, b) => {
    const byOrder = a.sortOrder - b.sortOrder;
    if (byOrder) return byOrder;
    return a.name.localeCompare(b.name, "de");
  });
}

export function sortFmdToolsByName(tools: FmdTool[]) {
  return [...tools].sort((a, b) => a.name.localeCompare(b.name, "de"));
}

export function curatedFmdToolLinks(tools: FmdTool[]) {
  return sortFmdToolsByName(tools)
    .filter((tool) => tool.isCurated && Boolean(tool.url))
    .slice(0, maxCuratedFmdToolLinks);
}
