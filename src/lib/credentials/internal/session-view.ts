import "server-only";
import { createHash } from "node:crypto";
import type { Session, User } from "@supabase/supabase-js";
import type { ServerSessionView } from "../session-types";

const metadataString = (value: unknown) => typeof value === "string" ? value : "";
const displayIdentity = (user: User) => ({ id: user.id, ...(user.email ? { email: user.email } : {}),
  displayName: metadataString(user.user_metadata?.full_name || user.user_metadata?.name), avatarUrl: metadataString(user.user_metadata?.avatar_url),
  ...(typeof (user.user_metadata?.user_name || user.user_metadata?.preferred_username) === "string" ? { githubLogin: String(user.user_metadata?.user_name || user.user_metadata?.preferred_username) } : {}) });

export const sessionRevision = (session: Session) => createHash("sha256").update(`${session.access_token}\0${session.refresh_token}`).digest("hex");

export function projectSessionView(session: Session, verifiedUser: User): ServerSessionView {
  return { user: displayIdentity(verifiedUser), userId: verifiedUser.id, revision: sessionRevision(session), expiresAt: session.expires_at || 0 };
}
