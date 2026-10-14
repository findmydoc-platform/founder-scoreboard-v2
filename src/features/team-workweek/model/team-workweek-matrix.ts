import type { Profile } from "@/lib/types";

export function teamWorkweekProfiles(profiles: Profile[]) {
  return [...profiles]
    .sort((left, right) => Number(right.platformRole === "ceo") - Number(left.platformRole === "ceo"));
}
