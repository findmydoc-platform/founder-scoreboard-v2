import {expect,test} from "vitest";
import {createPlanningState} from "@/features/planning/model/internal/planning-state-owner";
import {emptyPlanningShellState} from "@/features/planning/model/planning-shell-state";
import {emptyPlanningHeaderData,readyHeaderSlot} from "@/lib/planning-header-data";
import type {Task} from "@/lib/types";
test.each([["unknown",true,1],["rejected",true,0],["unknown",false,0]] as const)("ordinary Task %s with loaded Header %s performs %i dependent reads and no replay",async(mode,loaded,expected)=>{
 let reads=0,writes=0;const task={id:"task",title:"Before",updatedAt:"r1"} as Task;const header={...emptyPlanningHeaderData,notifications:readyHeaderSlot({unreadCount:0,items:[]})};
 const {planning}=createPlanningState({userId:"account",initialData:{...emptyPlanningShellState,tasks:[task]},initialHeaderData:loaded?header:emptyPlanningHeaderData,adapter:{readWorkspace:async()=>null,saveTask:async()=>{writes++;throw mode==="unknown"?new Error("Lost response"):Object.assign(new Error("Rejected"),{status:422});},readHeader:async slots=>{expect(slots).toEqual(["notifications"]);reads++;return header;}}});
 await planning.saveTask(task,{title:"After"});expect(reads).toBe(expected);expect(writes).toBe(1);expect(planning.header().slots.calendarEvents.readStatus).toBe("not-loaded");
});
