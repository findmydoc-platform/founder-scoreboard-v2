export type WorkspaceIdentity = { userId: string; subject: string; email: string };
type IdentityUser = { id: string; identities?: { provider: string; identity_data?: Record<string, unknown> }[] };

export class WorkspaceAccessError extends Error {
  constructor(public readonly status: 403 | 503, public readonly code: "workspace_access_denied" | "workspace_access_unavailable" | "workspace_link_required" | "workspace_google_login_required") {
    super(code === "workspace_link_required" ? "Google-Konto muss verknüpft werden."
      : code === "workspace_google_login_required" ? "Bitte neu mit Google anmelden."
        : status === 403 ? "Kein freigegebener Google-Workspace-Zugang." : "Workspace-Zugang konnte vorübergehend nicht geprüft werden.");
  }
}

// Call only with the user returned by Supabase Auth, never a browser-supplied user object.
export function workspaceIdentity(user: IdentityUser): WorkspaceIdentity {
  const identities = user.identities?.filter(identity => identity.provider === "google") || [];
  const data = identities.length === 1 ? identities[0].identity_data : null;
  const claims = data?.custom_claims as Record<string, unknown> | undefined;
  if (!data || !["https://accounts.google.com", "accounts.google.com"].includes(String(data.iss))
    || data.email_verified !== true || claims?.hd !== "findmydoc.eu"
    || typeof data.sub !== "string" || !data.sub || typeof data.email !== "string" || !data.email) {
    throw new WorkspaceAccessError(403, "workspace_access_denied");
  }
  return { userId: user.id, subject: data.sub, email: data.email };
}

export function workspaceAvatarUrl(identityData: Record<string, unknown>): string | undefined {
  const picture = identityData.picture;
  if (typeof picture !== "string" || !picture || picture.length > 2048) return undefined;
  try {
    const url = new URL(picture);
    if (url.protocol !== "https:" || !url.hostname.endsWith(".googleusercontent.com") || url.username || url.password || url.port) return undefined;
    return url.href;
  } catch {
    return undefined;
  }
}

export async function authorizeWorkspaceIdentity(user: IdentityUser, isMember: (email: string) => Promise<boolean>) {
  const identity = workspaceIdentity(user);
  let member: boolean;
  try { member = await isMember(identity.email); }
  catch { throw new WorkspaceAccessError(503, "workspace_access_unavailable"); }
  if (!member) throw new WorkspaceAccessError(403, "workspace_access_denied");
  return identity;
}
