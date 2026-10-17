import {generateKeyPairSync} from "node:crypto";
import {afterEach,beforeEach,expect,test,vi} from "vitest";
import {cronWebhookProtocol} from "../../helpers/cron-webhook-protocol.mjs";
import {importTestModule} from "../../helpers/vitest-module.mjs";
let fixture;
beforeEach(()=>{vi.resetModules();fixture=cronWebhookProtocol();const {privateKey}=generateKeyPairSync("rsa",{modulusLength:2048});vi.stubEnv("GITHUB_APP_ID","123");vi.stubEnv("GITHUB_APP_INSTALLATION_ID","42");vi.stubEnv("GITHUB_APP_PRIVATE_KEY",privateKey.export({type:"pkcs8",format:"pem"}));});
afterEach(()=>{vi.unstubAllGlobals();vi.unstubAllEnvs();vi.useRealTimers();});

test("lifecycle-only installation access requires its concrete claimed job even outside a trigger",async()=>{
 const {authorizeCredentialAction}=await importTestModule("src/lib/credentials/index.ts",{"server-only":{}});await expect(authorizeCredentialAction({credential:{kind:"github-installation"},action:"github.lifecycle.apply",target:{repositories:["findmydoc-platform/management"]}})).rejects.toThrow("job");expect(fixture.state.tokenRequests).toBe(0);expect(fixture.state.providerRequests).toHaveLength(0);
});

const lockToken="11111111-1111-4111-8111-111111111111";
const jobId="22222222-2222-4222-8222-222222222222";
function seed(family="comment-webhook",id=jobId,token=lockToken,extra={}){
 const table=family==="comment-webhook"?"github_webhook_deliveries":family==="planning-webhook"?"github_planning_webhook_deliveries":family==="planning-lifecycle"?"planning_github_lifecycle_outbox":"planning_github_projection_outbox";const key=table.includes("outbox")?"id":"delivery_id";fixture.state.liveClaims.set(table+":"+id,{[key]:id,status:"processing",lock_token:token,locked_at:new Date().toISOString(),...extra});return {family,id,lockToken:token};
}
async function access(claim,action=claim.family==="planning-projection"?"github.projection.apply":claim.family==="planning-lifecycle"?"github.lifecycle.apply":"github.issue.read"){
 const {authorizeCredentialAction}=await importTestModule("src/lib/credentials/index.ts",{"server-only":{}});return authorizeCredentialAction({credential:{kind:"github-claimed-job",claim},action,target:{repositories:["findmydoc-platform/management"]}});
}
async function readComment(github){const {getGitHubIssueComment}=await importTestModule("src/lib/github.ts");return getGitHubIssueComment(404,github,"findmydoc-platform/management");}

test.each(["comment-webhook","planning-webhook","planning-projection","planning-lifecycle"])("an independently valid %s claim can use only its established installation action",async family=>{
 const claim=seed(family);const {github}=await access(claim);expect(await readComment(github)).toMatchObject({id:404});expect(fixture.state.providerRequests).toHaveLength(1);expect(fixture.state.ownerReads.length).toBeGreaterThan(1);
});

test.each(["missing","wrong-token","completed","expired","unknown-family","wrong-action"])("the public claimed-job seam rejects %s before provider acquisition",async mode=>{
 const claim=seed();if(mode==="missing")fixture.state.liveClaims.clear();if(mode==="wrong-token")claim.lockToken="33333333-3333-4333-8333-333333333333";if(mode==="completed")seed("comment-webhook",jobId,lockToken,{status:"ignored"});if(mode==="expired")seed("comment-webhook",jobId,lockToken,{locked_at:new Date(Date.now()-120000).toISOString()});if(mode==="unknown-family")claim.family="unknown-job";
 await expect(access(claim,mode==="wrong-action"?"github.projection.apply":"github.issue.read")).rejects.toThrow("job claim");expect(fixture.state.tokenRequests).toBe(0);expect(fixture.state.providerRequests).toHaveLength(0);
});

test("a claimed job cannot select the unrelated installation-status credential contract",async()=>{
 const claim=seed();const {authorizeCredentialAction}=await importTestModule("src/lib/credentials/index.ts",{"server-only":{}});expect(await authorizeCredentialAction({credential:{kind:"github-claimed-job",claim},action:"github.installation.status"})).toMatchObject({ok:false,status:403});
});

test("the selected later job does not depend on an unrelated stale batch member",async()=>{
 seed("planning-projection","44444444-4444-4444-8444-444444444444",lockToken,{locked_at:new Date(Date.now()-180000).toISOString()});const selected=seed("planning-projection");const {github}=await access(selected);await readComment(github);expect(fixture.state.providerRequests).toHaveLength(1);expect(fixture.state.ownerReads.every(read=>read.id===selected.id)).toBe(true);
});

test.each(["reclaimed","renewed-timestamp"])("token issuance cannot rebind a %s claim",async change=>{
 const claim=seed();fixture.state.beforeToken=async()=>{const row=fixture.state.liveClaims.get("github_webhook_deliveries:"+claim.id);if(change==="reclaimed")row.lock_token="33333333-3333-4333-8333-333333333333";else row.locked_at=new Date(Date.parse(row.locked_at)+1).toISOString();};await expect(access(claim)).rejects.toThrow("job claim");expect(fixture.state.providerRequests).toHaveLength(0);
});

test("the original deadline is checked synchronously after the final ownership await",async()=>{
 vi.useFakeTimers({toFake:["Date"]});const now=new Date("2026-10-17T10:00:00Z").getTime();vi.setSystemTime(now);const claim=seed();const {github}=await access(claim);fixture.state.beforeOwnerResponse=async()=>vi.setSystemTime(now+120000);await expect(readComment(github)).rejects.toThrow("job claim");expect(fixture.state.providerRequests).toHaveLength(0);
});

test("caller mutation while ownership verification waits cannot change the captured job identity",async()=>{
 const claim=seed();let release,started;const gate=new Promise(resolve=>{release=resolve;}),entered=new Promise(resolve=>{started=resolve;});let held=false;fixture.state.beforeOwnerResponse=async()=>{if(!held){held=true;started();await gate;}};const pending=access(claim);await entered;claim.id="forged-later-job";claim.lockToken="33333333-3333-4333-8333-333333333333";release();const {github}=await pending;await readComment(github);expect(fixture.state.ownerReads.every(read=>read.id===jobId)).toBe(true);expect(fixture.state.providerRequests).toHaveLength(1);
});