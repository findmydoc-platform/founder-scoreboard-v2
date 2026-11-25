export type PlanningStructureControls = Readonly<{
  people: readonly Readonly<{ id: string; name: string }>[];
  sprints: readonly Readonly<{ id: string; name: string }>[];
  initiatives: readonly Readonly<{ id: string; title: string }>[];
  workstreams: readonly string[];
  coverage: "complete";
  sourceRevision: string;
  scopeRevision: string;
  observedAt: string;
  validUntil: string;
}>;
export type PlanningStructureControlsModel = Readonly<{ revision: string; controls: PlanningStructureControls }>;
