import type { ActorContext } from "./actor-context";
import type {
  DeliverableStatus,
  PlanningApprovalStatus,
  PlanningBrief,
  PlanningItem,
  PlanningItemId,
  PlanningItemKind,
  PlanningRaciAssignment,
  PlanningRevision,
  PlanningReviewStatus,
  PlanningStrategy,
  ProfileId,
  SprintId,
  StrategicPlanningStatus,
  SubIssueStatus,
} from "./planning-item-domain";

export type PlanningInvocation = Readonly<{
  actor: ActorContext;
  mode: "preview" | "commit";
  command: PlanningCommand;
  idempotencyKey?: string;
  requestMetadata?: Readonly<{
    requestIp?: string;
    userAgent?: string;
  }>;
}>;

type NewPlanningItemBase<K extends PlanningItemKind> = Readonly<{
  kind: K;
  title: string;
  ownerId: ProfileId | null;
}>;

export type NewEpic = NewPlanningItemBase<"epic"> & Readonly<{
  description: string;
  status: StrategicPlanningStatus;
  targetDate: string | null;
}>;

export type NewInitiative = NewPlanningItemBase<"initiative"> & Readonly<{
  description: string;
  status: StrategicPlanningStatus;
  parentId: PlanningItemId | null;
  strategy: PlanningStrategy;
  raciAssignments: readonly PlanningRaciAssignment[];
  targetDate: string | null;
}>;

export type NewDeliverable = NewPlanningItemBase<"deliverable"> & Readonly<{
  brief: PlanningBrief;
  status: DeliverableStatus;
  parentId: PlanningItemId | null;
  priority: string;
}>;

export type NewSubIssue = NewPlanningItemBase<"sub_issue"> & Readonly<{
  brief: PlanningBrief;
  status: SubIssueStatus;
  parentId: PlanningItemId;
  githubRepository: string;
}>;

export type NewPlanningItem = NewEpic | NewInitiative | NewDeliverable | NewSubIssue;

export type CreateItems = Readonly<{
  kind: "createItems";
  items: readonly NewPlanningItem[];
}>;

export type EpicChanges = Readonly<{
  itemKind: "epic";
  title?: string;
  description?: string;
  ownerId?: ProfileId | null;
  status?: StrategicPlanningStatus;
  targetDate?: string | null;
}>;

export type InitiativeChanges = Readonly<{
  itemKind: "initiative";
  title?: string;
  description?: string;
  ownerId?: ProfileId | null;
  status?: StrategicPlanningStatus;
  strategy?: Partial<PlanningStrategy>;
  raciAssignments?: readonly PlanningRaciAssignment[];
  targetDate?: string | null;
}>;

export type DeliverableChanges = Readonly<{
  itemKind: "deliverable";
  title?: string;
  brief?: Partial<PlanningBrief>;
  ownerId?: ProfileId | null;
  status?: DeliverableStatus;
  priority?: string;
}>;

export type SubIssueChanges = Readonly<{
  itemKind: "sub_issue";
  title?: string;
  brief?: Partial<PlanningBrief>;
  ownerId?: ProfileId | null;
  status?: SubIssueStatus;
  githubRepository?: string;
}>;

export type PlanningItemChanges =
  | EpicChanges
  | InitiativeChanges
  | DeliverableChanges
  | SubIssueChanges;

export type ReviseItem = Readonly<{
  kind: "reviseItem";
  itemId: PlanningItemId;
  expectedRevision: PlanningRevision;
  changes: PlanningItemChanges;
}>;

type VersionedItemReference = Readonly<{
  itemId: PlanningItemId;
  expectedRevision: PlanningRevision;
}>;

export type PlanningReviewChecklist = Readonly<{
  acceptanceCriteriaMet: boolean;
  evidenceProvided: boolean;
  communicationClear: boolean;
  blockerHandled: boolean;
}>;

export const PLANNING_ACTION_KINDS = [
  "changeParent",
  "decideApproval",
  "withdraw",
  "restore",
  "deleteEmptyEpic",
  "requestReview",
  "decideReview",
  "withdrawReview",
  "reopenReview",
  "assignSprint",
  "moveBacklog",
  "addRelationship",
  "removeRelationship",
  "requestGitHubProjection",
] as const;

export type PlanningAction =
  | (VersionedItemReference & Readonly<{
    kind: "changeParent";
    parentId: PlanningItemId | null;
  }>)
  | Readonly<{
    kind: "decideApproval";
    itemId: PlanningItemId;
    expectedApprovalRevision: number;
    decision: Extract<PlanningApprovalStatus, "approved" | "rejected" | "draft">;
    note: string;
  }>
  | (VersionedItemReference & Readonly<{
    kind: "withdraw";
    reason: string;
  }>)
  | Readonly<{
    kind: "restore";
    itemId: PlanningItemId;
    expectedTrashRevision: number;
  }>
  | (VersionedItemReference & Readonly<{
    kind: "deleteEmptyEpic";
  }>)
  | Readonly<{
    kind: "requestReview";
    itemId: PlanningItemId;
    expectedRevision: PlanningRevision;
    reviewerProfileId?: ProfileId;
  }>
  | Readonly<{
    kind: "decideReview";
    itemId: PlanningItemId;
    expectedRevision?: PlanningRevision;
    decision: Extract<PlanningReviewStatus, "accepted" | "partial" | "changes_requested">;
    note: string;
    checklist: PlanningReviewChecklist;
  }>
  | (VersionedItemReference & Readonly<{
    kind: "withdrawReview";
    reason: string;
  }>)
  | (VersionedItemReference & Readonly<{
    kind: "reopenReview";
  }>)
  | Readonly<{
    kind: "assignSprint";
    items: readonly VersionedItemReference[];
    sprintId: SprintId | null;
  }>
  | (VersionedItemReference & Readonly<{
    kind: "moveBacklog";
    before?: VersionedItemReference;
    after?: VersionedItemReference;
  }>)
  | Readonly<{
    kind: "addRelationship";
    itemId: PlanningItemId;
    expectedRevision?: PlanningRevision;
    relatedItemId: PlanningItemId;
    relation: "blocked_by" | "blocks" | "relates_to";
    note?: string;
  }>
  | Readonly<{
    kind: "removeRelationship";
    itemId: PlanningItemId;
    expectedRevision?: PlanningRevision;
    relationshipId: number;
  }>
  | (VersionedItemReference & Readonly<{
    kind: "requestGitHubProjection";
    mode: "async" | "wait";
    createIfMissing: boolean;
  }>);

export type ActOnItem = Readonly<{
  kind: "actOnItem";
  action: PlanningAction;
}>;

export type PlanningCommand = CreateItems | ReviseItem | ActOnItem;

export type FieldIssue = Readonly<{
  path: string;
  reason: string;
}>;

export type FieldChange = Readonly<{
  field: string;
  before: unknown;
  after: unknown;
}>;

export type PlannedEffect = Readonly<{
  kind: "audit" | "activity" | "notification" | "githubProjection" | "githubLifecycle";
  description: string;
}>;

export type AppliedEffect = PlannedEffect & Readonly<{
  status: "applied" | "queued";
}>;

export type PlanningWarning = Readonly<{
  code: string;
  message: string;
}>;

export type EntityRef = Readonly<{
  kind: PlanningItemKind | "profile" | "sprint" | "relationship";
  id: string;
}>;

export type PlanningError =
  | Readonly<{ code: "invalidCommand"; issues: readonly FieldIssue[] }>
  | Readonly<{ code: "forbidden"; reason: string }>
  | Readonly<{ code: "notFound"; entity: EntityRef }>
  | Readonly<{
    code: "conflict";
    reason: "revision" | "idempotency" | "state";
    details?: Readonly<Record<string, unknown>>;
  }>
  | Readonly<{
    code: "dependencyUnavailable";
    dependency: "database" | "github" | "jobRunner";
    retryable: boolean;
  }>;

export type PlanningResult =
  | Readonly<{
    ok: true;
    status: "previewed";
    items: readonly PlanningItem[];
    changes: readonly FieldChange[];
    effects: readonly PlannedEffect[];
    warnings: readonly PlanningWarning[];
  }>
  | Readonly<{
    ok: true;
    status: "committed";
    items: readonly PlanningItem[];
    changes: readonly FieldChange[];
    effects: readonly AppliedEffect[];
    replayed: boolean;
  }>
  | Readonly<{ ok: false; error: PlanningError }>;

export interface PlanningItems {
  run(invocation: PlanningInvocation): Promise<PlanningResult>;
}
