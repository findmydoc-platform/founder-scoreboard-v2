import type { FmdTool } from "@/lib/types";
import { maxHeaderQuickLinks } from "@/lib/planning-header-data";

export const maxCuratedFmdToolLinks = maxHeaderQuickLinks;

export type FmdToolDraft = {
  name: string;
  category: FmdTool["category"];
  description: string;
  url: string;
  owner: string;
  isCurated: boolean;
  previewImageUrl: string;
  previewImageSource: FmdTool["previewImageSource"];
};

export type FmdToolMetadataDraft = {
  title: string;
  description: string;
  imageUrl: string;
  siteName: string;
};

export type FmdToolPreviewImageUpload = {
  imageUrl: string;
  source: Extract<FmdTool["previewImageSource"], "manual">;
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
    previewImageUrl: "",
    previewImageSource: "none",
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
    previewImageUrl: tool.previewImageUrl || "",
    previewImageSource: tool.previewImageSource || "none",
  };
}

export function fmdToolStatusFromUrl(url: string): FmdTool["status"] {
  return url.trim() ? "active" : "missing_link";
}

export function hasFmdToolLink(tool: FmdTool) {
  return Boolean(tool.url.trim());
}

export function sortFmdTools(tools: FmdTool[]) {
  return [...tools].sort((a, b) => {
    const byLinkAvailability = Number(hasFmdToolLink(b)) - Number(hasFmdToolLink(a));
    if (byLinkAvailability) return byLinkAvailability;
    const byName = a.name.localeCompare(b.name, "de");
    if (byName) return byName;
    return a.sortOrder - b.sortOrder;
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
