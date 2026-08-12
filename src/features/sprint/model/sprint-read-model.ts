import type { FounderSprintScore, FounderStrikeState, Meeting, MeetingAttendance, Profile, Project, ScoreObjection, Sprint, SprintCommitment, StrikeEvent, Task } from "@/lib/types";

export type SprintWorkspaceModel = Readonly<{
  revision: string;
  project: Project;
  people: readonly Profile[];
  items: readonly Task[];
  sprints: readonly Sprint[];
  commitments: readonly SprintCommitment[];
  scores: readonly FounderSprintScore[];
  strikeStates: readonly FounderStrikeState[];
  strikeEvents: readonly StrikeEvent[];
  objections: readonly ScoreObjection[];
  meetings: readonly Meeting[];
  attendance: readonly MeetingAttendance[];
}>;

export type SprintLoadResult = { status: "ready"; model: SprintWorkspaceModel } | { status: "forbidden" } | { status: "unavailable" };

export interface SprintReadModel {
  load(context: { authorized: boolean; actorProfileId: string | null }): Promise<SprintLoadResult>;
}

export type SprintWorkspaceAction =
  | { type: "modelLoaded"; model: SprintWorkspaceModel }
  | { type: "sprintPatched"; sprintId: string; patch: Partial<Sprint> }
  | { type: "commitmentUpserted"; commitment: SprintCommitment }
  | { type: "attendanceUpserted"; attendance: MeetingAttendance }
  | { type: "itemPatched"; itemId: string; patch: Partial<Task> }
  | { type: "sprintLocked"; sprintId: string };

function upsert<T>(rows: readonly T[], value: T, matches: (row: T) => boolean): readonly T[] {
  return rows.some(matches) ? rows.map((row) => matches(row) ? value : row) : [value, ...rows];
}

export function sprintWorkspaceReducer(model: SprintWorkspaceModel, action: SprintWorkspaceAction): SprintWorkspaceModel {
  if (action.type === "modelLoaded") return action.model;
  if (action.type === "sprintPatched") return { ...model, sprints: model.sprints.map((sprint) => sprint.id === action.sprintId ? { ...sprint, ...action.patch } : sprint) };
  if (action.type === "commitmentUpserted") return { ...model, commitments: upsert(model.commitments, action.commitment, (row) => row.sprintId === action.commitment.sprintId && row.profileId === action.commitment.profileId) };
  if (action.type === "attendanceUpserted") return { ...model, attendance: upsert(model.attendance, action.attendance, (row) => row.meetingId === action.attendance.meetingId && row.profileId === action.attendance.profileId) };
  if (action.type === "itemPatched") return { ...model, items: model.items.map((item) => item.id === action.itemId ? { ...item, ...action.patch } : item) };
  return {
    ...model,
    sprints: model.sprints.map((sprint) => sprint.id === action.sprintId ? { ...sprint, status: "closed", scoreLocked: true } : sprint),
    items: model.items.map((item) => item.sprintId === action.sprintId && !item.scoreFinal ? { ...item, scorePoints: 0, scoreFinal: true } : item),
  };
}
