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
