export const planningDataUnavailableMessage = "Planungsdaten sind vorübergehend nicht verfügbar. Bitte versuche es erneut.";

export class PlanningDataUnavailableError extends Error {
  constructor() {
    super(planningDataUnavailableMessage);
    this.name = "PlanningDataUnavailableError";
  }
}

export function isPlanningDataUnavailableError(error: unknown): error is PlanningDataUnavailableError {
  return error instanceof PlanningDataUnavailableError;
}
