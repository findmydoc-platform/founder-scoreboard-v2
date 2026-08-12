import type {
  Deliverable,
  Epic,
  Initiative,
  PlanningItem,
  SubIssue,
} from "../../src/features/planning-items/model/planning-item-domain";

type Assert<T extends true> = T;
type HasKey<T, K extends PropertyKey> = K extends keyof T ? true : false;
type IsFalse<T extends boolean> = T extends false ? true : false;

export type PlanningItemIsDiscriminated = Assert<PlanningItem["kind"] extends "epic" | "initiative" | "deliverable" | "sub_issue" ? true : false>;
export type PlanningItemHasNoLegacyPackageId = Assert<IsFalse<HasKey<PlanningItem, "packageId">>>;
export type PlanningItemHasNoLegacyMilestoneId = Assert<IsFalse<HasKey<PlanningItem, "milestoneId">>>;
export type PlanningItemHasNoLegacyAssignee = Assert<IsFalse<HasKey<PlanningItem, "assignee">>>;
export type EpicHasNoParent = Assert<IsFalse<HasKey<Epic, "parent">>>;
export type EpicHasNoApproval = Assert<IsFalse<HasKey<Epic, "approval">>>;
export type EpicHasNoGitHubProjection = Assert<IsFalse<HasKey<Epic, "githubProjection">>>;
export type InitiativeHasApproval = Assert<HasKey<Initiative, "approval">>;
export type InitiativeHasRaci = Assert<HasKey<Initiative, "raciAssignments">>;
export type InitiativeHasNoReview = Assert<IsFalse<HasKey<Initiative, "review">>>;
export type DeliverableHasReview = Assert<HasKey<Deliverable, "review">>;
export type DeliverableHasGitHubProjection = Assert<HasKey<Deliverable, "githubProjection">>;
export type SubIssueHasRequiredParent = Assert<undefined extends SubIssue["parent"] ? false : true>;
export type SubIssueHasNoApproval = Assert<IsFalse<HasKey<SubIssue, "approval">>>;
export type SubIssueHasNoReview = Assert<IsFalse<HasKey<SubIssue, "review">>>;
