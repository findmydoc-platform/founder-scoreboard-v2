import { normalizeProfileColor } from "@/features/profile/model/profile-color-policy";

export const profileColorConflictMessage = "Diese Profilfarbe ist nicht mehr verfügbar.";
export const profileColorConflictRefreshedMessage = `${profileColorConflictMessage} Die Farbauswahl wurde aktualisiert.`;
export const profileColorConflictRefreshFailedMessage = `${profileColorConflictMessage} Der aktuelle Farbstatus konnte nicht geladen werden. Bitte lade die Seite neu.`;

export class ProfileColorConflictError extends Error {
  constructor(message = profileColorConflictMessage) {
    super(message);
    this.name = "ProfileColorConflictError";
  }
}

type ProfileColorPayload = Readonly<{
  color?: unknown;
  profileColorDuplicateMode?: unknown;
}>;

type ProfileColorPatchResult =
  | { ok: true; patch: Record<string, string | boolean> }
  | { ok: false; status: 400; error: string };

export function buildProfileColorPatch(payload: ProfileColorPayload): ProfileColorPatchResult {
  if (payload.color === undefined) {
    if (payload.profileColorDuplicateMode !== undefined) {
      return { ok: false, status: 400, error: "Der Farbmodus ist ohne Farbänderung ungültig." };
    }
    return { ok: true, patch: {} };
  }

  const color = normalizeProfileColor(payload.color);
  if (!color) return { ok: false, status: 400, error: "Ungültige Profilfarbe." };
  if (typeof payload.profileColorDuplicateMode !== "boolean") {
    return { ok: false, status: 400, error: "Der Farbmodus fehlt." };
  }

  return {
    ok: true,
    patch: {
      profile_color: color,
      profile_color_duplicate_mode: payload.profileColorDuplicateMode,
    },
  };
}

export function mapProfileColorTransactionError(error: { code?: string } | null | undefined) {
  if (error?.code !== "P0001") return null;
  return { status: 409, error: profileColorConflictMessage };
}

export function profileColorConflictFeedback(status: number) {
  if (status !== 409) return null;
  return { message: profileColorConflictMessage, refreshProfiles: true };
}

export async function recoverProfileColorConflict(refreshProfiles: () => Promise<boolean>) {
  let refreshed = false;
  try {
    refreshed = await refreshProfiles();
  } catch {
    refreshed = false;
  }
  return new ProfileColorConflictError(
    refreshed ? profileColorConflictRefreshedMessage : profileColorConflictRefreshFailedMessage,
  );
}
