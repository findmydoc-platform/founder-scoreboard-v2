import type { PlatformRole } from "@/lib/types";

export const TEAM_WORKWEEK_STARTER_SIZE = 5;

export function isStarterPlatformRole(role: PlatformRole | null | undefined) {
  return role === "ceo" || role === "founder";
}
