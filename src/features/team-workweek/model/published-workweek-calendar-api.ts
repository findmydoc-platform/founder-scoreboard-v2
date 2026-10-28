import type { BrowserApiClient } from "@/lib/browser-api-client";
import type { WorkweekCalendarResponse, WorkweekCalendarScope } from "./published-workweek-calendar-state";
export async function readPublishedWorkweekCalendar(apiClient: BrowserApiClient, scope: WorkweekCalendarScope): Promise<WorkweekCalendarResponse> {
  const { response, body } = await apiClient.requestJson<WorkweekCalendarResponse & { error?: string }>(`/api/team-workweek/team?from=${scope.from}&to=${scope.to}`, { cache: "no-store" });
  if (!response.ok || !body?.currentWorkweeks || !body.referenceDate || scope.policy === "header-month" && !body.calendarWorkweeks) throw Object.assign(new Error(body?.error || (scope.policy === "team-week" ? "Veröffentlichte Grundwochen konnten nicht geladen werden." : "Arbeitszeiten konnten nicht geladen werden.")), { status: response.status });
  return body;
}
