import { afterEach, expect, test, vi } from "vitest";
import { createBrowserPlanningState } from "@/features/planning/model/internal/browser-planning-state";
import { createBrowserApiClient } from "@/lib/browser-api-client";
import { emptyPlanningShellState } from "@/features/planning/model/planning-shell-state";
import { emptyPlanningHeaderData } from "@/lib/planning-header-data";
import { taskDetailStoryTask } from "@/features/tasks/molecules/task-detail-story-fixtures";
import type { BrowserSessionSnapshot } from "@/lib/credentials/browser";
afterEach(() => vi.unstubAllGlobals());
test("owned GitHub sync cannot acquire a replacement account during the held JSON session lookup", async () => {
    let finish!: (session: BrowserSessionSnapshot) => void;
    const initial = { userId: "user", revision: "old", expiresAt: 4102444800, user: { id: "user" } }, replacement = { ...initial, userId: "replacement", revision: "new", user: { id: "replacement" } };
    const task = taskDetailStoryTask({ id: "task", updatedAt: "revision" });
    const browser = createBrowserPlanningState({ initialUserId: "user", initialWorkspace: "planning", initialCurrentProfile: null, initialData: { ...emptyPlanningShellState, tasks: [task] }, initialHeaderData: emptyPlanningHeaderData });
    browser.runtime.session = initial;
    browser.runtime.apiClient = createBrowserApiClient({ sessionPort: { current: () => new Promise(resolve => { finish = resolve; }), recover: async () => ({ kind: "superseded" }), clearIfCurrent: async () => { } } });
    const fetch = vi.fn(async () => Response.json({ error: "Should never reach this endpoint" }, { status: 403 }));
    vi.stubGlobal("fetch", fetch);
    const writing = browser.owner.planning.syncTaskToGitHub(task);
    await vi.waitFor(() => expect(finish).toBeTypeOf("function"));
    finish(replacement);
    expect(await writing).toMatchObject({ phase: "ended" });
    expect(fetch).not.toHaveBeenCalled();
    expect(browser.owner.planning.protectedCache()).toBeNull();
});

test("an ordinary Task edit cannot dispatch its private input under a replacement account", async () => {
    let finish!: (session: BrowserSessionSnapshot) => void;
    const initial = { userId: "user", revision: "old", expiresAt: 4102444800, user: { id: "user" } };
    const task = taskDetailStoryTask({ id: "task", updatedAt: "revision" });
    const browser = createBrowserPlanningState({ initialUserId: "user", initialWorkspace: "planning", initialCurrentProfile: null, initialData: { ...emptyPlanningShellState, tasks: [task] }, initialHeaderData: emptyPlanningHeaderData });
    browser.runtime.session = initial;
    browser.runtime.apiClient = createBrowserApiClient({ sessionPort: { current: () => new Promise(resolve => { finish = resolve; }), recover: async () => ({ kind: "superseded" }), clearIfCurrent: async () => {} } });
    const fetch = vi.fn(async () => Response.json({ error: "Forbidden" }, { status: 403 }));
    vi.stubGlobal("fetch", fetch);
    const writing = browser.owner.planning.beginTaskEdit(task).save({ title: "Private older input" });
    await vi.waitFor(() => expect(finish).toBeTypeOf("function"));
    finish({ ...initial, userId: "other", revision: "new", user: { id: "other" } });
    expect(await writing).toMatchObject({ kind: "sessionSuperseded" });
    expect(fetch).not.toHaveBeenCalled();
    expect(browser.owner.planning.protectedCache()).toBeNull();
});

test("ending an owner during a held same-account credential lookup prevents its Task dispatch", async () => {
    let finish!: (session: BrowserSessionSnapshot) => void;
    const session = { userId: "user", revision: "same", expiresAt: 4102444800, user: { id: "user" } };
    const task = taskDetailStoryTask({ id: "task", updatedAt: "revision" });
    const browser = createBrowserPlanningState({ initialUserId: "user", initialWorkspace: "planning", initialCurrentProfile: null, initialData: { ...emptyPlanningShellState, tasks: [task] }, initialHeaderData: emptyPlanningHeaderData });
    browser.runtime.session = session;
    browser.runtime.apiClient = createBrowserApiClient({ sessionPort: { current: () => new Promise(resolve => { finish = resolve; }), recover: async () => ({ kind: "superseded" }), clearIfCurrent: async () => {} } });
    const fetch = vi.fn(async () => Response.json({ error: "Denied" }, { status: 403 }));
    vi.stubGlobal("fetch", fetch);
    const writing = browser.owner.planning.beginTaskEdit(task).save({ title: "Private ended input" });
    await vi.waitFor(() => expect(finish).toBeTypeOf("function"));
    browser.owner.internal.endSession();
    finish(session);
    expect(await writing).toMatchObject({ kind: "sessionSuperseded" });
    expect(fetch).not.toHaveBeenCalled();
});

test("an owned Task request cannot dispatch when the actual same-account credential expired during lookup", async () => {
    const session={userId:"user",revision:"same",expiresAt:Math.floor(Date.now()/1000)+3600,user:{id:"user"}};
    const task=taskDetailStoryTask({id:"task",updatedAt:"revision"});
    const browser=createBrowserPlanningState({initialUserId:"user",initialWorkspace:"planning",initialCurrentProfile:null,initialData:{...emptyPlanningShellState,tasks:[task]},initialHeaderData:emptyPlanningHeaderData});
    browser.runtime.session=session;
    browser.runtime.apiClient=createBrowserApiClient({sessionPort:{current:async()=>({...session,expiresAt:Math.floor(Date.now()/1000)-1}),recover:async()=>({kind:"superseded"}),clearIfCurrent:async()=>{}}});
    const dispatch=vi.fn(async()=>Response.json({error:"Should not send"},{status:403}));vi.stubGlobal("fetch",dispatch);
    expect(await browser.owner.planning.saveTask(task,{title:"Private"})).toMatchObject({kind:"sessionSuperseded"});expect(dispatch).not.toHaveBeenCalled();
});
