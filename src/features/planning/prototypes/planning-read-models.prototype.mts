/**
 * PROTOTYPE — throw away after Wayfinder #288 is settled.
 *
 * Question: Can consumer-owned Read Models replace the 28-field
 * PlanningData container so that an absent field means "not part of this use
 * case", while explicit import rules prevent feature dependency cycles?
 *
 * This is pure representative logic. It does not query production data.
 */

export type PlanningItem = {
  id: string;
  itemType: "epic" | "initiative" | "deliverable" | "sub_issue";
  title: string;
};

type Person = { id: string; name: string };
type Named = { id: string; name: string };
type Event = { id: string; title: string };

export type PrototypeSource = {
  project: { id: string; name: string };
  people: Person[];
  items: PlanningItem[];
  sprints: Named[];
  commitments: Named[];
  relationships: Named[];
  scores: Named[];
  strikes: Named[];
  objections: Named[];
  meetings: Named[];
  attendance: Named[];
  events: Event[];
  notifications: Event[];
  deliveries: Named[];
  tools: Named[];
  notificationPreferences: Named[];
  uiPreferences: Named[];
  tourAcknowledgements: Named[];
};

export const source: PrototypeSource = {
  project: { id: "founderops", name: "findmydoc Planning" },
  people: [{ id: "profile-1", name: "Founder" }],
  items: [
    { id: "epic-1", itemType: "epic", title: "Launch" },
    { id: "initiative-1", itemType: "initiative", title: "Readiness" },
    { id: "deliverable-1", itemType: "deliverable", title: "Runbook" },
  ],
  sprints: [{ id: "sprint-1", name: "Sprint 1" }],
  commitments: [{ id: "commitment-1", name: "Strong" }],
  relationships: [{ id: "relation-1", name: "blocks" }],
  scores: [{ id: "score-1", name: "10" }],
  strikes: [],
  objections: [],
  meetings: [{ id: "meeting-1", name: "Weekly" }],
  attendance: [],
  events: [{ id: "event-1", title: "Launch review" }],
  notifications: [{ id: "notification-1", title: "Review requested" }],
  deliveries: [],
  tools: [{ id: "tool-1", name: "Management" }],
  notificationPreferences: [],
  uiPreferences: [{ id: "preference-1", name: "planning" }],
  tourAcknowledgements: [],
};

export type PlanningShellModel = Readonly<{
  project: PrototypeSource["project"];
  people: readonly Person[];
  uiPreferences: readonly Named[];
  tourAcknowledgements: readonly Named[];
}>;

export type ApplicationReadModelCatalog = {
  planning: Readonly<{
    items: readonly PlanningItem[];
    sprints: readonly Named[];
    relationships: readonly Named[];
  }>;
  backlog: Readonly<{
    items: readonly PlanningItem[];
    sprints: readonly Named[];
    commitments: readonly Named[];
  }>;
  projects: Readonly<{
    items: readonly PlanningItem[];
    sprints: readonly Named[];
    relationships: readonly Named[];
  }>;
  sprint: Readonly<{
    items: readonly PlanningItem[];
    sprints: readonly Named[];
    commitments: readonly Named[];
    scores: readonly Named[];
    strikes: readonly Named[];
    objections: readonly Named[];
    meetings: readonly Named[];
    attendance: readonly Named[];
  }>;
  events: Readonly<{ events: readonly Event[] }>;
  team: Readonly<{ items: readonly PlanningItem[] }>;
  notifications: Readonly<{
    itemReferences: readonly Pick<PlanningItem, "id" | "title">[];
    notifications: readonly Event[];
    deliveries: readonly Named[];
  }>;
  tools: Readonly<{ tools: readonly Named[] }>;
  profile: Readonly<{
    initiatives: readonly PlanningItem[];
    notificationPreferences: readonly Named[];
  }>;
  taskDetail: Readonly<{
    item: PlanningItem | null;
    relatedItems: readonly Pick<PlanningItem, "id" | "title">[];
    sprints: readonly Named[];
  }>;
};

export type ReadModelName = keyof ApplicationReadModelCatalog;

export type ReadResult<T> =
  | { status: "ready"; model: T }
  | { status: "unavailable" };

export interface ApplicationReader<K extends ReadModelName> {
  load(): Promise<ReadResult<ApplicationReadModelCatalog[K]>>;
}

export const readModelNames: readonly ReadModelName[] = [
  "planning",
  "backlog",
  "projects",
  "sprint",
  "events",
  "team",
  "notifications",
  "tools",
  "profile",
  "taskDetail",
];

export function loadShell(input: PrototypeSource): PlanningShellModel {
  return {
    project: input.project,
    people: input.people,
    uiPreferences: input.uiPreferences,
    tourAcknowledgements: input.tourAcknowledgements,
  };
}

export function loadReadModel<K extends ReadModelName>(
  name: K,
  input: PrototypeSource,
): ApplicationReadModelCatalog[K] {
  const models: ApplicationReadModelCatalog = {
    planning: {
      items: input.items,
      sprints: input.sprints,
      relationships: input.relationships,
    },
    backlog: {
      items: input.items,
      sprints: input.sprints,
      commitments: input.commitments,
    },
    projects: {
      items: input.items,
      sprints: input.sprints,
      relationships: input.relationships,
    },
    sprint: {
      items: input.items,
      sprints: input.sprints,
      commitments: input.commitments,
      scores: input.scores,
      strikes: input.strikes,
      objections: input.objections,
      meetings: input.meetings,
      attendance: input.attendance,
    },
    events: { events: input.events },
    team: { items: input.items },
    notifications: {
      itemReferences: input.items.map(({ id, title }) => ({ id, title })),
      notifications: input.notifications,
      deliveries: input.deliveries,
    },
    tools: { tools: input.tools },
    profile: {
      initiatives: input.items.filter((item) => item.itemType === "initiative"),
      notificationPreferences: input.notificationPreferences,
    },
    taskDetail: {
      item: input.items.find((item) => item.id === "deliverable-1") || null,
      relatedItems: input.items
        .filter((item) => item.id !== "deliverable-1")
        .map(({ id, title }) => ({ id, title })),
      sprints: input.sprints,
    },
  };
  return models[name];
}

export type ArchitectureLayer =
  | "app"
  | "shell"
  | "feature"
  | "planningItems"
  | "shared"
  | "serverAdapter";

export type ImportAttempt = {
  from: ArchitectureLayer;
  to: ArchitectureLayer;
  sameFeature?: boolean;
  label: string;
};

export const importAttempts: readonly ImportAttempt[] = [
  { from: "app", to: "shell", label: "app composes the shell" },
  { from: "shell", to: "feature", label: "shell composes workspace features" },
  { from: "feature", to: "feature", sameFeature: true, label: "feature imports its own model" },
  { from: "feature", to: "planningItems", label: "feature uses canonical PlanningItem" },
  { from: "feature", to: "shared", label: "feature uses shared UI primitives" },
  { from: "serverAdapter", to: "feature", label: "adapter implements consumer-owned reader" },
  { from: "feature", to: "feature", sameFeature: false, label: "backlog imports tasks internals" },
  { from: "feature", to: "shell", label: "tasks imports planning shell" },
  { from: "planningItems", to: "feature", label: "domain imports projects policy" },
  { from: "shared", to: "feature", label: "shared primitive imports feature copy" },
];

export function validateImport(attempt: ImportAttempt) {
  const allowed = (
    (attempt.from === "app" && (attempt.to === "shell" || attempt.to === "serverAdapter"))
    || (attempt.from === "shell" && attempt.to === "feature")
    || (attempt.from === "feature" && attempt.to === "feature" && attempt.sameFeature === true)
    || (attempt.from === "feature" && (attempt.to === "planningItems" || attempt.to === "shared"))
    || (attempt.from === "serverAdapter" && (attempt.to === "feature" || attempt.to === "planningItems"))
  );
  return {
    ...attempt,
    allowed,
    reason: allowed
      ? "dependency follows the target layer direction"
      : "dependency would create a peer or upward import",
  };
}

export function prototypeSummary(input: PrototypeSource) {
  return {
    currentPlanningDataFieldCount: 28,
    representativeSourceFieldCount: Object.keys(input).length,
    readModels: Object.fromEntries(readModelNames.map((name) => [
      name,
      Object.keys(loadReadModel(name, input)),
    ])),
    imports: importAttempts.map(validateImport),
  };
}
