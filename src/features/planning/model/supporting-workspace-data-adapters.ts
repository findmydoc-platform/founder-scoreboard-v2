import type { EventsWorkspaceModel } from "@/features/events/model/events-read-model";
import type { NotificationsWorkspaceModel } from "@/features/notifications/model/notifications-read-model";
import type { ProfileWorkspaceModel } from "@/features/profile/model/profile-read-model";
import type { TeamWorkspaceModel } from "@/features/team/model/team-read-model";
import type { ToolsWorkspaceModel } from "@/features/tools/model/tools-read-model";
import { emptyPlanningData } from "@/lib/planning-data";
import { mapLegacyPackageFromInitiative } from "@/lib/planning-profile-mappers";
import type { PlanningData } from "@/lib/types";

export type SupportingWorkspace = "events" | "tools" | "team" | "profile" | "notifications";
export type SupportingWorkspaceModel = EventsWorkspaceModel | ToolsWorkspaceModel | TeamWorkspaceModel | ProfileWorkspaceModel | NotificationsWorkspaceModel;

export function isSupportingWorkspace(workspace: string): workspace is SupportingWorkspace {
  return workspace === "events" || workspace === "tools" || workspace === "team" || workspace === "profile" || workspace === "notifications";
}

export function supportingWorkspaceModelToPlanningData(workspace: SupportingWorkspace, model: SupportingWorkspaceModel): PlanningData {
  if (workspace === "events") {
    const eventsModel = model as EventsWorkspaceModel;
    return { ...emptyPlanningData, profiles: [...eventsModel.people], events: [...eventsModel.events] };
  }
  if (workspace === "tools") {
    const toolsModel = model as ToolsWorkspaceModel;
    return { ...emptyPlanningData, profiles: [...toolsModel.people], fmdTools: [...toolsModel.tools] };
  }
  if (workspace === "team") {
    const teamModel = model as TeamWorkspaceModel;
    return { ...emptyPlanningData, profiles: [...teamModel.people], tasks: [...teamModel.items] };
  }
  if (workspace === "profile") {
    const profileModel = model as ProfileWorkspaceModel;
    return {
      ...emptyPlanningData,
      project: profileModel.project,
      profiles: [...profileModel.people],
      packages: profileModel.initiatives.map(mapLegacyPackageFromInitiative),
      notificationPreferences: [...profileModel.notificationPreferences],
      profileUiPreferences: [...profileModel.preferences],
    };
  }
  const notificationsModel = model as NotificationsWorkspaceModel;
  return {
    ...emptyPlanningData,
    profiles: [...notificationsModel.people],
    tasks: [...notificationsModel.items],
    notificationEvents: [...notificationsModel.events],
    notificationDeliveries: [...notificationsModel.deliveries],
  };
}
