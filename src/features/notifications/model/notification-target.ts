import type { AppWorkspace } from "@/features/planning/model/workspace-routes";

type NotificationTargetInput = {
  type?: string;
  entityType: string;
  entityId: string;
};

export type NotificationTarget = {
  workspace: AppWorkspace;
  href: string;
  taskId?: string;
};

export function notificationTarget(event: NotificationTargetInput): NotificationTarget {
  const entityType = event.entityType.trim().toLowerCase();
  const entityId = event.entityId.trim();

  if (entityType === "task" && entityId) {
    return {
      workspace: "planning",
      href: `/tasks/${encodeURIComponent(entityId)}`,
      taskId: entityId,
    };
  }

  if (["meeting", "sprint", "sprint_commitment", "score_objection"].includes(entityType)) {
    return { workspace: "sprint", href: "/sprint" };
  }
  if (entityType === "founder_event") {
    return { workspace: "events", href: "/events" };
  }
  if (entityType === "initiative") {
    if (event.type === "planning_item.returned") {
      return { workspace: "projects", href: "/projects" };
    }
    return {
      workspace: "planning",
      href: entityId ? `/initiatives/${encodeURIComponent(entityId)}` : "/planning",
    };
  }
  if (entityType === "fmd_tool") {
    return { workspace: "tools", href: "/tools" };
  }

  return { workspace: "notifications", href: "/notifications" };
}
