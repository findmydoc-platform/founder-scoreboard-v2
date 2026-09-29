import "server-only";

import { getServerServiceRoleSupabase } from "@/lib/supabase-service-role";
import { workspaceAvatarUrl, workspaceIdentity } from "@/lib/workspace-identity";
import type { Profile } from "@/lib/types";

export async function withWorkspaceProfileAvatars(profiles: Profile[]): Promise<Profile[]> {
  const service = getServerServiceRoleSupabase();
  if (!service) return profiles;

  return Promise.all(profiles.map(async (profile) => {
    try {
      const { data, error } = await service.rpc("workspace_access_context", { p_profile_id: profile.id });
      if (error || data?.profileId !== profile.id || data.linked !== true || typeof data.userId !== "string"
        || !data.identity || typeof data.identity !== "object" || Array.isArray(data.identity)) return profile;

      workspaceIdentity({ id: data.userId, identities: [{ provider: "google", identity_data: data.identity }] });
      const avatarUrl = workspaceAvatarUrl(data.identity);
      return avatarUrl ? { ...profile, avatarUrl } : profile;
    } catch {
      return profile;
    }
  }));
}
