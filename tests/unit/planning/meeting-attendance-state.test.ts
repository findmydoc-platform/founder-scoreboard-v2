import { expect, test } from "vitest";
import { createPlanningState, type PlanningStateAdapter } from "@/features/planning/model/internal/planning-state-owner";
import { emptyPlanningShellState } from "@/features/planning/model/planning-shell-state";
import { taskDetailStoryTask } from "@/features/tasks/molecules/task-detail-story-fixtures";
import { emptyPlanningHeaderData, readyHeaderSlot } from "@/lib/planning-header-data";
import type { Meeting, MeetingAttendance } from "@/lib/types";
const meeting: Meeting = { id: 7, sprintId: "sprint", title: "Weekly", meetingAt: "2026-10-28T09:00:00Z", status: "planned", agenda: "" };
const attendance: MeetingAttendance = { id: 8, meetingId: 7, profileId: "founder", status: "pending", absenceReason: "", writtenUpdate: "", reasonAccepted: false, points: 0, createdAt: "created", updatedAt: "shown-r1" };
function fixture(adapter: Partial<PlanningStateAdapter> = {}) { return createPlanningState({ userId: "user", initialData: { ...emptyPlanningShellState, tasks: [taskDetailStoryTask({id:"independent",updatedAt:"task-r1"})], meetings: [meeting], meetingAttendance: [attendance] }, adapter: { readWorkspace: async () => null, saveTask: async () => ({ task: {} }), ...adapter } }); }
test("attendance saves the shown row basis and publishes only the actual returned attendance", async () => {
 const { planning } = fixture({ saveMeetingAttendance: async (meeting: Meeting, basis: MeetingAttendance | null, input: Partial<MeetingAttendance>) => { expect(meeting.id).toBe(7); expect(basis?.updatedAt).toBe("shown-r1"); expect(input.writtenUpdate).toBe("Evidence"); return { attendance: { ...attendance, writtenUpdate: "Evidence", updatedAt: "accepted-r2" }, effects: "confirmed" }; } });
 const editor = planning.beginMeetingAttendance(meeting, attendance.profileId, attendance);
 expect(await editor.save({ writtenUpdate: "Evidence" })).toMatchObject({ ok: true });
 expect(planning.meetingAttendance(meeting.id, attendance.profileId).record).toMatchObject({ writtenUpdate: "Evidence", updatedAt: "accepted-r2" });
});

function deferred<T>() { let resolve!: (value: T) => void, reject!: (error: unknown) => void; const promise = new Promise<T>((yes,no) => { resolve=yes;reject=no; }); return {promise,resolve,reject}; }
test("unknown attendance retains the actual submission across navigation and a second save cannot unlock it", async () => {
 let writes=0,reads=0;
 const {planning}=fixture({saveMeetingAttendance:async()=>{writes++;throw new Error("Lost");},readMeetingAttendance:async()=>{reads++;return{attendance:{...attendance,writtenUpdate:"Submitted"}};}});
 const editor=planning.beginMeetingAttendance(meeting,attendance.profileId,attendance);
 expect(await editor.save({writtenUpdate:"Submitted"})).toMatchObject({kind:"unconfirmed"});
 await planning.refreshWorkspace("planning");editor.close();
 const resumed=planning.resumeMeetingAttendance(editor.view().id)!;
 expect(resumed.view()).toMatchObject({phase:"unconfirmed",submitted:{writtenUpdate:"Submitted"}});
 expect(await resumed.save({writtenUpdate:"Do not send"})).toMatchObject({kind:"blocked"});
 expect(resumed.view()).toMatchObject({phase:"unconfirmed",submitted:{writtenUpdate:"Submitted"}});
 await resumed.checkOutcome();expect(resumed.view().phase).toBe("unconfirmed");expect({writes,reads}).toEqual({writes:1,reads:1});
});

test("an outcome check cannot use a pair read started before the lost write result", async () => {
 const response=deferred<never>(),old=deferred<{attendance:MeetingAttendance|null}>();let reads=0;
 const {planning}=fixture({saveMeetingAttendance:()=>response.promise,readMeetingAttendance:async()=>{reads++;return reads===1?old.promise:{attendance:{...attendance,writtenUpdate:"Server after outcome"}};}});
 const editor=planning.beginMeetingAttendance(meeting,attendance.profileId,attendance);
 const saving=editor.save({writtenUpdate:"Submitted"});const before=editor.checkOutcome();
 response.reject(new Error("Lost"));await saving;const checking=editor.checkOutcome();old.resolve({attendance});
 await Promise.all([before,checking]);expect(reads).toBe(2);expect(editor.view()).toMatchObject({phase:"unconfirmed",serverRecord:{writtenUpdate:"Server after outcome"}});
});

test("a rejected attendance edit rolls back only its row while independent accepted work remains", async () => {
 const response=deferred<never>();
 const {planning}=fixture({saveTask:async()=>({task:{title:"Accepted Task",updatedAt:"task-r2"}}),saveMeetingAttendance:async(_,basis,input)=>input.profileId==="founder"?response.promise:{attendance:{...input,id:9,updatedAt:"other-r2"},effects:"confirmed"}});
 const first=planning.beginMeetingAttendance(meeting,attendance.profileId,attendance),second=planning.beginMeetingAttendance(meeting,attendance.profileId,attendance);
 const saving=first.save({writtenUpdate:"Rejected only here"});expect(await second.save({writtenUpdate:"Overlap"})).toMatchObject({kind:"blocked"});
 const other=planning.beginMeetingAttendance(meeting,"other",{...attendance,id:9,profileId:"other",updatedAt:"other-r1"});expect(await other.save({writtenUpdate:"Independent attendance"})).toMatchObject({ok:true});
 expect(await planning.saveTask(planning.taskDetail("independent").task!,{title:"Accepted Task"})).toMatchObject({ok:true});
 response.reject(Object.assign(new Error("Forbidden"),{status:403}));await saving;
 expect(planning.meetingAttendance(meeting.id,"founder").record?.writtenUpdate).toBe("");expect(planning.meetingAttendance(meeting.id,"other").record?.writtenUpdate).toBe("Independent attendance");expect(planning.taskDetail("independent").task?.title).toBe("Accepted Task");
});
test("a background Sprint read cannot advance the attendance basis captured when editing opened", async () => {
 let sent="";
 const {planning}=fixture({readWorkspace:async()=>({data:{...emptyPlanningShellState,meetingAttendance:[{...attendance,updatedAt:"foreign-r2",writtenUpdate:"Foreign"}]},coverage:{meetingAttendance:"complete"}}),saveMeetingAttendance:async(_,basis)=>{sent=basis!.updatedAt;throw Object.assign(new Error("Conflict"),{status:409,code:"attendance_revision_conflict"});},readMeetingAttendance:async()=>({attendance:{...attendance,updatedAt:"foreign-r2",writtenUpdate:"Foreign"}})});
 const editor=planning.beginMeetingAttendance(meeting,attendance.profileId,attendance);await planning.refreshWorkspace("sprint");expect(await editor.save({writtenUpdate:"My input"})).toMatchObject({kind:"conflict"});expect(sent).toBe("shown-r1");
 expect(editor.view().submitted).toEqual({writtenUpdate:"My input"});expect(await editor.resave({writtenUpdate:"My input"})).toMatchObject({kind:"blocked"});await editor.refreshConflict();expect(editor.view()).toMatchObject({compared:true,serverRecord:{writtenUpdate:"Foreign"}});
});
test("a missing attendance in a partial list needs exact pair absence before INSERT", async () => {
 let reads=0,writes=0;
 const {planning}=fixture({readMeetingAttendance:async()=>{reads++;return{attendance:null};},saveMeetingAttendance:async(_,basis,input)=>{expect(basis).toBeNull();writes++;return{attendance:{...input,id:99,updatedAt:"inserted-r1"},effects:"confirmed"};}});
 const editor=planning.beginMeetingAttendance(meeting,"missing",null);expect(await editor.save({writtenUpdate:"Draft"})).toMatchObject({kind:"blocked"});expect(writes).toBe(0);await editor.prepare();expect(await editor.save({writtenUpdate:"Draft"})).toMatchObject({ok:true});expect({reads,writes}).toEqual({reads:1,writes:1});
});
test("old complete Sprint membership cannot erase a newly accepted attendance receipt", async () => {
 const old=deferred<{data:typeof emptyPlanningShellState;coverage:{meetingAttendance:"complete"}}>();
 const {planning}=fixture({readWorkspace:()=>old.promise,saveMeetingAttendance:async(_,basis,input)=>({attendance:{...input,updatedAt:"accepted-r2"},effects:"unconfirmed",warning:"Actual attendance saved; audit unknown"})});
 const reading=planning.refreshWorkspace("sprint");const editor=planning.beginMeetingAttendance(meeting,attendance.profileId,attendance);await editor.save({writtenUpdate:"Accepted"});old.resolve({data:emptyPlanningShellState,coverage:{meetingAttendance:"complete"}});await reading;
 expect(planning.meetingAttendance(meeting.id,attendance.profileId).record).toMatchObject({writtenUpdate:"Accepted",updatedAt:"accepted-r2"});expect(editor.view()).toMatchObject({phase:"confirmed",warning:"Actual attendance saved; audit unknown"});
});
test.each([null,"replacement"])("session %s clears retained attendance submission and ignores its late receipt", async account => {
 const response=deferred<import("@/features/sprint/model/meeting-attendance-state").MeetingAttendanceReceipt>();const owner=fixture({saveMeetingAttendance:()=>response.promise});const editor=owner.planning.beginMeetingAttendance(meeting,attendance.profileId,attendance);const saving=editor.save({writtenUpdate:"Private submitted text"});owner.internal.sessionChanged(account);response.resolve({attendance:{...attendance,writtenUpdate:"Private submitted text",updatedAt:"late"},effects:"confirmed"});expect(await saving).toMatchObject({kind:"ended"});expect(editor.view().submitted).toBeNull();expect(owner.planning.meetingAttendanceEdits(meeting.id,attendance.profileId)).toEqual([]);
});

test("denied pair checks hide that submission and do not end an independent pair editor", async () => {
 const {planning}=fixture({saveMeetingAttendance:async(_,basis,input)=>input.profileId==="founder"?Promise.reject(new Error("Lost")):{attendance:{...input,id:9,updatedAt:"other-r2"},effects:"confirmed"},readMeetingAttendance:async()=>{throw Object.assign(new Error("Denied"),{status:403});}});
 const editor=planning.beginMeetingAttendance(meeting,attendance.profileId,attendance);await editor.save({writtenUpdate:"Private"});await editor.checkOutcome();expect(editor.view().submitted).toBeNull();expect(planning.meetingAttendanceEdits(meeting.id,attendance.profileId)).toEqual([]);expect(planning.meetingAttendance(meeting.id,attendance.profileId)).toMatchObject({record:null,readStatus:"forbidden"});
 const independent=planning.beginMeetingAttendance(meeting,"other",{...attendance,id:9,profileId:"other"});expect(await independent.save({writtenUpdate:"Independent"})).toMatchObject({ok:true});
});
test("attendance expiry clears the submitted draft before a late receipt", async () => {
 let now=0;const response=deferred<import("@/features/sprint/model/meeting-attendance-state").MeetingAttendanceReceipt>();
 const {planning}=createPlanningState({userId:"user",initialSession:{userId:"user",revision:"session",expiresAt:1,user:{id:"user"}},initialData:{...emptyPlanningShellState,meetings:[meeting],meetingAttendance:[attendance]},adapter:{now:()=>now,readWorkspace:async()=>null,saveTask:async()=>({task:{}}),saveMeetingAttendance:()=>response.promise}});
 const editor=planning.beginMeetingAttendance(meeting,attendance.profileId,attendance),saving=editor.save({writtenUpdate:"Private"});now=1000;response.resolve({attendance:{...attendance,updatedAt:"late"},effects:"confirmed"});expect(await saving).toMatchObject({kind:"ended"});expect(editor.view().submitted).toBeNull();expect(planning.protectedCache()).toBeNull();
});
test("complete attendance coverage becomes partial only while an attendance outcome is unresolved", async () => {
 const response=deferred<import("@/features/sprint/model/meeting-attendance-state").MeetingAttendanceReceipt>();const {planning}=fixture({readWorkspace:async()=>({data:{...emptyPlanningShellState,meetingAttendance:[attendance]},coverage:{meetingAttendance:"complete"}}),saveMeetingAttendance:()=>response.promise});await planning.refreshWorkspace("sprint");expect(planning.sprintWorkspace().model.coverage.attendance).toBe("complete");
 const editor=planning.beginMeetingAttendance(meeting,attendance.profileId,attendance),saving=editor.save({points:2});expect(planning.sprintWorkspace().model.coverage.attendance).toBe("partial");response.resolve({attendance:{...attendance,points:2,updatedAt:"accepted-r2"},effects:"confirmed"});await saving;expect(planning.sprintWorkspace().model.coverage.attendance).toBe("complete");
});

test("an older exact pair response cannot resurrect membership absent from a newer complete read", async () => {
 const old=deferred<{attendance:MeetingAttendance|null}>();const {planning}=fixture({readMeetingAttendance:()=>old.promise,readWorkspace:async()=>({data:emptyPlanningShellState,coverage:{meetingAttendance:"complete"}})});
 const editor=planning.beginMeetingAttendance(meeting,"missing",null),preparing=editor.prepare();await planning.refreshWorkspace("sprint");old.resolve({attendance:{...attendance,id:99,profileId:"missing"}});await preparing;expect(planning.meetingAttendance(meeting.id,"missing").record).toBeNull();
});

test("an older attendance rejection preserves a confirmed Sprint edit and actual server score", async () => {
 const sprint={id:"independent-sprint",name:"Sprint",status:"active" as const,startDate:"2026-10-01",endDate:"2026-10-14",reviewDueAt:"2026-10-17T00:00:00Z",scoreLocked:false,updatedAt:"sprint-r1"};
 const score={id:1,sprintId:sprint.id,profileId:"other",deliveryPoints:3,formPoints:1,weeklyPoints:2,totalPoints:6,fulfilled:true,awayNeutral:false,finalizedAt:"actual",finalizedBy:"ceo",reasonSummary:"Actual server score"};
 const response=deferred<never>();const {planning}=createPlanningState({userId:"user",initialData:{...emptyPlanningShellState,sprints:[sprint],meetings:[meeting],meetingAttendance:[attendance]},adapter:{saveTask:async()=>({task:{}}),saveMeetingAttendance:()=>response.promise,saveSprint:async(basis,patch)=>({sprint:{...basis,...patch,updatedAt:"sprint-r2"}}),readWorkspace:async()=>({data:{...emptyPlanningShellState,founderSprintScores:[score]},coverage:{founderSprintScores:"complete"}})}});
 const editor=planning.beginMeetingAttendance(meeting,attendance.profileId,attendance),saving=editor.save({writtenUpdate:"Reject me"});expect(await planning.beginSprintEdit(sprint).save({name:"Confirmed Sprint"})).toMatchObject({ok:true});await planning.refreshWorkspace("sprint");response.reject(Object.assign(new Error("Rejected"),{status:400}));await saving;
 expect(planning.sprintWorkspace().model.sprints[0]).toMatchObject({name:"Confirmed Sprint",updatedAt:"sprint-r2"});expect(planning.sprintWorkspace().model.scores).toEqual([score]);
});

test.each(["confirmed","unknown","rejected"] as const)("%s attendance only rereads an already loaded notification Header slot", async mode => {
 let reads=0;const header={...emptyPlanningHeaderData,notifications:readyHeaderSlot({unreadCount:0,items:[]})};
 const {planning}=createPlanningState({userId:"user",initialData:{...emptyPlanningShellState,meetings:[meeting],meetingAttendance:[attendance]},initialHeaderData:header,adapter:{readWorkspace:async()=>null,saveTask:async()=>({task:{}}),readHeader:async slots=>{expect(slots).toEqual(["notifications"]);reads++;return header;},saveMeetingAttendance:async(_,basis,input)=>{if(mode!=="confirmed")throw Object.assign(new Error("Failure"),mode==="rejected"?{status:403}:{});return{attendance:{...input,updatedAt:"accepted-r2"},effects:"confirmed"};}}});
 await planning.beginMeetingAttendance(meeting,attendance.profileId,attendance).save({writtenUpdate:"Submitted"});expect(reads).toBe(mode==="rejected"?0:1);expect(planning.header().slots.quickLinks.readStatus).toBe("not-loaded");
});
