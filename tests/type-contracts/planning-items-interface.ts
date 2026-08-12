import type {
  ActOnItem,
  CreateItems,
  PlanningAction,
  PlanningCommand,
  PlanningItems,
  ReviseItem,
} from "../../src/features/planning-items/model/planning-items";

type Assert<T extends true> = T;
type IsFalse<T extends boolean> = T extends false ? true : false;
type HasKey<T, K extends PropertyKey> = K extends keyof T ? true : false;
type HasMember<U, K extends PropertyKey, V> = Extract<U, Record<K, V>> extends never ? false : true;

export type PlanningItemsHasOnlyRun = Assert<keyof PlanningItems extends "run" ? true : false>;
export type PlanningCommandHasThreeFamilies = Assert<PlanningCommand["kind"] extends "createItems" | "reviseItem" | "actOnItem" ? true : false>;
export type CreateHasNoLegacyPackageId = Assert<IsFalse<HasKey<CreateItems, "packageId">>>;
export type ReviseHasNoLegacyMilestoneId = Assert<IsFalse<HasKey<ReviseItem, "milestoneId">>>;
export type ReviseHasNoParentPatch = Assert<IsFalse<HasKey<ReviseItem["changes"], "parentId">>>;
export type ActionsHaveParentChange = Assert<HasMember<PlanningAction, "kind", "changeParent">>;
export type ActionsHaveApproval = Assert<HasMember<PlanningAction, "kind", "decideApproval">>;
export type ActionsHaveReview = Assert<HasMember<PlanningAction, "kind", "decideReview">>;
export type ActionsHaveGitHubProjection = Assert<HasMember<PlanningAction, "kind", "requestGitHubProjection">>;
export type ActionsHaveNoComments = Assert<IsFalse<HasMember<PlanningAction, "kind", "addComment">>>;
export type ActionsHaveNoAttachments = Assert<IsFalse<HasMember<PlanningAction, "kind", "addAttachment">>>;
export type ActOnItemWrapsOnlyActions = Assert<ActOnItem["action"] extends PlanningAction ? true : false>;
