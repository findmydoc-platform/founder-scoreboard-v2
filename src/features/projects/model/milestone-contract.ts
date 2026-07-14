export const MILESTONE_STATUSES = ["planned", "active", "done"] as const;
export const MILESTONE_NOT_EMPTY_CODE = "MILESTONE_NOT_EMPTY" as const;

export type MilestoneStatus = typeof MILESTONE_STATUSES[number];

export type MilestoneDto = {
  id: string;
  title: string;
  description: string;
  targetDate: string;
  status: MilestoneStatus;
  sortOrder: number;
  updatedAt: string;
};

export type MilestoneCreateRequest = {
  title: string;
  description?: string | null;
  targetDate?: string | null;
  status?: MilestoneStatus;
};

export type MilestonePatchRequest = {
  expectedUpdatedAt: string;
  title?: string;
  description?: string | null;
  targetDate?: string | null;
  status?: MilestoneStatus;
};

export type MilestoneDeleteRequest = {
  expectedUpdatedAt: string;
};

export type MilestoneChildCounts = {
  initiatives: number;
  tasks: number;
};

export type MilestoneNotEmptyError = {
  code: typeof MILESTONE_NOT_EMPTY_CODE;
  error: string;
  children: MilestoneChildCounts;
};

export type MilestoneResponse = {
  ok: true;
  milestone: MilestoneDto;
};

export type MilestoneListResponse = {
  ok: true;
  milestones: MilestoneDto[];
};
