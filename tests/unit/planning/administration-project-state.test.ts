import { afterEach, expect, test, vi } from "vitest";
import { createPlanningState } from "@/features/planning/model/internal/planning-state-owner";
import { emptyPlanningShellState } from "@/features/planning/model/planning-shell-state";
import { sessionAuthority } from "@/features/administrator-access/model/administrator-access";
import { administrationStoryModel } from "@/features/administration/organisms/administration-workspace.stories";
const now = Date.parse("2026-01-01T12:00:00Z");
const authority = sessionAuthority({ platformRole: "ceo", credentialKind: "session", administratorAccess: { eligible: true, active: true, expiresAt: new Date(now + 60000).toISOString() } });
const project = { id: "findmydoc-founder-execution", owner: "findmydoc-platform", number: 7, mentionTeamSlug: "founderops" };
const model = { ...administrationStoryModel, githubProject: project, coverage: { people: "complete" as const, technical: true, notificationEvents: "partial" as const, notificationDeliveries: "partial" as const } };
const data = { ...emptyPlanningShellState, project: { ...emptyPlanningShellState.project, id: project.id, githubProjectOwner: project.owner, githubProjectNumber: project.number } };
afterEach(() => vi.useRealTimers());
test("accepted Project settings remain confirmed when a later provider or Administration reload fails and preserve person data", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(now);
    let reads = 0;
    const owner = createPlanningState({ userId: "user", initialData: data, initialAdministrationAuthority: authority, adapter: { saveTask: async () => ({ task: {} }), readWorkspace: async () => null, readAdministration: async () => { if (reads++)
                throw Object.assign(new Error("Provider unavailable"), { status: 503 }); return model; }, saveAdministrationProject: async (proposed, expected) => { expect(expected).toEqual(project); return { project: { ...proposed, mentionTeamSlug: "canonical" } }; } } });
    await owner.planning.loadAdministration();
    const editor = owner.planning.beginAdministrationProjectEdit(project);
    await expect(editor.save({ ...project, number: 8, mentionTeamSlug: "canonical" })).resolves.toEqual({ ok: true });
    expect(editor.view()).toMatchObject({ phase: "saved", readStatus: "unavailable", submitted: { number: 8 } });
    expect(owner.planning.administration().model).toMatchObject({ githubProject: { number: 8, mentionTeamSlug: "canonical" }, people: model.people });
    expect(owner.planning.sprintWorkspace().model.project.githubProjectNumber).toBe(8);
    editor.close();
    expect(owner.planning.administrationProjectEdits()[0].phase).toBe("saved");
});
test("a retained Project draft compares the original shown tuple and consciously resaves against fresh complete settings", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(now);
    let current = model, writes = 0;
    const owner = createPlanningState({ userId: "user", initialData: data, initialAdministrationAuthority: authority, adapter: { saveTask: async () => ({ task: {} }), readWorkspace: async () => null, readAdministration: async () => current, saveAdministrationProject: async (proposed, expected) => { writes++; expect(expected).toEqual({ ...project, mentionTeamSlug: "foreign-team" }); return { project: proposed }; } } });
    await owner.planning.loadAdministration();
    const editor = owner.planning.beginAdministrationProjectEdit(project);
    current = { ...model, githubProject: { ...project, mentionTeamSlug: "foreign-team" } };
    await owner.planning.loadAdministration();
    const input = { ...project, number: 8 };
    await expect(editor.save(input)).resolves.toMatchObject({ kind: "versionConflict" });
    expect(writes).toBe(0);
    expect(editor.view()).toMatchObject({ phase: "conflict", submitted: input, canResave: false });
    await expect(editor.resave(input)).resolves.toMatchObject({ ok: false });
    expect(await editor.refreshConflict()).toBe(true);
    await expect(editor.resave(input)).resolves.toEqual({ ok: true });
    expect(writes).toBe(1);
});
test("an unknown Project write retains submitted settings across navigation and matching readonly checks never replay or confirm it", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(now);
    let current = model, writes = 0, reads = 0;
    const input = { ...project, number: 8 };
    const owner = createPlanningState({ userId: "user", initialData: data, initialAdministrationAuthority: authority, adapter: { saveTask: async () => ({ task: {} }), readWorkspace: async () => null, readAdministration: async () => { reads++; return current; }, saveAdministrationProject: async () => { writes++; throw new Error("Response lost after possible audit"); } } });
    await owner.planning.loadAdministration();
    const editor = owner.planning.beginAdministrationProjectEdit(project);
    await expect(editor.save(input)).resolves.toMatchObject({ kind: "unconfirmed" });
    editor.close();
    expect(owner.planning.resumeAdministrationProjectEdit()?.view()).toMatchObject({ phase: "unconfirmed", submitted: input });
    current = { ...model, githubProject: input };
    await editor.checkOutcome();
    await editor.save(input);
    expect(editor.view()).toMatchObject({ phase: "unconfirmed", submitted: input });
    expect({ writes, reads }).toEqual({ writes: 1, reads: 2 });
});
function deferred<T>() { let resolve!: (value: T) => void; let reject!: (error: unknown) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
test("earlier Project reads and a legacy whole snapshot cannot replace confirmed settings", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(now);
    let reads = 0;
    const old = deferred<typeof model>();
    const owner = createPlanningState({ userId: "user", initialData: data, initialAdministrationAuthority: authority, adapter: { saveTask: async () => ({ task: {} }), readWorkspace: async () => ({ data: await old.promise.then(() => data) }), readAdministration: async () => ++reads === 1 ? model : reads === 2 ? old.promise : { ...model, githubProject: { ...project, number: 8 } }, saveAdministrationProject: async (proposed) => ({ project: proposed }) } });
    await owner.planning.loadAdministration();
    const loading = owner.planning.refreshWorkspace("planning"), oldAdmin = owner.planning.loadAdministration();
    const editor = owner.planning.beginAdministrationProjectEdit(project), saving = editor.save({ ...project, number: 8 });
    old.resolve(model);
    await saving;
    await loading;
    await oldAdmin;
    owner.internal.applyLegacyProjection(data);
    expect(owner.planning.administration().model?.githubProject?.number).toBe(8);
    expect(owner.planning.sprintWorkspace().model.project.githubProjectNumber).toBe(8);
});
test("known Project rejection releases a retained dependent input only after an explicit readonly check", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(now);
    const write = deferred<{
        project: typeof project;
    }>();
    let writes = 0;
    const owner = createPlanningState({ userId: "user", initialData: data, initialAdministrationAuthority: authority, adapter: { saveTask: async () => ({ task: {} }), readWorkspace: async () => null, readAdministration: async () => model, saveAdministrationProject: () => { writes++; return write.promise; } } });
    await owner.planning.loadAdministration();
    const first = owner.planning.beginAdministrationProjectEdit(project), second = owner.planning.beginAdministrationProjectEdit(project);
    const saving = first.save({ ...project, number: 8 });
    await second.save({ ...project, number: 9 });
    expect(second.view().phase).toBe("blocked");
    write.reject(Object.assign(new Error("Provider validation rejected"), { status: 422 }));
    await saving;
    await second.checkOutcome();
    expect(second.view()).toMatchObject({ phase: "editing", submitted: { number: 9 } });
    expect(writes).toBe(1);
});
test("Project optimistic settings stay outside the confirmed cache and expiry rejects late responses after the form closes", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(now);
    let cached = data, reads = 0;
    const write = deferred<{
        project: typeof project;
    }>();
    const owner = createPlanningState({ userId: "user", initialData: data, initialAdministrationAuthority: authority, publishCache: value => { if (value)
            cached = value; }, adapter: { saveTask: async () => ({ task: {} }), readWorkspace: async () => null, readAdministration: async () => { reads++; return model; }, saveAdministrationProject: () => write.promise } });
    await owner.planning.loadAdministration();
    const editor = owner.planning.beginAdministrationProjectEdit(project), saving = editor.save({ ...project, number: 8 });
    editor.close();
    expect(owner.planning.sprintWorkspace().model.project.githubProjectNumber).toBe(8);
    expect(cached.project.githubProjectNumber).toBe(7);
    await vi.advanceTimersByTimeAsync(60001);
    write.resolve({ project: { ...project, number: 8 } });
    await expect(saving).resolves.toMatchObject({ kind: "sessionSuperseded" });
    expect(editor.view()).toMatchObject({ phase: "ended", submitted: null });
    expect(owner.planning.administration().model?.githubProject).toBeNull();
    expect(cached.project.githubProjectNumber).toBe(7);
    expect(await editor.checkOutcome()).toBe(false);
    expect(reads).toBe(1);
});
test("a common Project read updates shared identity but cannot supply an unseen mention-team editing basis", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(now);
    let writes = 0;
    const owner = createPlanningState({ userId: "user", initialData: data, initialAdministrationAuthority: authority, adapter: { saveTask: async () => ({ task: {} }), readWorkspace: async () => ({ data: { ...data, project: { ...data.project, githubProjectOwner: "foreign-org", githubProjectNumber: 9 } } }), readAdministration: async () => model, saveAdministrationProject: async (proposed) => { writes++; return { project: proposed }; } } });
    await owner.planning.loadAdministration();
    await owner.planning.refreshWorkspace("planning");
    expect(owner.planning.administration()).toMatchObject({ readStatus: "stale", model: { githubProject: { owner: "foreign-org", number: 9 } } });
    const shown = owner.planning.administration().model!.githubProject!;
    const editor = owner.planning.beginAdministrationProjectEdit(shown);
    await expect(editor.save({ ...shown, number: 10 })).resolves.toMatchObject({ kind: "versionConflict" });
    expect(writes).toBe(0);
});
test.each([null, "other-account"])("Project state detaches on session replacement %s before a late confirmation", async (replacement) => {
    vi.useFakeTimers();
    vi.setSystemTime(now);
    let session!: (id: string | null) => void;
    const write = deferred<{
        project: typeof project;
    }>();
    const owner = createPlanningState({ userId: "user", initialData: data, initialAdministrationAuthority: authority, adapter: { saveTask: async () => ({ task: {} }), readWorkspace: async () => null, subscribeSession: listener => { session = listener; return () => { }; }, readAdministration: async () => model, saveAdministrationProject: () => write.promise } });
    await owner.planning.loadAdministration();
    const editor = owner.planning.beginAdministrationProjectEdit(project), saving = editor.save({ ...project, number: 8 });
    session(replacement);
    write.resolve({ project: { ...project, number: 8 } });
    await expect(saving).resolves.toMatchObject({ kind: "sessionSuperseded" });
    expect(owner.planning.administrationProjectEdits()).toEqual([]);
    expect(owner.planning.administration().model).toBeNull();
    expect(editor.view().submitted).toBeNull();
});
test("an unknown Project save leaves an independent person eligibility save usable", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(now);
    let personWrites = 0;
    const owner = createPlanningState({ userId: "user", initialData: data, initialAdministrationAuthority: authority, adapter: { saveTask: async () => ({ task: {} }), readWorkspace: async () => null, readAdministration: async () => model, saveAdministrationProject: async () => { throw Object.assign(new Error("Uncertain"), { status: 500 }); }, saveAdministrationEligibility: async (profileId, eligible) => { personWrites++; return { profileId, eligible, active: false, expiresAt: null }; } } });
    await owner.planning.loadAdministration();
    const editor = owner.planning.beginAdministrationProjectEdit(project);
    await editor.save({ ...project, number: 8 });
    const person = owner.planning.administration().model!.people[0];
    const personEditor = owner.planning.beginAdministrationPersonEdit(person);
    await expect(personEditor.save({ eligible: !person.administratorAccess.eligible, technicalIdentity: { githubLogin: person.githubLogin, googleChatUserId: person.googleChatUserId, googleChatDmSpace: person.googleChatDmSpace } })).resolves.toMatchObject({ ok: true });
    expect(personWrites).toBe(1);
    expect(editor.view().phase).toBe("unconfirmed");
});


test.each([["administration_project_conflict","versionConflict","conflict"],["session_superseded","sessionSuperseded","unconfirmed"]] as const)("Project 409 %s retains its actual meaning",async(code,kind,phase)=>{
 vi.useFakeTimers();vi.setSystemTime(now);let writes=0;
 const owner=createPlanningState({userId:"user",initialData:data,initialAdministrationAuthority:authority,adapter:{saveTask:async()=>({task:{}}),readWorkspace:async()=>null,readAdministration:async()=>model,saveAdministrationProject:async()=>{writes++;throw Object.assign(new Error("Rejected request"),{status:409,code});}}});await owner.planning.loadAdministration();const editor=owner.planning.beginAdministrationProjectEdit(project);await expect(editor.save({...project,number:8})).resolves.toMatchObject({kind});expect(editor.view().phase).toBe(phase);expect(writes).toBe(1);
});

test("an older own Project receipt confirms its operation without replacing a later foreign complete Project tuple",async()=>{
 vi.useFakeTimers();vi.setSystemTime(now);let reads=0;const write=deferred<{project:typeof project}>(),foreign={...project,number:9,mentionTeamSlug:"foreign-team"};
 const owner=createPlanningState({userId:"user",initialData:data,initialAdministrationAuthority:authority,adapter:{saveTask:async()=>({task:{}}),readWorkspace:async()=>null,readAdministration:async()=>{reads++;if(reads===1)return model;if(reads===2)return{...model,githubProject:foreign};throw Object.assign(new Error("Reload unavailable"),{status:503});},saveAdministrationProject:()=>write.promise}});await owner.planning.loadAdministration();const editor=owner.planning.beginAdministrationProjectEdit(project),saving=editor.save({...project,number:8});await owner.planning.loadAdministration();write.resolve({project:{...project,number:8}});await expect(saving).resolves.toEqual({ok:true});expect(editor.view().phase).toBe("saved");expect(owner.planning.administration().model?.githubProject).toEqual(foreign);expect(owner.planning.sprintWorkspace().model.project.githubProjectNumber).toBe(9);await expect(editor.save({...project,number:10})).resolves.toMatchObject({kind:"versionConflict"});
});
