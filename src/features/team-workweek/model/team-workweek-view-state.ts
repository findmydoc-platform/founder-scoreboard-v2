export type PublishedTeamWorkweekViewState =
  | "loading"
  | "initial-error"
  | "empty"
  | "matrix"
  | "stale-matrix";

export function resolvePublishedTeamWorkweekViewState({
  hasLoadedSuccessfully,
  message,
  pending,
  workweekCount,
}: {
  hasLoadedSuccessfully: boolean;
  message: string;
  pending: boolean;
  workweekCount: number;
}): PublishedTeamWorkweekViewState {
  if (!hasLoadedSuccessfully) return message ? "initial-error" : "loading";
  if (message) return "stale-matrix";
  if (!pending && workweekCount === 0) return "empty";
  return "matrix";
}
