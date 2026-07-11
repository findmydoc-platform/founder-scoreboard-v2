import { isOperationalLeadRole } from "@/lib/platform";
import type { Package, Profile, Task, TaskRelation, TaskRelationType } from "@/lib/types";

const allRelationTypes: TaskRelationType[] = ["blocked_by", "blocks", "relates_to"];
const founderManageableTaskTypes = new Set<Task["taskType"]>(["deliverable", "sub_issue"]);

type RelationshipProfile = Pick<Profile, "id" | "name" | "platformRole">;
type RelationshipTask = Pick<Task, "id" | "taskType" | "assignee" | "assigneeId" | "owner" | "ownerId">;
type RelationshipInitiative = Pick<Package, "accountableProfileId" | "ownerId">;

function taskOwnedByProfile(task: RelationshipTask, profile: RelationshipProfile) {
  return [task.assigneeId, task.assignee, task.ownerId, task.owner]
    .filter(Boolean)
    .some((value) => value === profile.id || value === profile.name);
}

function taskAccountableToProfile(initiative: RelationshipInitiative | undefined, profile: RelationshipProfile) {
  const accountableProfileId = initiative?.accountableProfileId || initiative?.ownerId || "";
  return accountableProfileId === profile.id;
}

export function taskRelationshipAccess({
  task,
  initiative,
  profile,
  unrestricted = false,
}: {
  task: RelationshipTask;
  initiative?: RelationshipInitiative;
  profile?: RelationshipProfile | null;
  unrestricted?: boolean;
}) {
  const canManageAll = unrestricted || isOperationalLeadRole(profile?.platformRole);
  const canManageBlockedBy = canManageAll || Boolean(
    profile
    && profile.platformRole === "founder"
    && founderManageableTaskTypes.has(task.taskType)
    && (taskOwnedByProfile(task, profile) || taskAccountableToProfile(initiative, profile)),
  );
  const allowedRelationTypes: TaskRelationType[] = canManageAll ? [...allRelationTypes] : canManageBlockedBy ? ["blocked_by"] : [];

  return {
    allowedRelationTypes,
    canManageAll,
    canManageBlockedBy,
    canRemoveRelation: (relation: TaskRelation) => canManageAll || (
      canManageBlockedBy
      && relation.taskId === task.id
      && relation.relationType === "blocked_by"
    ),
  };
}
