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
