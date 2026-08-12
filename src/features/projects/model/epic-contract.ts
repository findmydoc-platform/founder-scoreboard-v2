export const EPIC_STATUSES = ["planned", "active", "done"] as const;
export const EPIC_NOT_EMPTY_CODE = "EPIC_NOT_EMPTY" as const;

export type EpicStatus = typeof EPIC_STATUSES[number];

export type EpicDto = {
  id: string;
  title: string;
  description: string;
  targetDate: string;
  status: EpicStatus;
  sortOrder: number;
  updatedAt: string;
};

export type EpicCreateRequest = {
  title: string;
  description?: string | null;
  targetDate?: string | null;
  status?: EpicStatus;
};

export type EpicPatchRequest = {
  expectedUpdatedAt: string;
  title?: string;
  description?: string | null;
  targetDate?: string | null;
  status?: EpicStatus;
};

export type EpicDeleteRequest = {
  expectedUpdatedAt: string;
};

export type EpicChildCounts = {
  initiatives: number;
  tasks: number;
};

export type EpicNotEmptyError = {
  code: typeof EPIC_NOT_EMPTY_CODE;
  error: string;
  children: EpicChildCounts;
};

export type EpicResponse = {
  ok: true;
  epic: EpicDto;
};

export type EpicListResponse = {
  ok: true;
  epics: EpicDto[];
};
