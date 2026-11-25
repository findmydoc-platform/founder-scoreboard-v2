import { expect, test, vi } from "vitest";
import { createPlanningState } from "@/features/planning/model/internal/planning-state-owner";
import { emptyPlanningShellState } from "@/features/planning/model/planning-shell-state";
import { emptyPlanningHeaderData, readyHeaderSlot } from "@/lib/planning-header-data";

const actor = { id: "notification-reader", name: "Reader", platformRole: "founder" as const, orgRole: "Founder", githubLogin: "", weeklyCapacity: 40 };
const item = { id: 1, type: "task.assigned", actorProfileId: "", actorLabel: "System", recipientProfileId: actor.id, entityType: "task", entityId: "not-loaded", title: "Preview stays", body: "", targetPath: "", createdAt: "2026-11-02T09:00:00Z" };
const receipt = () => ({ unreadCount: 42, readAuthority: { userId: "user", deadline: 2_000 }, readActor: { profileId: actor.id, platformRole: actor.platformRole }, sourceRevision: "notifications-one", observedAt: new Date(1_000).toISOString(), validUntil: new Date(3_000).toISOString() });
type Port = { notificationCount(): { readStatus: string; value: number | null }; refreshNotificationCount(): Promise<boolean> };
function deferred<T>() { let resolve!: (x:T) => void; let reject!: (e:Error) => void; const promise = new Promise<T>((yes,no)=>{ resolve=yes; reject=no; }); return {promise,resolve,reject}; }
function setup(readNotificationCount: () => Promise<ReturnType<typeof receipt>>, now = () => 1_000) {
  const owner = createPlanningState({ userId: "user", initialData: emptyPlanningShellState, initialCurrentProfile: actor, adapter: {
    now, saveTask: async () => ({task:{}}), readWorkspace: async () => null,
    readHeader: async () => ({...emptyPlanningHeaderData, notifications:readyHeaderSlot({unreadCount:0,items:[item]})}), readNotificationCount,
  }});
  return {...owner, port: owner.planning as typeof owner.planning & Port};
}

test("a failed count remains unknown without blocking separately loaded preview", async () => {
  const pending=deferred<ReturnType<typeof receipt>>(), {port, internal}=setup(()=>pending.promise);
  try {
    const reading=port.refreshNotificationCount();
    await port.refreshHeader(["notifications"]);
    expect(port.header().data.notifications.data.items).toEqual([item]);
    expect(port.notificationCount()).toMatchObject({readStatus:"loading",value:null});
    pending.reject(new Error("Count unavailable")); expect(await reading).toBe(false);
    expect(port.notificationCount()).toMatchObject({readStatus:"unavailable",value:null});
    expect(port.header().data.notifications.data.items).toEqual([item]);
  } finally { internal.dispose(); }
});

test("exact count retains its original authority deadline and cannot accept a different actor", async () => {
  let now=1_000, value=receipt();const {port,internal}=setup(async()=>value,()=>now);
  try {
    expect(await port.refreshNotificationCount()).toBe(true);expect(port.notificationCount()).toMatchObject({readStatus:"current",value:42});
    now=2_001;expect(port.notificationCount()).toMatchObject({readStatus:"stale",value:null});
    value={...receipt(),readActor:{...receipt().readActor,profileId:"different"},readAuthority:{userId:"user",deadline:4_000}};
    expect(await port.refreshNotificationCount()).toBe(false);expect(port.notificationCount().value).toBeNull();
  } finally { internal.dispose(); }
});

test("a late count response after session end cannot publish a value", async () => {
  const pending=deferred<ReturnType<typeof receipt>>(), {port,internal}=setup(()=>pending.promise);
  const reading=port.refreshNotificationCount();internal.endSession();pending.resolve(receipt());
  expect(await reading).toBe(false);expect(port.notificationCount().value).toBeNull();
});

test("an old-session denial cannot erase a newer accepted count", async () => {
  const old=deferred<ReturnType<typeof receipt>>();let calls=0;
  const {port,internal}=setup(()=>++calls===1?old.promise:Promise.resolve(receipt()));
  try {
    const stale=port.refreshNotificationCount();internal.invalidateNotificationAuthority();
    expect(await port.refreshNotificationCount()).toBe(true);
    old.reject(Object.assign(new Error("Old denial"),{status:403}));expect(await stale).toBe(false);
    expect(port.notificationCount()).toMatchObject({readStatus:"current",value:42});
  } finally {internal.dispose();}
});

test("preview becomes useful while the separately requested count is still pending", async () => {
  const count = deferred<ReturnType<typeof receipt>>();
  const preview = deferred<ReturnType<typeof receipt> & {items: typeof item[]}>();
  const {planning,internal}=createPlanningState({userId:"user",initialData:emptyPlanningShellState,initialCurrentProfile:actor,adapter:{
    now:()=>1_000,saveTask:async()=>({task:{}}),readWorkspace:async()=>null,
    readNotificationCount:()=>count.promise,readNotificationPreview:()=>preview.promise,
  }});
  const port=planning as typeof planning & Port;
  try {
    const countRead=port.refreshNotificationCount(), previewRead=port.refreshHeader(["notifications"]);
    preview.resolve({...receipt(),items:[item]});expect(await previewRead).toBe(true);
    expect(port.header().data.notifications.data.items).toEqual([item]);
    expect(port.notificationCount()).toMatchObject({readStatus:"loading",value:null});
    count.resolve(receipt());expect(await countRead).toBe(true);expect(port.notificationCount().value).toBe(42);
  } finally {internal.dispose();}
});

test("a failed preview refresh retains still-authorized preview content", async () => {
  let calls=0;
  const {planning,internal}=createPlanningState({userId:"user",initialData:emptyPlanningShellState,initialCurrentProfile:actor,adapter:{
    now:()=>1_000,saveTask:async()=>({task:{}}),readWorkspace:async()=>null,
    readNotificationPreview:async()=>{ if (++calls===1) return {...receipt(),items:[item]}; throw Object.assign(new Error("Unavailable"),{status:503}); },
  }});
  try {
    expect(await planning.refreshHeader(["notifications"])).toBe(true);
    expect(await planning.refreshHeader(["notifications"])).toBe(false);
    expect(planning.header().data.notifications).toMatchObject({state:"ready",freshness:"stale",data:{items:[item]}});
  } finally {internal.dispose();}
});

test("the original deadlines expire preview and count without another interaction", async () => {
  vi.useFakeTimers(); vi.setSystemTime(1_000);
  const {planning,internal}=createPlanningState({userId:"user",initialData:emptyPlanningShellState,initialCurrentProfile:actor,adapter:{
    now:()=>Date.now(),saveTask:async()=>({task:{}}),readWorkspace:async()=>null,
    readNotificationCount:async()=>receipt(),readNotificationPreview:async()=>({...receipt(),items:[item]}),
  }});
  const port=planning as typeof planning & Port; const changed=vi.fn(); const unsubscribe=planning.subscribe(changed);
  try {
    await Promise.all([port.refreshNotificationCount(),port.refreshHeader(["notifications"])]);changed.mockClear();
    await vi.advanceTimersByTimeAsync(1_001);
    expect(changed).toHaveBeenCalled();expect(port.notificationCount()).toMatchObject({readStatus:"stale",value:null});
    expect(port.header().data.notifications).toMatchObject({state:"loading",data:{items:[]}});
  } finally {unsubscribe();internal.dispose();vi.useRealTimers();}
});

const inboxEvent = (id:number) => ({...item,id,status:"pending" as const,seenAt:"",dismissedAt:"",resolvedAt:"",resolutionReason:""});
const inboxPage = (id:number, continuation:string|null) => ({...receipt(),events:[inboxEvent(id)],coverage:continuation?"partial" as const:"complete" as const,continuation,references:[],referenceCoverage:"partial" as const});
type InboxPort = { loadNotificationPage(continuation?: string): Promise<boolean>; notifications(): ReturnType<ReturnType<typeof createPlanningState>["planning"]["notifications"]> & {continuation:string|null} };
test("inbox pages append without requiring Planning collection membership", async () => {
  const next=deferred<ReturnType<typeof inboxPage>>(), calls:Array<string|undefined>=[];
  const {planning,internal}=createPlanningState({userId:"user",initialData:emptyPlanningShellState,initialCurrentProfile:actor,adapter:{
    now:()=>1_000,saveTask:async()=>({task:{}}),readWorkspace:async()=>null,
    readNotificationInbox:async (cursor?:string)=>{calls.push(cursor);return cursor?next.promise:inboxPage(1,"cursor");},
  }}); const port=planning as typeof planning & InboxPort;
  try {
    expect(await port.loadNotificationPage()).toBe(true);expect(port.notifications().continuation).toBe("cursor");
    const loading=port.loadNotificationPage("cursor");expect(port.notifications().events.map(x=>x.id)).toEqual([1]);
    next.resolve(inboxPage(2,null));expect(await loading).toBe(true);
    expect(port.notifications().events.map(x=>x.id)).toEqual([1,2]);expect(port.notifications().continuation).toBeNull();expect(calls).toEqual([undefined,"cursor"]);
  } finally {internal.dispose();}
});

test("a late inbox page cannot replace a newer inbox query", async () => {
  const next=deferred<ReturnType<typeof inboxPage>>();let first=0;
  const {planning,internal}=createPlanningState({userId:"user",initialData:emptyPlanningShellState,initialCurrentProfile:actor,adapter:{
    now:()=>1_000,saveTask:async()=>({task:{}}),readWorkspace:async()=>null,
    readNotificationInbox:async (cursor?:string)=>{ if (cursor) return next.promise; first++; return first === 1 ? inboxPage(1, "cursor") : { ...inboxPage(3, null), sourceRevision: "notifications-two" }; },
  }});const port=planning as typeof planning & InboxPort;
  try {
    await port.loadNotificationPage();const old=port.loadNotificationPage("cursor");expect(await port.loadNotificationPage()).toBe(true);
    next.resolve(inboxPage(2,null));expect(await old).toBe(false);expect(port.notifications().events.map(x=>x.id)).toEqual([3]);
  } finally {internal.dispose();}
});

test("a stale cursor retains visible events and requests a fresh first page", async () => {
  const {planning,internal}=createPlanningState({userId:"user",initialData:emptyPlanningShellState,initialCurrentProfile:actor,adapter:{
    now:()=>1_000,saveTask:async()=>({task:{}}),readWorkspace:async()=>null,
    readNotificationInbox:async (cursor?:string)=>{if(cursor) throw Object.assign(new Error("stale"),{status:409});return inboxPage(1,"cursor");},
  }});const port=planning as typeof planning & InboxPort;
  try {
    await port.loadNotificationPage();expect(await port.loadNotificationPage("cursor")).toBe(false);
    expect(port.notifications()).toMatchObject({readStatus:"stale",continuation:null,events:[inboxEvent(1)]});
  } finally {internal.dispose();}
});

test("a page from a different source cannot be appended", async () => {
  const {planning,internal}=createPlanningState({userId:"user",initialData:emptyPlanningShellState,initialCurrentProfile:actor,adapter:{
    now:()=>1_000,saveTask:async()=>({task:{}}),readWorkspace:async()=>null,
    readNotificationInbox:async (cursor?:string)=>cursor?{...inboxPage(2,null),sourceRevision:"different-source"}:inboxPage(1,"cursor"),
  }});const port=planning as typeof planning & InboxPort;
  try {
    await port.loadNotificationPage();expect(await port.loadNotificationPage("cursor")).toBe(false);
    expect(port.notifications()).toMatchObject({readStatus:"stale",continuation:null,events:[inboxEvent(1)]});
  } finally {internal.dispose();}
});

test("a same-source refresh preserves already loaded inbox pages", async () => {
  const {planning,internal}=createPlanningState({userId:"user",initialData:emptyPlanningShellState,initialCurrentProfile:actor,adapter:{
    now:()=>1_000,saveTask:async()=>({task:{}}),readWorkspace:async()=>null,
    readNotificationInbox:async (cursor?:string)=>cursor?inboxPage(2,null):inboxPage(1,"cursor"),
  }});const port=planning as typeof planning & InboxPort;
  try {
    await port.loadNotificationPage();await port.loadNotificationPage("cursor");
    expect(await port.loadNotificationPage()).toBe(true);
    expect(port.notifications().events.map(x=>x.id)).toEqual([1,2]);expect(port.notifications().continuation).toBeNull();
  } finally {internal.dispose();}
});

test("a changed inbox waits until an active interaction finishes", async () => {
  let calls=0;
  const {planning,internal}=createPlanningState({userId:"user",initialData:emptyPlanningShellState,initialCurrentProfile:actor,adapter:{
    now:()=>1_000,saveTask:async()=>({task:{}}),readWorkspace:async()=>null,
    readNotificationInbox:async()=>{calls++;return calls===1?inboxPage(1,null):{...inboxPage(2,null),sourceRevision:"notifications-two"};},
  }});const port=planning as typeof planning & InboxPort & {setNotificationInteraction(active:boolean):void};
  try {
    await port.loadNotificationPage();port.setNotificationInteraction(true);await port.loadNotificationPage();
    expect(port.notifications()).toMatchObject({readStatus:"stale",events:[inboxEvent(1)]});
    port.setNotificationInteraction(false);expect(port.notifications()).toMatchObject({readStatus:"current",events:[inboxEvent(2)]});
  } finally {internal.dispose();}
});

test("retrying an unavailable count does not reload or clear the preview", async () => {
  let countReads=0, previewReads=0;
  const {planning,internal}=createPlanningState({userId:"user",initialData:emptyPlanningShellState,initialCurrentProfile:actor,adapter:{
    now:()=>1_000,saveTask:async()=>({task:{}}),readWorkspace:async()=>null,
    readNotificationPreview:async()=>{previewReads++;return {...receipt(),items:[item]};},
    readNotificationCount:async()=>{if(++countReads===1)throw Object.assign(new Error("Unavailable"),{status:503});return receipt();},
  }});const port=planning as typeof planning & Port;
  try {
    await port.refreshHeader(["notifications"]);expect(await port.refreshNotificationCount()).toBe(false);
    expect(await port.refreshNotificationCount()).toBe(true);expect(port.notificationCount().value).toBe(42);
    expect(port.header().data.notifications.data.items).toEqual([item]);expect(previewReads).toBe(1);expect(countReads).toBe(2);
  } finally {internal.dispose();}
});

test("a deferred inbox cannot return after the session ends", async () => {
  let calls=0;
  const {planning,internal}=createPlanningState({userId:"user",initialData:emptyPlanningShellState,initialCurrentProfile:actor,adapter:{
    now:()=>1_000,saveTask:async()=>({task:{}}),readWorkspace:async()=>null,
    readNotificationInbox:async()=>{calls++;return calls===1?inboxPage(1,null):{...inboxPage(2,null),sourceRevision:"notifications-two"};},
  }});const port=planning as typeof planning & InboxPort & {setNotificationInteraction(active:boolean):void};
  await port.loadNotificationPage();port.setNotificationInteraction(true);await port.loadNotificationPage();internal.endSession();
  port.setNotificationInteraction(false);expect(port.notifications().events).toEqual([]);
});

test("a receipt cannot outlive its original bound session", async () => {
  const {planning,internal}=createPlanningState({userId:"user",initialData:emptyPlanningShellState,initialCurrentProfile:actor,initialSession:{userId:"user",user:{id:"user"},revision:"session-one",expiresAt:2},adapter:{
    now:()=>1_000,saveTask:async()=>({task:{}}),readWorkspace:async()=>null,
    readNotificationCount:async()=>({...receipt(),readAuthority:{userId:"user",deadline:2_500}}),
  }});const port=planning as typeof planning & Port;
  try {expect(await port.refreshNotificationCount()).toBe(false);expect(port.notificationCount().value).toBeNull();} finally {internal.dispose();}
});

test("same-source refresh cannot certify conflicting first-page rows", async () => {
  let reads=0;
  const {planning,internal}=createPlanningState({userId:"user",initialData:emptyPlanningShellState,initialCurrentProfile:actor,adapter:{
    now:()=>1_000,saveTask:async()=>({task:{}}),readWorkspace:async()=>null,
    readNotificationInbox:async()=>++reads===1?inboxPage(1,null):{...inboxPage(1,null),events:[]},
  }});const port=planning as typeof planning & InboxPort;
  try {await port.loadNotificationPage();expect(await port.loadNotificationPage()).toBe(false);expect(port.notifications().readStatus).toBe("unavailable");} finally {internal.dispose();}
});

test("a complete later reference page cannot conceal missing earlier references", async () => {
  const {planning,internal}=createPlanningState({userId:"user",initialData:emptyPlanningShellState,initialCurrentProfile:actor,adapter:{
    now:()=>1_000,saveTask:async()=>({task:{}}),readWorkspace:async()=>null,
    readNotificationInbox:async (cursor?:string)=>cursor?{...inboxPage(2,null),referenceCoverage:"complete" as const}:inboxPage(1,"cursor"),
  }});const port=planning as typeof planning & InboxPort;
  try {await port.loadNotificationPage();await port.loadNotificationPage("cursor");expect(port.notifications().referenceCoverage).toBe("partial");} finally {internal.dispose();}
});

test("an unrelated workspace with an idle notification slot cannot erase the independent preview", async () => {
  const {planning,internal}=createPlanningState({userId:"user",initialData:emptyPlanningShellState,initialCurrentProfile:actor,adapter:{
    now:()=>1_000,saveTask:async()=>({task:{}}),readWorkspace:async()=>({data:emptyPlanningShellState,headerData:emptyPlanningHeaderData}),
    readNotificationPreview:async()=>({...receipt(),items:[item]}),
  }});
  try {expect(await planning.refreshHeader(["notifications"])).toBe(true);await planning.refreshWorkspace("events");expect(planning.header().data.notifications.data.items).toEqual([item]);} finally {internal.dispose();}
});


test("authority changes refresh count without requesting a closed preview", async () => {
  let previewReads=0, countReads=0, inboxReads=0;
  const {planning,internal}=createPlanningState({userId:"user",initialData:emptyPlanningShellState,initialCurrentProfile:actor,adapter:{
    now:()=>1_000,saveTask:async()=>({task:{}}),readWorkspace:async()=>null,
    readNotificationPreview:async()=>{previewReads++;return {...receipt(),items:[item]};},
    readNotificationCount:async()=>{countReads++;return receipt();},
    readNotificationInbox:async()=>{inboxReads++;return inboxPage(1,null);},
  }});
  try {
    await planning.refreshNotificationCount();internal.invalidateNotificationAuthority();
    await vi.waitFor(()=>expect(countReads).toBe(2));
    expect(previewReads).toBe(0);expect(inboxReads).toBe(0);
    planning.setNotificationPreviewActive(true);internal.invalidateNotificationAuthority();
    await vi.waitFor(()=>expect(previewReads).toBe(1));
    expect(planning.header().data.notifications.data.items).toEqual([item]);
  } finally {internal.dispose();}
});

test("a closed preview is invalidated but not reloaded after a notification action", async () => {
  let previewReads=0, countReads=0;
  const {planning,internal}=createPlanningState({userId:"user",initialData:emptyPlanningShellState,initialCurrentProfile:actor,adapter:{
    now:()=>1_000,saveTask:async()=>({task:{}}),readWorkspace:async()=>null,
    readNotificationPreview:async()=>{previewReads++;return {...receipt(),items:[item]};},
    readNotificationCount:async()=>{countReads++;return receipt();},
    updateNotification:async()=>({action:"seen" as const,status:"pending" as const}),
  }});
  try {
    await planning.refreshHeader(["notifications"]);await planning.refreshNotificationCount();
    expect((await planning.updateNotificationStatus(1,"seen")).ok).toBe(true);
    await vi.waitFor(()=>expect(countReads).toBe(2));
    expect(previewReads).toBe(1);expect(planning.header().slots.notifications.readStatus).toBe("stale");
    planning.setNotificationPreviewActive(true);await planning.refreshHeader(["notifications"]);
    expect(previewReads).toBe(2);
  } finally {internal.dispose();}
});
