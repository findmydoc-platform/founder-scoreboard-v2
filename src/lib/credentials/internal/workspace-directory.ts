import "server-only";
import { observedDirectoryFetch } from "./observed-fetch";
import { classifyCalendarError, observeCalendarPhase, recordCalendarFailure, recordDirectoryCredential } from "../../runtime-logging";
import { getVercelOidcToken } from "@vercel/oidc";

let readerToken: { value: string; expiresAt: number; audience: string; account: string } | undefined;

function invalidResponse(operation: "directory.sts" | "directory.iam" | "directory.membership", message: string): never {
  recordCalendarFailure({ operation, errorCode: "provider_response_invalid", errorCategory: "invalid_response" });
  throw new Error(message);
}

async function oidcToken() {
  return observeCalendarPhase("directory.oidc", async () => {
    try { return await getVercelOidcToken(); } catch (error) {
      recordCalendarFailure({ operation: "directory.oidc", errorCode: "provider_request_failed", errorCategory: classifyCalendarError(error) });
      throw error;
    }
  });
}

async function jsonRequest<T>(operation: "directory.sts" | "directory.iam" | "directory.membership", url: string, init: RequestInit,
  validate: (value: Awaited<ReturnType<Response["json"]>>) => T) {
  return observeCalendarPhase(operation, async () => {
    const response = await observedDirectoryFetch(operation, url, { ...init, cache: "no-store", signal: AbortSignal.timeout(5000) });
    if (!response.ok) throw new Error("Workspace directory unavailable");
    let value;
    try { value = await response.json(); } catch (error) {
      recordCalendarFailure({ operation, errorCode: "provider_response_invalid", errorCategory: "invalid_response" });
      throw error;
    }
    return validate(value);
  });
}

export async function isWorkspaceGroupMember(email: string): Promise<boolean> {
  const audience = process.env.GOOGLE_WORKLOAD_IDENTITY_AUDIENCE;
  const account = process.env.GOOGLE_WORKSPACE_SERVICE_ACCOUNT;
  const group = process.env.GOOGLE_AUTHORIZED_GROUP;
  if (!audience || !account || group !== "internal-tool-founder-ops-access@findmydoc.eu") {
    recordCalendarFailure({ operation: "directory.reader", errorCode: "provider_configuration_invalid", errorCategory: "configuration_error" });
    throw new Error("Workspace directory configuration missing");
  }
  await observeCalendarPhase("directory.reader", async () => {
    if (!readerToken || readerToken.expiresAt < Date.now() + 60_000 || readerToken.account !== account || readerToken.audience !== audience) {
      const exchange = await jsonRequest("directory.sts", "https://sts.googleapis.com/v1/token", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ audience, grantType: "urn:ietf:params:oauth:grant-type:token-exchange", requestedTokenType: "urn:ietf:params:oauth:token-type:access_token", scope: "https://www.googleapis.com/auth/cloud-platform", subjectTokenType: "urn:ietf:params:oauth:token-type:jwt", subjectToken: await oidcToken() }),
      }, value => {
        if (typeof value?.access_token !== "string") invalidResponse("directory.sts", "Workspace token exchange failed");
        return value.access_token as string;
      });
      const impersonation = await jsonRequest("directory.iam", `https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/${encodeURIComponent(account)}:generateAccessToken`, {
        method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${exchange}` },
        body: JSON.stringify({ scope: ["https://www.googleapis.com/auth/admin.directory.group.member.readonly"], lifetime: "3600s" }),
      }, value => {
        const expiresAt = Date.parse(value?.expireTime);
        if (typeof value?.accessToken !== "string" || !Number.isFinite(expiresAt) || expiresAt <= Date.now()) invalidResponse("directory.iam", "Workspace impersonation failed");
        return { value: value.accessToken as string, expiresAt };
      });
      readerToken = { ...impersonation, account, audience };
      recordDirectoryCredential("renewed");
    }
    else recordDirectoryCredential("reused");
  });
  // The authority owns membership evidence. This adapter caches only its service credential.
  const membership = await jsonRequest("directory.membership", `https://admin.googleapis.com/admin/directory/v1/groups/${encodeURIComponent(group)}/hasMember/${encodeURIComponent(email)}`, {
    headers: { authorization: `Bearer ${readerToken!.value}` },
  }, value => {
    if (typeof value?.isMember !== "boolean") invalidResponse("directory.membership", "Invalid Workspace membership response");
    return value.isMember as boolean;
  });
  return membership;
}
