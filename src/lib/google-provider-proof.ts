import "server-only";
import type { WorkspaceIdentity } from "./workspace-identity";

export async function verifyGoogleProviderToken(providerToken: string | null | undefined, identity: WorkspaceIdentity) {
  if (!providerToken) throw new Error("Google provider token unavailable");
  const response = await fetch("https://openidconnect.googleapis.com/v1/userinfo", {
    headers: { Authorization: `Bearer ${providerToken}` },
    cache: "no-store",
    signal: AbortSignal.timeout(5000),
  });
  if (!response.ok) throw new Error("Google provider verification failed");
  const userInfo = await response.json();
  if (userInfo.sub !== identity.subject || userInfo.email !== identity.email
    || userInfo.email_verified !== true || userInfo.hd !== "findmydoc.eu") {
    throw new Error("Google provider identity mismatch");
  }
}
