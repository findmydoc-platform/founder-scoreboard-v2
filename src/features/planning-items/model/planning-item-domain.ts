export const PLANNING_ITEM_KINDS = ["epic", "initiative", "deliverable", "sub_issue"] as const;
export const STRATEGIC_PLANNING_STATUSES = ["Offen", "In Arbeit", "Pausiert", "Blockiert", "Erledigt"] as const;
export const DELIVERABLE_STATUSES = ["Offen", "In Arbeit", "Review", "Nacharbeit", "Blockiert", "Erledigt"] as const;
export const SUB_ISSUE_STATUSES = ["Offen", "In Arbeit", "Blockiert", "Erledigt"] as const;
export const PLANNING_APPROVAL_STATUSES = ["draft", "proposed", "approved", "rejected"] as const;
export const PLANNING_REVIEW_STATUSES = ["not_requested", "requested", "accepted", "partial", "changes_requested"] as const;
export const PLANNING_RACI_ROLES = ["accountable", "responsible", "consulted", "informed"] as const;
export const GITHUB_PROJECTION_STATUSES = ["not_synced", "pending", "synced", "failed"] as const;

export type PlanningItemKind = (typeof PLANNING_ITEM_KINDS)[number];
export type StrategicPlanningStatus = (typeof STRATEGIC_PLANNING_STATUSES)[number];
export type DeliverableStatus = (typeof DELIVERABLE_STATUSES)[number];
export type SubIssueStatus = (typeof SUB_ISSUE_STATUSES)[number];
export type PlanningApprovalStatus = (typeof PLANNING_APPROVAL_STATUSES)[number];
export type PlanningReviewStatus = (typeof PLANNING_REVIEW_STATUSES)[number];
export type PlanningRaciRole = (typeof PLANNING_RACI_ROLES)[number];
export type GitHubProjectionStatus = (typeof GITHUB_PROJECTION_STATUSES)[number];

export type PlanningItemId = string;
export type PlanningRevision = string;
export type ProfileId = string;
export type SprintId = string;

export type PlanningItemBase<K extends PlanningItemKind> = Readonly<{
  id: PlanningItemId;
  kind: K;
  title: string;
  revision: PlanningRevision;
  createdAt: string;
  updatedAt: string;
}>;

export type PlanningParentReference<K extends PlanningItemKind> = Readonly<{
  id: PlanningItemId;
  kind: K;
}>;

export type PlanningApproval = Readonly<{
  status: PlanningApprovalStatus;
  revision: number;
  proposedById: ProfileId | null;
  proposedAt: string | null;
  decidedById: ProfileId | null;
  decidedAt: string | null;
  decisionNote: string | null;
}>;

export type PlanningReview = Readonly<{
  status: PlanningReviewStatus;
  ownerProfileId: ProfileId | null;
  requestedAt: string | null;
}>;

export type PlanningStrategy = Readonly<{
  goal: string;
  successCriteria: string;
  scopeConstraints: string;
}>;

export type PlanningRaciAssignment = Readonly<{
  profileId: ProfileId;
  role: PlanningRaciRole;
  sortOrder: number;
}>;

export type GitHubProjection = Readonly<{
  repository: string;
  issueNumber: number | null;
  issueUrl: string;
  status: GitHubProjectionStatus;
  lastSyncedAt: string | null;
  error: string | null;
}>;

export type PlanningBrief = Readonly<{
  description: string;
  problemStatement: string;
  intendedOutcome: string;
  scopeConstraints: string;
  acceptanceCriteria: string;
  evidenceRequired: string;
  definitionOfDone: string;
}>;

export type Epic = PlanningItemBase<"epic"> & Readonly<{
  description: string;
  ownerId: ProfileId | null;
  status: StrategicPlanningStatus;
  targetDate: string | null;
}>;

export type Initiative = PlanningItemBase<"initiative"> & Readonly<{
  description: string;
  ownerId: ProfileId | null;
  status: StrategicPlanningStatus;
  parent: PlanningParentReference<"epic"> | null;
  approval: PlanningApproval;
  strategy: PlanningStrategy;
  raciAssignments: readonly PlanningRaciAssignment[];
  targetDate: string | null;
}>;

export type Deliverable = PlanningItemBase<"deliverable"> & Readonly<{
  brief: PlanningBrief;
  ownerId: ProfileId | null;
  status: DeliverableStatus;
  parent: PlanningParentReference<"initiative"> | null;
  approval: PlanningApproval;
  review: PlanningReview;
  githubProjection: GitHubProjection;
  sprintId: SprintId | null;
  fixedDate: string | null;
  priority: string;
}>;

export type SubIssue = PlanningItemBase<"sub_issue"> & Readonly<{
  brief: PlanningBrief;
  ownerId: ProfileId | null;
  status: SubIssueStatus;
  parent: PlanningParentReference<"deliverable">;
  githubProjection: GitHubProjection;
}>;

export type PlanningItem = Epic | Initiative | Deliverable | SubIssue;

const statusesByKind: Readonly<Record<PlanningItemKind, readonly string[]>> = {
  epic: STRATEGIC_PLANNING_STATUSES,
  initiative: STRATEGIC_PLANNING_STATUSES,
  deliverable: DELIVERABLE_STATUSES,
  sub_issue: SUB_ISSUE_STATUSES,
};

export function isPlanningItemStatus(kind: PlanningItemKind, status: string) {
  return statusesByKind[kind].includes(status);
}

export function isPlanningParentAllowed(
  childKind: PlanningItemKind,
  parentKind: PlanningItemKind | null,
) {
  if (childKind === "epic") return parentKind === null;
  if (childKind === "initiative") return parentKind === null || parentKind === "epic";
  if (childKind === "deliverable") return parentKind === null || parentKind === "initiative";
  return parentKind === "deliverable";
}

export function supportsPlanningApproval(kind: PlanningItemKind) {
  return kind === "initiative" || kind === "deliverable";
}

export function supportsPlanningRaci(kind: PlanningItemKind) {
  return kind === "initiative";
}

export function supportsPlanningReview(kind: PlanningItemKind) {
  return kind === "deliverable";
}

export function supportsPlanningSprint(kind: PlanningItemKind) {
  return kind === "deliverable";
}

export function supportsGitHubProjection(kind: PlanningItemKind) {
  return kind === "deliverable" || kind === "sub_issue";
}
