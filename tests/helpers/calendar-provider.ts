import type { GoogleCalendarCapability, GoogleCalendarMutation } from "../../src/lib/credentials/types";
import type { WorkweekProviderWriteJournal } from "../../src/features/team-workweek/server/team-workweek-immediate-effects";

export function calendarProvider(provider: typeof fetch = (url, init) => fetch(url, init), dispatch: (binding: GoogleCalendarMutation) => Promise<void> = async () => {}): GoogleCalendarCapability {
  return {
    request: provider,
    async mutate(binding, url, init) {
      await dispatch(binding);
      return provider(url, init);
    },
  };
}

export const observedJournal: WorkweekProviderWriteJournal = {
  target: {kind: "publication", operationId: "test-operation", targetId: "test-effect"},
  outcome: async () => {},
};
