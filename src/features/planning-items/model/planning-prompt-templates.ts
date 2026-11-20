export const planningPromptTemplateKinds = ["general", "initiative", "deliverable", "sub_issue"] as const;

export type PlanningPromptTemplateKind = typeof planningPromptTemplateKinds[number];

export type PlanningPromptTemplate = Readonly<{
  kind: PlanningPromptTemplateKind;
  text: string;
  version: number;
}>;

export type PlanningPromptTemplateEdit = Omit<PlanningPromptTemplate, "version"> & {
  expectedVersion: number;
};

export function isPlanningPromptTemplateKind(value: unknown): value is PlanningPromptTemplateKind {
  return planningPromptTemplateKinds.some(kind => kind === value);
}

export type PlanningPromptTemplateAudience = {
  mode: "selected" | "all";
  profileIds: string[];
};

export type PlanningPromptTemplateAudienceEdit = Partial<PlanningPromptTemplateAudience>;

export type PlanningPromptTemplateAudienceDirectory = {
  audience: PlanningPromptTemplateAudience;
  profiles: { id: string; name: string }[];
};

export function isPlanningPromptTemplateAudienceEdit(value: unknown): value is PlanningPromptTemplateAudienceEdit {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const keys = Object.keys(value);
  if (!keys.length || keys.some(key => key !== "mode" && key !== "profileIds")) return false;
  if ("mode" in value && value.mode !== "selected" && value.mode !== "all") return false;
  if (!("profileIds" in value)) return true;
  return !("mode" in value && value.mode === "all") &&
    Array.isArray(value.profileIds) &&
    value.profileIds.every(id => typeof id === "string" && id.trim() !== "");
}
