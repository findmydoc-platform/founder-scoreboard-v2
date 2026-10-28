import { afterEach, expect, test, vi } from "vitest";
import { createBrowserPlanningState } from "@/features/planning/model/internal/browser-planning-state";
import { createBrowserApiClient } from "@/lib/browser-api-client";
import { emptyPlanningShellState } from "@/features/planning/model/planning-shell-state";
import { emptyPlanningHeaderData } from "@/lib/planning-header-data";
import { taskDetailStoryTask } from "@/features/tasks/molecules/task-detail-story-fixtures";
import type { BrowserSessionSnapshot } from "@/lib/credentials/browser";
afterEach(()=>vi.unstubAllGlobals());
for(const kind of ["attachment","tool"] as const)test(`owned ${kind} upload cannot acquire a replacement session while dispatch waits`,async()=>{
 let finish!:(session:BrowserSessionSnapshot)=>void;const initial={userId:"user",revision:"old",expiresAt:4102444800,user:{id:"user"}},replacement={...initial,userId:"other",revision:"new",user:{id:"other"}};const task=taskDetailStoryTask({id:"task",updatedAt:"r1"});const browser=createBrowserPlanningState({initialUserId:"user",initialWorkspace:"planning",initialCurrentProfile:null,initialData:{...emptyPlanningShellState,tasks:[task]},initialHeaderData:emptyPlanningHeaderData});browser.runtime.session=initial;browser.runtime.apiClient=createBrowserApiClient({sessionPort:{current:()=>new Promise(resolve=>{finish=resolve;}),recover:async()=>({kind:"superseded"}),clearIfCurrent:async()=>{}}});const fetch=vi.fn();vi.stubGlobal("fetch",fetch);const uploading=kind==="attachment"?browser.owner.planning.uploadTaskAttachment(task,new File(["proof"],"proof.txt",{type:"text/plain"})):browser.owner.planning.uploadToolPreview("upload",new File(["proof"],"proof.png",{type:"image/png"}));await vi.waitFor(()=>expect(finish).toBeTypeOf("function"));finish(replacement);const result=await uploading;expect(result).toMatchObject(kind==="attachment"?{kind:"ended"}:{phase:"session-ended"});expect(fetch).not.toHaveBeenCalled();expect(browser.owner.planning.protectedCache()).toBeNull();
});
for(const change of ["ended","replacement"] as const)test(`owned Blob preview check rejects ${change} authority before fetch`,async()=>{
 const session={userId:"user",revision:"one",expiresAt:Math.floor(Date.now()/1000)+3600,user:{id:"user"}};let hold=false;let finish!:(value:BrowserSessionSnapshot)=>void;
 const browser=createBrowserPlanningState({initialUserId:"user",initialWorkspace:"tools",initialCurrentProfile:null,initialData:emptyPlanningShellState,initialHeaderData:emptyPlanningHeaderData});browser.runtime.session=session;
 browser.runtime.apiClient=createBrowserApiClient({sessionPort:{current:()=>hold?new Promise(resolve=>{finish=resolve;}):Promise.resolve(session),recover:async()=>({kind:"superseded"}),clearIfCurrent:async()=>{}}});
 const dispatch=vi.fn(async()=>Response.json({imageUrl:"/api/tools/preview-image?path=quicklinks%2F2026-10-28%2Fproof.png",source:"manual"}));vi.stubGlobal("fetch",dispatch);
 expect(await browser.owner.planning.uploadToolPreview("image",new File(["proof"],"proof.png",{type:"image/png"}))).toMatchObject({phase:"uploaded"});expect(dispatch).toHaveBeenCalledTimes(1);
 hold=true;const checking=browser.owner.planning.checkToolPreview("image");await vi.waitFor(()=>expect(finish).toBeTypeOf("function"));
 const next=change==="replacement"?{...session,userId:"other",revision:"two",user:{id:"other"}}:session;
 if(change==="ended")browser.owner.internal.endSession();else browser.runtime.session=next;
 finish(next);expect(await checking).toMatchObject({phase:"session-ended"});expect(dispatch).toHaveBeenCalledTimes(1);expect(browser.owner.planning.tools().previews).toEqual([]);
});
