import "server-only";

import { getServerServiceRoleSupabase } from "@/lib/supabase-service-role";
import { workspaceAvatarUrl, workspaceIdentity } from "@/lib/workspace-identity";
import type { Profile } from "@/lib/types";

function withWorkspaceAvatar(profile: Profile, data: unknown): Profile {
  if (!data || typeof data !== "object" || Array.isArray(data)) return profile;
  const context = data as Record<string, unknown>;
  if (context.profileId !== profile.id || context.linked !== true || typeof context.userId !== "string"
    || !context.identity || typeof context.identity !== "object" || Array.isArray(context.identity)) return profile;

  try {
    const identity = context.identity as Record<string, unknown>;
    workspaceIdentity({ id: context.userId, identities: [{ provider: "google", identity_data: identity }] });
    const avatarUrl = workspaceAvatarUrl(identity);
    return avatarUrl ? { ...profile, avatarUrl } : profile;
  } catch {
    return profile;
  }
}

export async function withWorkspaceProfileAvatars(profiles: Profile[]): Promise<Profile[]> {
  if (profiles.length === 0) return profiles;
  const service = getServerServiceRoleSupabase();
  if (!service) return profiles;

  try {
    const { data, error } = await service.rpc("workspace_access_contexts", { p_profile_ids: profiles.map((profile) => profile.id) });
    if (error) {
      if (error.code !== "PGRST202" && error.code !== "42883") return profiles;
    } else if (Array.isArray(data) && data.length === profiles.length) {
      return profiles.map((profile, index) => withWorkspaceAvatar(profile, data[index]));
    } else {
      return profiles;
    }
  } catch {
    return profiles;
  }

  // A missing batch RPC can occur while the application and schema are rolling out.
  return Promise.all(profiles.map(async (profile) => {
    try {
      const { data, error } = await service.rpc("workspace_access_context", { p_profile_id: profile.id });
      return error ? profile : withWorkspaceAvatar(profile, data);
    } catch {
      return profile;
    }
  }));
}
