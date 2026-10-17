import { FOUNDEROPS_DELIVERY_SECRET_HEADER, validateDeliverySecret } from "../../delivery-auth";
import { taskDetailPermissions } from "@/features/tasks/model/task-detail-permissions";
import "server-only";
import { GitHubApiError, githubRequest, type GitHubRequestOptions } from "../../github-http";
import { requireAllowedGitHubRepository } from "../../github-repositories";
import { GitHubAppUserTokenRequiredError } from "../../github-app-errors";
import type { AuthenticatedProfile } from "../../types";
import type { GitHubAuthoredCredentialInput, GitHubAuthoredCredentialResult, GitHubAttachmentInput, GitHubUserCapability, GitHubSessionInput } from "../types";
import { authorizeSessionPolicy } from "./session-policy";
import { githubUserConfiguration, boundUserConnection, getGitHubUserTokenForProfile, getGitHubUserConnectionStatus, revokeGitHubAppUserConnection, userVault } from "./github-user-vault";

function required() { return new GitHubAppUserTokenRequiredError("GitHub-App-Verbindung fehlt. Bitte verbinde GitHub einmal neu."); }
async function authoredContext(input: GitHubAuthoredCredentialInput) {
  let assertAuthority = () => {};
  if(input.credential.kind==="github-comment-preview") {
    const request=input.credential.request;
    const secret=request.headers.get(FOUNDEROPS_DELIVERY_SECRET_HEADER)?.trim() || "";
    if (secret) {
      if (!validateDeliverySecret(secret)) throw new Error("Keine Berechtigung für die GitHub-Vorschau.");
      assertAuthority = () => { if (!validateDeliverySecret(secret)) throw new Error("Keine Berechtigung für die GitHub-Vorschau."); };
    } else {
      const permission = await authorizeSessionPolicy(request,"operations.lead");
      if (!permission.ok || !("assertCurrent" in permission)) throw new Error("Keine Berechtigung für die GitHub-Vorschau.");
      assertAuthority = permission.assertCurrent;
    }
  }
  const supabase=userVault();
  const review=input.credential.kind==="github-review-delivery";
  const id=input.credential.kind==="github-review-delivery" ? input.credential.reviewId : input.credential.commentId;
  const delivery=await supabase.from(review ? "task_review_github_deliveries" : "task_comment_github_deliveries")
    .select("task_id,author_profile_id,status,lock_token,locked_at").eq(review ? "task_review_id" : "task_comment_id",id).maybeSingle();
  const row=delivery.data;
  if(delivery.error || !row?.author_profile_id) throw required();
  const claimDeadline = Date.parse(row.locked_at || "") + 120000;
  if(input.credential.kind!=="github-comment-preview") {
    if(row.status!=="processing" || row.lock_token!==input.credential.claimToken || !Number.isFinite(claimDeadline) || claimDeadline<=Date.now()) throw new Error("GitHub-Zustellungsreservierung ist nicht mehr gültig.");
    assertAuthority = () => { if (Date.now() >= claimDeadline) throw new Error("GitHub-Zustellungsreservierung ist nicht mehr gültig."); };
  }
  const source=await supabase.from(review ? "task_reviews" : "task_comments")
    .select(review ? "id,task_id,reviewer_profile_id" : "id,task_id,profile_id").eq("id",id).maybeSingle<{id:number;task_id:string;profile_id?:string;reviewer_profile_id?:string}>();
  if(source.error || source.data?.task_id!==row.task_id || source.data?.[review ? "reviewer_profile_id" : "profile_id"]!==row.author_profile_id) throw required();
  const task=await supabase.from("active_tasks").select("id,github_repo,github_issue_number,issue_number").eq("id",row.task_id).maybeSingle();
  if(task.error || !task.data) throw new Error("GitHub-Aufgabe wurde nicht gefunden.");
  const repository=requireAllowedGitHubRepository(task.data.github_repo);
  const issue=task.data.github_issue_number || Number(task.data.issue_number?.replace(/^#/,""));
  if(!Number.isSafeInteger(issue) || issue<=0) throw new Error("GitHub Issue-Verknüpfung fehlt.");
  return {assertCurrent:assertAuthority,profileId:row.author_profile_id as string,repository,issue,marker:`fmd-${review ? "review" : "comment"}-id:${id}`};
}
async function capability(profileId:string,check:()=>Promise<()=>void>,permitted:(url:URL,options:Omit<GitHubRequestOptions,"token">)=>boolean):Promise<GitHubUserCapability> {
  const configuration=githubUserConfiguration();
  const connection=await boundUserConnection(profileId);
  const profile={id:profileId} as AuthenticatedProfile;
  // Validate usability before returning; no decrypted value escapes this module.
  const initialToken=await getGitHubUserTokenForProfile(userVault(),profile,connection.connection_id,configuration);
  const initialAuthority=await check();
  const initialBinding=await boundUserConnection(profileId);
  if(initialBinding.connection_id!==connection.connection_id) throw required();
  if(githubUserConfiguration()!==configuration) throw required();
  initialAuthority();
  if(Date.now()>=initialToken.expiresAt) throw required();
  return Object.freeze({async request(value:string,input:Omit<GitHubRequestOptions,"token">) {
    const options={...input,...(input.body===undefined?{}:{body:structuredClone(input.body)})};
    const url=new URL(value);
    if(url.protocol!=="https:" || url.hostname!=="api.github.com" || url.username || url.password || url.port || url.hash || !permitted(url,options)) throw new Error("GitHub-Aktion oder Ziel ist nicht freigegeben.");
    await check();
    const current=await boundUserConnection(profileId);
    if(current.connection_id!==connection.connection_id) throw required();
    const acquired=await getGitHubUserTokenForProfile(userVault(),profile,connection.connection_id,configuration);
    const token=acquired.token;
    try { return await githubRequest(value,{...options,token} as GitHubRequestOptions,async()=> {
      const assertAuthority=await check();
      const finalBinding=await boundUserConnection(profileId);
      if(finalBinding.connection_id!==connection.connection_id) throw required();
      return () => {
        if(githubUserConfiguration()!==configuration) throw required();
        assertAuthority();
        if(Date.now()>=acquired.expiresAt) throw required();
      };
    }); }
    catch(error) {
      if(error instanceof GitHubApiError) throw new GitHubApiError(error.message.split(token).join("[redacted]"),error);
      throw error;
    }
  }});
}
export async function authorizeAuthoredGitHub(input:GitHubAuthoredCredentialInput):Promise<GitHubAuthoredCredentialResult> {
  const expected = input.action === "github.comment.deliver" ? "github-comment-delivery" : input.action === "github.comment.preview" ? "github-comment-preview" : "github-review-delivery";
  if(input.credential.kind!==expected) throw required();
  input = input.action === "github.comment.preview"
    ? { action: input.action, credential: { ...input.credential } }
    : structuredClone(input);
  const context=await authoredContext(input);
  const prefix=`/repos/${context.repository}/issues/${context.issue}/comments`;
  const github=await capability(context.profileId,async()=> {
    const current=await authoredContext(input);
    if(current.profileId!==context.profileId || current.repository!==context.repository || current.issue!==context.issue) throw required();
    return current.assertCurrent;
  },(url,options)=> {
    if(url.pathname!==prefix) return false;
    if((options.method||"GET")==="GET" && options.operation!=="mutation") return true;
    return input.action!=="github.comment.preview" && options.method==="POST" && options.operation==="mutation"
      && typeof (options.body as {body?:unknown})?.body==="string" && (options.body as {body:string}).body.includes(`<!-- ${context.marker} -->`);
  });
  return {ok:true,github};
}
export async function authorizeGitHubAttachment(input:GitHubAttachmentInput):Promise<GitHubAuthoredCredentialResult> {
  const permission=await authorizeSessionPolicy(input.credential.request,"planning.contribute");
  if(!permission.ok || !permission.profile) throw required();
  const profileId=permission.profile.id;
  const repository=requireAllowedGitHubRepository(input.target.repository);
  const path=input.target.path;
  const taskId=input.target.taskId;
  if(!path.startsWith(`.fmd-attachments/tasks/${taskId}/`) || path.split("/").some(part=>part===".." || part===".")) throw new Error("GitHub-Anhangsziel ist ungültig.");
  const expected=`/repos/${repository}/contents/${path.split("/").map(encodeURIComponent).join("/")}`;
  async function checkTask(profile:AuthenticatedProfile) {
    const task=await userVault().from("active_tasks").select("id,task_type,status,assignee,owner,review_owner_profile_id,review_status,score_final,github_repo").eq("id",taskId).maybeSingle();
    if(task.error || !task.data || !["deliverable","sub_issue"].includes(task.data.task_type) || requireAllowedGitHubRepository(task.data.github_repo)!==repository) throw new Error("GitHub-Aufgabe wurde nicht gefunden.");
    const row=task.data;
    const permissions=taskDetailPermissions({task:{assignee:row.assignee||"",assigneeId:row.assignee||"",owner:row.owner||"",ownerId:row.owner||"",reviewOwnerProfileId:row.review_owner_profile_id||"",reviewStatus:row.review_status||"not_requested",scoreFinal:Boolean(row.score_final),status:row.status,taskType:row.task_type},profile});
    if(!(row.task_type==="deliverable" ? permissions.canEditEvidence : permissions.canEditBrief)) throw new Error("Du darfst für dieses Issue keine Anhänge hochladen.");
  }
  await checkTask(permission.profile);
  return {ok:true,github:await capability(profileId,async()=> {
    const current=await authorizeSessionPolicy(input.credential.request,"planning.contribute");
    if(!current.ok || current.profile?.id!==profileId) throw required();
    await checkTask(current.profile);
    if (!("assertCurrent" in current)) throw required();
    return current.assertCurrent;
  },(url,options)=>url.pathname===expected && ((options.method||"GET")==="GET" || (options.method==="PUT" && options.operation==="mutation")))};
}
export async function githubConnectionSession(input:GitHubSessionInput) {
  const permission=await authorizeSessionPolicy(input.credential.request,"team.read");
  if(!permission.ok || !permission.profile) throw required();
  if(input.action==="github.connection.disconnect") {
    await revokeGitHubAppUserConnection(userVault(),permission.profile);
    return {ok:true as const};
  }
  return getGitHubUserConnectionStatus(userVault(),permission.profile);
}
