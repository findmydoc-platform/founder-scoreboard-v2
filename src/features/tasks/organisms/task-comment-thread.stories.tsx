import { useState, useSyncExternalStore } from "react";
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, userEvent, waitFor, within } from "storybook/test";
import { TaskCommentThread } from "./task-comment-thread";
import { useTaskCollaborationCommands } from "@/features/tasks/hooks/use-task-collaboration-commands";
import { createBrowserPlanningState } from "@/features/planning/model/internal/browser-planning-state";
import { emptyPlanningShellState } from "@/features/planning/model/planning-shell-state";
import { emptyPlanningHeaderData } from "@/lib/planning-header-data";
import { taskDetailStoryTask } from "@/features/tasks/molecules/task-detail-story-fixtures";
import type { BrowserApiClient, BrowserApiJsonResult } from "@/lib/browser-api-client";
import type { Profile, TaskComment } from "@/lib/types";
const task=taskDetailStoryTask({id:"comment-task",title:"Delivery task",updatedAt:"task-r1"});
const profile:Profile={id:"author",name:"Author",platformRole:"ceo",orgRole:"CEO",githubLogin:"author",weeklyCapacity:40};
const text="Submitted comment";
const controls=new Map<string,{finishCreate():void;finishAt(index:number):void;finishRead():void;endSession():void;writes():number;reads():number}>();
function Fixture({scenario="success"}:{scenario?:string}){
 const[network]=useState(()=>{
  let writes=0,reads=0,stored=false,finishCreate=()=>{},finishRead=()=>{};
  const completions: (()=>void)[] = [];
  const comment:TaskComment={id:7,taskId:task.id,profileId:profile.id,comment:text,createdAt:"2026-10-28T00:00:00Z",githubDeliveryStatus:scenario==="delivery-failed"?"failed":scenario==="notice"?"waiting_for_author_connection":"pending",githubCommentUrl:""};
  const client:BrowserApiClient={async requestJson<T>(url:Parameters<BrowserApiClient["requestJson"]>[0],options?:Parameters<BrowserApiClient["requestJson"]>[1]){
   if(options?.method){writes++;expect(options.json).toMatchObject({comment:["consecutive","retry"].includes(scenario)?expect.any(String):text,submissionId:expect.any(String),submittedAt:expect.any(String)});const submission=options.json as {submissionId:string;submittedAt:string};comment.submissionId=submission.submissionId;comment.submittedAt=submission.submittedAt;if(scenario==="rejected" || scenario==="retry" && writes===1)return{response:new Response(null,{status:403}),body:{error:"Rejected by policy"} as T};stored=true;if(["unknown","lost-confirmed"].includes(scenario))return{response:new Response(null,{status:503}),body:{error:"Confirmation lost"} as T};const row=["consecutive","retry"].includes(scenario)?{...comment,id:7+writes,comment:(options.json as {comment:string}).comment,createdAt:`2026-11-07T00:00:0${3-writes}Z`}:comment;const body={comment:row,notice:["notice","notice-with-pending"].includes(scenario)?{code:"github_author_connection_required",level:"info",message:"Kommentar gespeichert. Veröffentlichung wartet auf deine GitHub-Verbindung."}:null};if(["retry","consecutive","pending","typing","session","typing-remount","same-text-remount","rejection-remount"].includes(scenario))return new Promise<BrowserApiJsonResult<T>>(resolve=>{finishCreate=()=>resolve(scenario==="rejection-remount"?{response:new Response(null,{status:403}),body:{error:"Rejected by policy"} as T}:{response:new Response(null),body:body as T});completions.push(finishCreate);});return{response:new Response(null),body:body as T};}
   reads++;if(String(url).includes("?submissionId=")){const body=scenario==="lost-confirmed"?{outcome:"confirmed",comment}:{outcome:"unconfirmed"};return new Promise<BrowserApiJsonResult<T>>(resolve=>{finishRead=()=>resolve({response:new Response(null),body:body as T});});}const model={revision:"discussion",project:emptyPlanningShellState.project,item:task,ancestors:[],children:[],relatedItems:[],people:[profile],sprints:[],discussion:{comments:stored?[comment]:[],externalComments:[]},blockers:[],relationships:[],activity:[],reviews:[],coverage:{discussion:"complete"}};const body={taskDetail:model};if(["old-read","unknown"].includes(scenario))return new Promise<BrowserApiJsonResult<T>>(resolve=>{finishRead=()=>resolve({response:new Response(null),body:body as T});});return{response:new Response(null),body:body as T};
  },requestForm:async()=>{throw new Error("Unexpected upload");},requestBlob:async()=>{throw new Error("Unexpected blob");}};
  return{client,finishCreate:()=>finishCreate(),finishAt:(index:number)=>completions[index](),finishRead:()=>finishRead(),writes:()=>writes,reads:()=>reads};
 });
 const[owner]=useState(()=>{const browser=createBrowserPlanningState({initialData:{...emptyPlanningShellState,tasks:[task],profiles:[profile]},initialWorkspace:"planning",initialUserId:`comment-story-${scenario}`,initialCurrentProfile:profile,initialHeaderData:emptyPlanningHeaderData});browser.runtime.session = {userId:browser.runtime.userId,revision:"story-session",expiresAt:4102444800,user:{id:browser.runtime.userId}}; browser.runtime.apiClient=network.client;return browser.owner;});
 useSyncExternalStore(owner.planning.subscribe,owner.internal.getSnapshot,owner.internal.getSnapshot);const data=owner.internal.getSnapshot(),current=owner.planning.taskDetail(task.id),discussion=owner.planning.taskComments(task.id);const[shown,setShown]=useState(true);
 const commands=useTaskCollaborationCommands({planningState:owner.planning,apiClient:network.client,currentProfile:profile,githubInstallationAvailable:false,githubUserConnected:false,selectedTask:current.task,data,source:"supabase",setSaveError:()=>{},startTransition:callback=>callback(),canChangeTaskStatus:()=>true,canCorrectOperationally:false,canManageFinalTaskStatus:true,canManageTaskMeta:true});
 controls.set(scenario,{...network,endSession:()=>owner.internal.sessionChanged(null)});
 return <main className="mx-auto grid max-w-3xl gap-3 p-4"><h1>Coordinated task comments</h1><h2>Task discussion</h2><button onClick={()=>setShown(value=>!value)}>Ansicht wechseln</button><button onClick={()=>void owner.planning.loadTaskDetail(task.id)}>Diskussion laden</button><p>Bestätigte Task-Version: {owner.planning.protectedCache()?.tasks[0]?.updatedAt||"Keine Aufgabe"}</p>{shown&&current.task?<TaskCommentThread commentDraft={owner.planning.taskCommentDraft(task.id)} comments={[...discussion.comments]} commentCreations={owner.planning.taskCommentCreations(task.id)} commentCompleteness={discussion.completeness} onRetryCommentCreation={id=>{void owner.planning.retryTaskCommentCreation(id);}} onCheckCommentCreation={id=>{void owner.planning.checkTaskCommentCreation(id);}} profiles={[profile]} tasks={[current.task]} currentProfileId={profile.id} onAddComment={value=>commands.addTaskComment(current.task!,value)}/>:<p>Andere Planning-Ansicht</p>}</main>;
}
const meta={title:"Features/Tasks/Organisms/CoordinatedTaskComments",component:Fixture,parameters:{layout:"fullscreen"}} satisfies Meta<typeof Fixture>;export default meta;type Story=StoryObj<typeof meta>;
export const EditableSessionDraft:Story={args:{scenario:"editable-draft"}};
async function submit(canvasElement:HTMLElement){const canvas=within(canvasElement);await userEvent.type(canvas.getByRole("textbox",{name:"Kommentar oder Update"}),text);await userEvent.click(canvas.getByRole("button",{name:"Kommentieren"}));return canvas;}
export const ConfirmedLocalCommentKeepsActualPendingDelivery:Story={args:{scenario:"success"},play:async({canvasElement})=>{const canvas=await submit(canvasElement);await waitFor(()=>expect(canvas.getByText(text)).toBeVisible());await userEvent.click(canvas.getByRole("button",{name:"GitHub-Veröffentlichung ausstehend"}));await expect(within(document.body).getByRole("tooltip")).toHaveTextContent("Kommentar gespeichert. GitHub-Veröffentlichung ausstehend.");await expect(canvas.getByRole("textbox",{name:"Kommentar oder Update"})).toHaveValue("");await expect(canvas.getByText("Bestätigte Task-Version: task-r1")).toBeVisible();expect(controls.get("success")!.reads()).toBe(0);expect(controls.get("success")!.writes()).toBe(1);}};
export const FailedExternalDeliveryDoesNotUndoLocalComment:Story={args:{scenario:"delivery-failed"},play:async({canvasElement})=>{const canvas=await submit(canvasElement);await expect(canvas.getByText(text)).toBeVisible();await expect(canvas.getByRole("button",{name:"GitHub-Veröffentlichung braucht Aufmerksamkeit"})).toBeVisible();await expect(canvas.getByRole("textbox",{name:"Kommentar oder Update"})).toHaveValue("");expect(controls.get("delivery-failed")!.writes()).toBe(1);}};
export const AuthorConnectionNoticeSurvivesNavigation: Story = { args: { scenario: "notice" }, play: async ({ canvasElement }) => {
 const canvas = await submit(canvasElement);
 await userEvent.click(canvas.getByRole("button", { name: "Ansicht wechseln" }));
 await userEvent.click(canvas.getByRole("button", { name: "Ansicht wechseln" }));
 await expect(canvas.queryByRole("button", { name: "Details zur Speicherung" })).not.toBeInTheDocument();
 await userEvent.click(canvas.getByRole("button", { name: "Wartet auf deine GitHub-Verbindung" }));
 await expect(within(document.body).getByRole("tooltip")).toHaveTextContent("Kommentar gespeichert. Veröffentlichung wartet auf deine GitHub-Verbindung.");
 await expect(canvas.getByText(text)).toBeVisible();
 expect(controls.get("notice")!.writes()).toBe(1);
} };
export const PendingCreateSurvivesNavigationWithoutFabricatedRecord:Story={args:{scenario:"pending"},play:async({canvasElement})=>{const canvas=await submit(canvasElement);await expect(canvas.getByRole("textbox",{name:"Kommentar oder Update"})).toHaveValue("");await expect(canvas.getByRole("textbox",{name:"Kommentar oder Update"})).toHaveFocus();expect(canvas.getAllByText(text)).toHaveLength(1);expect(canvas.getByText(text).closest("article")).not.toBeNull();await expect(canvas.queryByRole("button",{name:"GitHub-Veröffentlichung ausstehend"})).not.toBeInTheDocument();await userEvent.click(canvas.getByRole("button",{name:"Ansicht wechseln"}));controls.get("pending")!.finishCreate();await userEvent.click(canvas.getByRole("button",{name:"Ansicht wechseln"}));await waitFor(()=>expect(canvas.getByRole("button",{name:"GitHub-Veröffentlichung ausstehend"})).toBeVisible());expect(canvas.getAllByText(text)).toHaveLength(1);expect(controls.get("pending")!.writes()).toBe(1);}};
export const UnknownChecksDiscussionWithoutPostingAgain: Story = {
 args: { scenario: "unknown" },
 play: async ({ canvasElement }) => {
  const canvas = await submit(canvasElement);
  const input = canvas.getByRole("textbox", { name: "Kommentar oder Update" });
  await expect(input).toHaveValue("");
  await userEvent.type(input, "Next draft");
  await userEvent.click(canvas.getByRole("button", { name: "Ansicht wechseln" }));
  await userEvent.click(canvas.getByRole("button", { name: "Ansicht wechseln" }));
  await expect(canvas.getByText("Speicherung unklar")).toBeVisible();
  await userEvent.click(canvas.getByRole("button", { name: "Details zur Speicherung" }));
  await expect(within(document.body).getByRole("tooltip")).toHaveTextContent("Nicht erneut senden.");
  await expect(within(document.body).getByRole("tooltip")).toHaveTextContent("Prüfen gleicht die Übermittlung ab und sendet keinen neuen Kommentar.");
  await userEvent.keyboard("{Escape}");
  await userEvent.click(canvas.getByRole("button", { name: "Speicherung prüfen" }));
  await expect(canvas.getByRole("button", { name: "Speicherung prüfen" })).toBeDisabled();
  controls.get("unknown")!.finishRead();
  await waitFor(() => expect(canvas.getByText("Speicherung weiterhin unklar")).toBeVisible());
  await userEvent.click(canvas.getByRole("button", { name: "Details zur Speicherung" }));
  await expect(within(document.body).getByRole("tooltip")).toHaveTextContent("Die Prüfung konnte die Speicherung nicht bestätigen.");
  await expect(canvas.getByRole("textbox", { name: "Kommentar oder Update" })).toHaveValue("Next draft");
  expect(controls.get("unknown")!.writes()).toBe(1);
  expect(controls.get("unknown")!.reads()).toBe(1);
 },
};
export const RejectedCreateKeepsLocalDraft:Story={args:{scenario:"rejected"},play:async({canvasElement})=>{const canvas=await submit(canvasElement);await expect(canvas.getByText("Nicht gespeichert.")).toBeVisible();await expect(canvas.getByRole("textbox",{name:"Kommentar oder Update"})).toHaveValue("");expect(controls.get("rejected")!.reads()).toBe(0);}};
export const OlderDiscussionCannotEraseCreatedIdentity:Story={args:{scenario:"old-read"},play:async({canvasElement})=>{const canvas=within(canvasElement);await userEvent.click(canvas.getByRole("button",{name:"Diskussion laden"}));await submit(canvasElement);controls.get("old-read")!.finishRead();await expect(canvas.getByText(text)).toBeVisible();await expect(canvas.getByText("1 geladener Kommentar")).toBeVisible();expect(controls.get("old-read")!.writes()).toBe(1);}};
export const TypingDuringPendingKeepsNewUnsentText:Story={args:{scenario:"typing"},play:async({canvasElement})=>{const canvas=await submit(canvasElement);const input=canvas.getByRole("textbox",{name:"Kommentar oder Update"});await userEvent.type(input," New unsent text");controls.get("typing")!.finishCreate();await waitFor(()=>expect(canvas.getByRole("button",{name:"GitHub-Veröffentlichung ausstehend"})).toBeVisible());await expect(input).toHaveValue(" New unsent text");expect(controls.get("typing")!.writes()).toBe(1);}};
export const SessionEndDropsLateConfirmation:Story={args:{scenario:"session"},play:async({canvasElement})=>{const canvas=await submit(canvasElement);controls.get("session")!.endSession();controls.get("session")!.finishCreate();await waitFor(()=>expect(canvas.getByText("Bestätigte Task-Version: Keine Aufgabe")).toBeVisible());await expect(canvas.queryByText(text)).not.toBeInTheDocument();expect(controls.get("session")!.reads()).toBe(0);}};
export const UnsentDraftSurvivesActivityNavigation:Story={args:{scenario:"draft-navigation"},play:async({canvasElement})=>{
 const canvas=within(canvasElement);
 await userEvent.type(canvas.getByRole("textbox",{name:"Kommentar oder Update"}),"Unsent item draft");
 await userEvent.click(canvas.getByRole("button",{name:"Ansicht wechseln"}));
 await userEvent.click(canvas.getByRole("button",{name:"Ansicht wechseln"}));
 await expect(canvas.getByRole("textbox",{name:"Kommentar oder Update"})).toHaveValue("Unsent item draft");
 expect(controls.get("draft-navigation")!.writes()).toBe(0);
}};

async function preserveNewDraftAcrossLateResult(canvasElement: HTMLElement, scenario: string, newerText: string) {
 const canvas=await submit(canvasElement);
 const input=canvas.getByRole("textbox",{name:"Kommentar oder Update"});
 await userEvent.clear(input);
 await userEvent.type(input,newerText);
 await userEvent.click(canvas.getByRole("button",{name:"Ansicht wechseln"}));
 await userEvent.click(canvas.getByRole("button",{name:"Ansicht wechseln"}));
 await expect(canvas.getByRole("textbox",{name:"Kommentar oder Update"})).toHaveValue(newerText);
 controls.get(scenario)!.finishCreate();
 await waitFor(()=>expect(scenario==="rejection-remount" ? canvas.getByText("Nicht gespeichert.") : canvas.getByRole("button",{name:"GitHub-Veröffentlichung ausstehend"})).toBeVisible());
 await expect(canvas.getByRole("textbox",{name:"Kommentar oder Update"})).toHaveValue(newerText);
}
export const LateSuccessKeepsNewDraftAfterNavigation:Story={args:{scenario:"typing-remount"},play:async({canvasElement})=>preserveNewDraftAcrossLateResult(canvasElement,"typing-remount","Newer item draft")};
export const LateSuccessKeepsNewDraftWithIdenticalText:Story={args:{scenario:"same-text-remount"},play:async({canvasElement})=>preserveNewDraftAcrossLateResult(canvasElement,"same-text-remount",text)};
export const LateRejectionKeepsNewDraftAfterNavigation:Story={args:{scenario:"rejection-remount"},play:async({canvasElement})=>preserveNewDraftAcrossLateResult(canvasElement,"rejection-remount","Newer item draft")};

export const LostResponseConfirmsStoredSubmission:Story={args:{scenario:"lost-confirmed"},play:async({canvasElement})=>{const canvas=await submit(canvasElement);await expect(canvas.getByText("Speicherung unklar")).toBeVisible();await userEvent.click(canvas.getByRole("button",{name:"Speicherung prüfen"}));controls.get("lost-confirmed")!.finishRead();await waitFor(()=>expect(canvas.queryByText("Speicherung unklar")).not.toBeInTheDocument());await expect(canvas.getByRole("button",{name:"GitHub-Veröffentlichung ausstehend"})).toBeVisible();expect(canvas.getAllByText(text,{selector:"p"})).toHaveLength(1);expect(controls.get("lost-confirmed")!.writes()).toBe(1);}};

export const ConsecutiveCommentsKeepSubmissionOrder: Story = {args:{scenario:"consecutive"},play:async({canvasElement})=>{
 const canvas=await submit(canvasElement);
 const input=canvas.getByRole("textbox",{name:"Kommentar oder Update"});
 await expect(input).toHaveValue("");
 await expect(input).toHaveFocus();
 await userEvent.type(input,"Second comment");
 await expect(canvas.getByRole("button",{name:"Kommentieren"})).toBeEnabled();
 await userEvent.click(canvas.getByRole("button",{name:"Kommentieren"}));
 await expect(input).toHaveValue("");
 await expect(input).toHaveFocus();
 const order=()=>[...canvasElement.querySelectorAll("article")].map(article=>article.querySelector("p")?.textContent);
 expect(order()).toEqual(["Second comment",text]);
 await userEvent.type(input,"New unsent text");
 controls.get("consecutive")!.finishAt(1);
 await waitFor(()=>expect(canvas.getAllByRole("button",{name:"GitHub-Veröffentlichung ausstehend"})).toHaveLength(1));
 expect(order()).toEqual(["Second comment",text]);
 await userEvent.click(canvas.getByRole("button",{name:"Ansicht wechseln"}));
 controls.get("consecutive")!.finishAt(0);
 await userEvent.click(canvas.getByRole("button",{name:"Ansicht wechseln"}));
 await waitFor(()=>expect(canvas.getAllByRole("button",{name:"GitHub-Veröffentlichung ausstehend"})).toHaveLength(2));
 expect(order()).toEqual(["Second comment",text]);
 await expect(canvas.getByRole("textbox",{name:"Kommentar oder Update"})).toHaveValue("New unsent text");
 expect(controls.get("consecutive")!.writes()).toBe(2);
}};

export const FailedRecoveryCaptureKeepsDraftWithoutSending: Story = {args:{scenario:"capture-failed"},play:async({canvasElement})=>{
 const original=Storage.prototype.setItem;
 Storage.prototype.setItem=()=>{throw new Error("Storage unavailable");};
 try {
  const canvas=await submit(canvasElement);
  await expect(canvas.getByRole("textbox",{name:"Kommentar oder Update"})).toHaveValue(text);
  await expect(canvas.getByRole("alert")).toHaveTextContent("Nicht gesendet.");
  await userEvent.click(canvas.getByRole("button", { name: "Details zum Sendeversuch" }));
  await expect(within(document.body).getByRole("tooltip")).toHaveTextContent("Es wurde nichts gesendet.");
  expect(canvasElement.querySelectorAll("article")).toHaveLength(0);
  expect(controls.get("capture-failed")!.writes()).toBe(0);
 } finally {Storage.prototype.setItem=original;}
}};

export const RetryFailedEntryKeepsOtherCommentsAndNewDraft: Story = {args:{scenario:"retry"},play:async({canvasElement})=>{
 const canvas=await submit(canvasElement);
 const input=canvas.getByRole("textbox",{name:"Kommentar oder Update"});
 const failed=canvas.getByText(text).closest("article")!;
 await expect(within(failed).getByText("Nicht gespeichert.")).toBeVisible();
 await userEvent.type(input,"Independent comment");
 await userEvent.click(canvas.getByRole("button",{name:"Kommentieren"}));
 await userEvent.type(input,"Newer draft");
 await userEvent.click(within(failed).getByRole("button",{name:"Erneut versuchen"}));
 await expect(canvas.queryByRole("button",{name:"Erneut versuchen"})).not.toBeInTheDocument();
 expect([...canvasElement.querySelectorAll("article")].map(row=>row.querySelector("p")?.textContent)).toEqual(["Independent comment",text]);
 controls.get("retry")!.finishAt(1);
 controls.get("retry")!.finishAt(0);
 await waitFor(()=>expect(canvas.getAllByRole("button",{name:"GitHub-Veröffentlichung ausstehend"})).toHaveLength(2));
 expect([...canvasElement.querySelectorAll("article")].map(row=>row.querySelector("p")?.textContent)).toEqual(["Independent comment",text]);
 await expect(input).toHaveValue("Newer draft");
 expect(controls.get("retry")!.writes()).toBe(3);
}};

export const EditableInlineRetry: Story = {args:{scenario:"retry"}};

export const StatusHelpSupportsPointerKeyboardAndTap: Story = {
 args: { scenario: "status-help" },
 play: async ({ canvasElement }) => {
  const canvas = await submit(canvasElement);
  const page = within(document.body);
  const input = canvas.getByRole("textbox", { name: "Kommentar oder Update" });
  const help = canvas.getByRole("button", { name: "GitHub-Veröffentlichung ausstehend" });
  await userEvent.type(input, "Next draft");
  await userEvent.hover(help);
  const tooltip = await page.findByRole("tooltip");
  await expect(help).toHaveAccessibleDescription("Kommentar gespeichert. GitHub-Veröffentlichung ausstehend.");
  await userEvent.unhover(help);
  await userEvent.hover(tooltip);
  await new Promise(resolve => setTimeout(resolve, 200));
  await expect(tooltip).toBeVisible();
  await userEvent.keyboard("{Escape}");
  await expect(page.queryByRole("tooltip")).not.toBeInTheDocument();
  await userEvent.tab();
  await userEvent.tab();
  await expect(help).toHaveFocus();
  await userEvent.hover(page.getByRole("tooltip"));
  await userEvent.tab();
  await new Promise(resolve => setTimeout(resolve, 200));
  await expect(page.getByRole("tooltip")).toBeVisible();
  await userEvent.tab({ shift: true });
  await expect(help).toHaveFocus();
  await userEvent.keyboard("{Escape}");
  await expect(page.queryByRole("tooltip")).not.toBeInTheDocument();
  await userEvent.keyboard("{Enter}");
  await expect(page.getByRole("tooltip")).toBeVisible();
  await userEvent.click(input);
  await expect(page.queryByRole("tooltip")).not.toBeInTheDocument();
  await userEvent.pointer({ target: help, keys: "[TouchA]" });
  await expect(page.getByRole("tooltip")).toBeVisible();
  await userEvent.pointer({ target: input, keys: "[TouchA]" });
  await expect(page.queryByRole("tooltip")).not.toBeInTheDocument();
  await expect(input).toHaveValue("Next draft");
  expect(controls.get("status-help")!.writes()).toBe(1);
  expect(controls.get("status-help")!.reads()).toBe(0);
 },
};

export const RetainedNoticeKeepsActualGitHubDeliveryState: Story = {
 args: { scenario: "notice-with-pending" },
 play: async ({ canvasElement }) => {
  const canvas = await submit(canvasElement);
  await userEvent.click(canvas.getByRole("button", { name: "GitHub-Veröffentlichung ausstehend" }));
  const tooltip = within(document.body).getByRole("tooltip");
  await expect(tooltip).toHaveTextContent("Kommentar gespeichert. GitHub-Veröffentlichung ausstehend.");
  await expect(tooltip).toHaveTextContent("Kommentar gespeichert. Veröffentlichung wartet auf deine GitHub-Verbindung.");
  await expect(canvas.queryByRole("button", { name: "Details zur Speicherung" })).not.toBeInTheDocument();
  expect(controls.get("notice-with-pending")!.writes()).toBe(1);
 },
};
