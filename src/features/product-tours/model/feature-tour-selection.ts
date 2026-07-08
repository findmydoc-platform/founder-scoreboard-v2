import type { AppWorkspace } from "@/features/planning/model/workspace-routes";
import type { ProfileFeatureTourAcknowledgement } from "@/lib/types";
import type { FeatureTourDefinition } from "@/features/product-tours/model/feature-tour-registry";

export function tourAppliesToWorkspace(tour: FeatureTourDefinition, workspace: AppWorkspace) {
  return !tour.workspaceScope || tour.workspaceScope === workspace;
}

export function profileHasSeenTour(
  acknowledgements: ProfileFeatureTourAcknowledgement[],
  profileId: string,
  tourId: string,
) {
  return acknowledgements.some((acknowledgement) =>
    acknowledgement.profileId === profileId && acknowledgement.tourId === tourId
  );
}

export function selectNextFeatureTour(
  tours: readonly FeatureTourDefinition[],
  workspace: AppWorkspace,
  profileId: string,
  acknowledgements: ProfileFeatureTourAcknowledgement[],
) {
  return tours.find((tour) =>
    tourAppliesToWorkspace(tour, workspace) && !profileHasSeenTour(acknowledgements, profileId, tour.id)
  );
}
