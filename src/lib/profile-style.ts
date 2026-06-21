import type { Profile } from "@/lib/types";

export const defaultProfileColor = "#64748b";

export function profileColor(profile?: Pick<Profile, "color"> | null) {
  return profile?.color || defaultProfileColor;
}
