export const planningDataUnavailableMessage = "Planungsdaten sind vorübergehend nicht verfügbar. Bitte versuche es erneut.";

export class PlanningShellStateUnavailableError extends Error {
  constructor() {
    super(planningDataUnavailableMessage);
    this.name = "PlanningShellStateUnavailableError";
  }
}

export function isPlanningShellStateUnavailableError(error: unknown): error is PlanningShellStateUnavailableError {
  return error instanceof PlanningShellStateUnavailableError;
}
