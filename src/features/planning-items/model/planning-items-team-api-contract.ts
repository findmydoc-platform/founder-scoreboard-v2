export type TeamPlanningItemsApiContract = Readonly<{
  version: "v1" | "v2";
  allowLegacyAliases: boolean;
  allowLegacyItemIds: boolean;
  minimumReplayContractVersion: 1 | 2;
  epicNotEmptyCode: "MILESTONE_NOT_EMPTY" | "EPIC_NOT_EMPTY";
}>;

export const teamPlanningItemsV1Contract: TeamPlanningItemsApiContract = {
  version: "v1",
  allowLegacyAliases: true,
  allowLegacyItemIds: true,
  minimumReplayContractVersion: 1,
  epicNotEmptyCode: "MILESTONE_NOT_EMPTY",
};

export const teamPlanningItemsV2Contract: TeamPlanningItemsApiContract = {
  version: "v2",
  allowLegacyAliases: false,
  allowLegacyItemIds: false,
  minimumReplayContractVersion: 2,
  epicNotEmptyCode: "EPIC_NOT_EMPTY",
};

export const canonicalTeamApiError =
  "Team API v2 akzeptiert nur epic und parentTaskId; milestone, milestoneId und packageId sind v1-Kompatibilitätsfelder.";
