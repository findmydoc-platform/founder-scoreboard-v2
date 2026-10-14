import "server-only";
import { getVercelOidcToken } from "@vercel/oidc";

let readerToken: { value: string; expiresAt: number; audience: string; account: string } | undefined;

async function jsonRequest(url: string, init: RequestInit) {
  const response = await fetch(url, { ...init, cache: "no-store", signal: AbortSignal.timeout(5000) });
  if (!response.ok) throw new Error("Workspace directory unavailable");
  return response.json();
}

export async function isWorkspaceGroupMember(email: string): Promise<boolean> {
  const audience = process.env.GOOGLE_WORKLOAD_IDENTITY_AUDIENCE;
  const account = process.env.GOOGLE_WORKSPACE_SERVICE_ACCOUNT;
  const group = process.env.GOOGLE_AUTHORIZED_GROUP;
  if (!audience || !account || group !== "internal-tool-founder-ops-access@findmydoc.eu") throw new Error("Workspace directory configuration missing");
  if (!readerToken || readerToken.expiresAt < Date.now() + 60_000 || readerToken.account !== account || readerToken.audience !== audience) {
    const exchange = await jsonRequest("https://sts.googleapis.com/v1/token", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ audience, grantType: "urn:ietf:params:oauth:grant-type:token-exchange", requestedTokenType: "urn:ietf:params:oauth:token-type:access_token", scope: "https://www.googleapis.com/auth/cloud-platform", subjectTokenType: "urn:ietf:params:oauth:token-type:jwt", subjectToken: await getVercelOidcToken() }),
    });
    if (typeof exchange.access_token !== "string") throw new Error("Workspace token exchange failed");
    const impersonation = await jsonRequest(`https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/${encodeURIComponent(account)}:generateAccessToken`, {
      method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${exchange.access_token}` },
      body: JSON.stringify({ scope: ["https://www.googleapis.com/auth/admin.directory.group.member.readonly"], lifetime: "3600s" }),
    });
    const expiresAt = Date.parse(impersonation.expireTime);
    if (typeof impersonation.accessToken !== "string" || !Number.isFinite(expiresAt)) throw new Error("Workspace impersonation failed");
    readerToken = { value: impersonation.accessToken, expiresAt, account, audience };
  }
  // Cache the service credential only. Membership is queried on every authorization decision.
  const membership = await jsonRequest(`https://admin.googleapis.com/admin/directory/v1/groups/${encodeURIComponent(group)}/hasMember/${encodeURIComponent(email)}`, {
    headers: { authorization: `Bearer ${readerToken.value}` },
  });
  if (typeof membership.isMember !== "boolean") throw new Error("Invalid Workspace membership response");
  return membership.isMember;
}
