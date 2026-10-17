import { GitHubConnectionError } from "../../github-app-errors";
import "server-only";
import { serverPlanningAuth } from "./server-session-view";
import { safeRelativeNext } from "../../auth-redirect";
import type { GitHubConnectionInput, GitHubConnectionResult } from "../types";
import { createGitHubAppOAuthState, githubAppAuthorizationUrl, exchangeGitHubAppCode, githubUserForAppUserToken,
  storeGitHubAppUserToken, verifyGitHubAppOAuthState, oauthConnectionSnapshot, userVault } from "./github-user-vault";

export async function authorizeGitHubConnection(input:GitHubConnectionInput):Promise<GitHubConnectionResult> {
  if(input.credential.kind!=="github-oauth-request") throw new Error("GitHub-Verbindung kann nicht autorisiert werden.");
  const request=input.credential.request;
  const callback=new URL("/api/github-app/callback",request.url).toString();
  if(input.action==="github.connection.start") {
    const auth=await serverPlanningAuth();
    if(!auth.ok || !auth.profile) throw new Error("Anmeldung erforderlich.");
    const next=safeRelativeNext(request.nextUrl.searchParams.get("next"));
    const state=createGitHubAppOAuthState({userId:auth.user.id,profileId:auth.profile.id,next});
    return {ok:true,next,profileId:auth.profile.id,redirect:githubAppAuthorizationUrl({state,redirectUri:callback}).toString()};
  }
  const code=request.nextUrl.searchParams.get("code") || "";
  const raw=request.nextUrl.searchParams.get("state") || "";
  if(!code || !raw) throw new Error("GitHub Callback ist unvollständig.");
  const state=verifyGitHubAppOAuthState(raw);
  try {
  const auth=await serverPlanningAuth();
  if(!auth.ok || !auth.profile || auth.user.id!==state.userId || auth.profile.id!==state.profileId) throw new Error("GitHub-Verbindung passt nicht zur angemeldeten Person.");
  const expected=await oauthConnectionSnapshot(auth.profile);
  const token=await exchangeGitHubAppCode(code,callback);
  const githubUser=await githubUserForAppUserToken(token.access_token || "");
  await storeGitHubAppUserToken({supabase:userVault(),profile:auth.profile,githubUser,token,expected});
  return {ok:true,next:safeRelativeNext(state.next),profileId:auth.profile.id};
  } catch { throw new GitHubConnectionError(safeRelativeNext(state.next)); }
}
