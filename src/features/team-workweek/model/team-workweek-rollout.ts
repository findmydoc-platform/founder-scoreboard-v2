import type { PlatformRole } from "@/lib/types";

export const TEAM_WORKWEEK_STARTER_ENV = "FOUNDEROPS_TEAM_WORKWEEK_STARTER_ENABLED";
export const TEAM_WORKWEEK_STARTER_SIZE = 5;

export function isTeamWorkweekStarterEnabled(value: string | undefined) {
  return value === "true";
}

export function isStarterPlatformRole(role: PlatformRole | null | undefined) {
  return role === "ceo" || role === "founder";
}
