import { afterEach, expect, test, vi } from "vitest";
import { createPlanningState } from "@/features/planning/model/internal/planning-state-owner";
import { emptyPlanningShellState } from "@/features/planning/model/planning-shell-state";
import type { AdministrationWorkspaceModel } from "@/features/administration/model/administration-read-model";
import { sessionAuthority } from "@/features/administrator-access/model/administrator-access";
import type { Profile } from "@/lib/types";
const now = Date.parse("2026-01-01T12:00:00Z");
const authority = sessionAuthority({ platformRole: "ceo", credentialKind: "session", administratorAccess: { eligible: true, active: true, expiresAt: new Date(now + 60000).toISOString() } });
const person = { id: "person", name: "Ada", platformRole: "founder" as const, orgRole: "Engineering", githubLogin: "ada", githubConnection: null, googleChatUserId: "chat-user", googleChatDmSpace: "dm-space", notificationsEnabled: true, googleChatReady: true, technicalBasis: { githubLogin: "ada", googleChatUserId: "chat-user", googleChatDmSpace: "dm-space" }, administratorAccess: { eligible: false, active: false, expiresAt: null } };
const model: AdministrationWorkspaceModel = { revision: "not-a-record-version", capabilities: authority.capabilities, people: [person], githubProject: { id: "project", owner: "team", number: 1, mentionTeamSlug: "founders" }, notificationEvents: [], notificationDeliveries: [], integrationStatus: { githubApp: null, googleChat: { ready: false, webhookConfigured: false, apiConfigured: false, deliveryEnabled: false, mode: "not-configured" }, mentionTeam: { state: "fallback", githubHandle: "", profilesWithoutGitHubLogin: 0 }, pendingDeliveries: 0, failedDeliveries: 0 }, coverage: { people: "complete", technical: true, notificationEvents: "partial", notificationDeliveries: "partial" } };
const profile = { id: person.id, name: person.name, platformRole: person.platformRole, orgRole: person.orgRole, githubLogin: "independently-authorized", weeklyCapacity: 10 } satisfies Profile;
function deferred<T>() { let resolve!: (value: T) => void; let reject!: (error: unknown) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
afterEach(() => vi.useRealTimers());
test("the shared Admin projection expires its restricted audience after navigation and rejects a late full read while independent Profile data survives", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(now);
    const delayed = deferred<AdministrationWorkspaceModel>();
    let reads = 0;
    const owner = createPlanningState({ userId: "user", initialData: { ...emptyPlanningShellState, profiles: [profile] }, initialAdministrationAuthority: authority, adapter: { saveTask: async () => ({ task: {} }), readWorkspace: async () => null, readAdministration: async () => ++reads === 1 ? model : delayed.promise } });
    await owner.planning.loadAdministration();
    expect(owner.planning.administration()).toMatchObject({ readStatus: "current", coverage: { technical: true }, model: { people: [{ githubLogin: "ada" }] } });
    const pending = owner.planning.loadAdministration();
    await vi.advanceTimersByTimeAsync(60001);
    expect(owner.planning.administration()).toMatchObject({ coverage: { technical: false }, model: { people: [{ githubLogin: "", googleChatUserId: "", googleChatDmSpace: "" }], githubProject: null } });
    delayed.resolve(model);
    await pending;
    expect(owner.planning.administration().model?.people[0].githubLogin).toBe("");
    expect(owner.planning.profileSettings(person.id).profile?.githubLogin).toBe("ada");
    expect(owner.planning.protectedCache()?.profiles[0].githubLogin).toBe("ada");
});
test("confirmed technical identity survives rejected eligibility and unavailable reload, with only actual fields entering the shared Admin projection", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(now);
    let reads = 0;
    const technical = deferred<{
        profile: {
            id: string;
            githubLogin: string;
            googleChatUserId: string;
            googleChatDmSpace: string;
        };
    }>();
    const owner = createPlanningState({ userId: "user", initialData: { ...emptyPlanningShellState, profiles: [profile] }, initialAdministrationAuthority: authority, adapter: { saveTask: async () => ({ task: {} }), readWorkspace: async () => null, readAdministration: async () => { if (reads++)
                throw Object.assign(new Error("Reload unavailable"), { status: 503 }); return model; }, saveAdministrationTechnical: () => technical.promise, saveAdministrationEligibility: async () => { throw Object.assign(new Error("Eligibility rejected"), { status: 400 }); } } });
    await owner.planning.loadAdministration();
    const editor = owner.planning.beginAdministrationPersonEdit(person);
    const patch = { eligible: true, technicalIdentity: { githubLogin: "new-login", googleChatUserId: "chat-user", googleChatDmSpace: "dm-space" } };
    const result = editor.save(patch);
    expect(editor.view()).toMatchObject({ phase: "saving", submitted: patch, technical: { phase: "saving" } });
    expect(owner.planning.administration().model?.people[0].githubLogin).toBe("new-login");
    technical.resolve({ profile: { id: person.id, ...patch.technicalIdentity } });
    await result;
    expect(editor.view()).toMatchObject({ phase: "partial", technical: { phase: "confirmed" }, eligibility: { phase: "rejected" }, submitted: patch, readStatus: "unavailable" });
    expect(owner.planning.administration().model?.people[0].githubLogin).toBe("new-login");
    expect(owner.planning.profileSettings(person.id).profile?.githubLogin).toBe("new-login");
    editor.close();
    expect(owner.planning.administrationPersonEdits(person.id)[0]).toMatchObject({ technical: { phase: "confirmed" } });
});
test("an acknowledged technical step without a returned tuple is never repeated by an unchanged partial save", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(now);
    let technicalWrites = 0, eligibilityWrites = 0, reads = 0;
    const owner = createPlanningState({ userId: "user", initialData: emptyPlanningShellState, initialAdministrationAuthority: authority, adapter: { saveTask: async () => ({ task: {} }), readWorkspace: async () => null, readAdministration: async () => { if (reads++)
                throw new Error("Unavailable"); return model; }, saveAdministrationTechnical: async () => { technicalWrites++; return {}; }, saveAdministrationEligibility: async () => { eligibilityWrites++; throw Object.assign(new Error("Rejected"), { status: 400 }); } } });
    await owner.planning.loadAdministration();
    const editor = owner.planning.beginAdministrationPersonEdit(person);
    const patch = { eligible: true, technicalIdentity: { githubLogin: "acknowledged", googleChatUserId: "chat-user", googleChatDmSpace: "dm-space" } };
    await editor.save(patch);
    expect(editor.view()).toMatchObject({ phase: "partial", technical: { phase: "confirmed" } });
    expect(owner.planning.administration().model?.people[0].githubLogin).toBe("ada");
    await editor.save(patch);
    expect({ technicalWrites, eligibilityWrites }).toEqual({ technicalWrites: 1, eligibilityWrites: 2 });
});
test("a lost technical response remains unresolved after matching read-back and never sends dependent eligibility or another technical write", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(now);
    let writes = 0, eligibilityWrites = 0;
    const patch = { eligible: true, technicalIdentity: { githubLogin: "uncertain", googleChatUserId: "chat-user", googleChatDmSpace: "dm-space" } };
    let readModel = model;
    const owner = createPlanningState({ userId: "user", initialData: emptyPlanningShellState, initialAdministrationAuthority: authority, adapter: { saveTask: async () => ({ task: {} }), readWorkspace: async () => null, readAdministration: async () => readModel, saveAdministrationTechnical: async () => { writes++; throw new Error("Lost response"); }, saveAdministrationEligibility: async () => { eligibilityWrites++; return { profileId: person.id, eligible: true, active: false, expiresAt: null }; } } });
    await owner.planning.loadAdministration();
    const editor = owner.planning.beginAdministrationPersonEdit(person);
    await editor.save(patch);
    editor.close();
    readModel = { ...model, people: [{ ...person, ...patch.technicalIdentity, technicalBasis: patch.technicalIdentity }] };
    await editor.checkOutcome();
    await editor.save(patch);
    expect(editor.view()).toMatchObject({ phase: "unconfirmed", submitted: patch, technical: { phase: "unconfirmed" }, eligibility: { phase: "not-needed" } });
    expect({ writes, eligibilityWrites }).toEqual({ writes: 1, eligibilityWrites: 0 });
});
test("original person inputs require a fresh comparison and deliberate resave after an accepted background change", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(now);
    let writes = 0;
    const actual = { ...person, githubLogin: "foreign", technicalBasis: { ...person.technicalBasis, githubLogin: "foreign" } };
    let readModel = model;
    const owner = createPlanningState({ userId: "user", initialData: emptyPlanningShellState, initialAdministrationAuthority: authority, adapter: { saveTask: async () => ({ task: {} }), readWorkspace: async () => null, readAdministration: async () => readModel, saveAdministrationTechnical: async (id, patch, expected) => { writes++; expect(expected.githubLogin).toBe("foreign"); return { profile: { id, ...patch } }; } } });
    await owner.planning.loadAdministration();
    const editor = owner.planning.beginAdministrationPersonEdit(person);
    readModel = { ...model, people: [actual] };
    await owner.planning.loadAdministration();
    const patch = { eligible: false, technicalIdentity: { githubLogin: "retained", googleChatUserId: "chat-user", googleChatDmSpace: "dm-space" } };
    await expect(editor.save(patch)).resolves.toMatchObject({ kind: "versionConflict" });
    expect(writes).toBe(0);
    expect(editor.view().submitted).toEqual(patch);
    await expect(editor.resave(patch)).resolves.toMatchObject({ ok: false });
    expect(await editor.refreshConflict()).toBe(true);
    await expect(editor.resave(patch)).resolves.toMatchObject({ ok: true });
    expect(writes).toBe(1);
});
test("late technical confirmation after lease expiry cannot restore its draft when a new lease starts", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(now);
    const write = deferred<{
        profile: {
            id: string;
            githubLogin: string;
            googleChatUserId: string;
            googleChatDmSpace: string;
        };
    }>();
    let eligibilityWrites = 0;
    const owner = createPlanningState({ userId: "user", initialData: emptyPlanningShellState, initialAdministrationAuthority: authority, adapter: { saveTask: async () => ({ task: {} }), readWorkspace: async () => null, readAdministration: async () => model, saveAdministrationTechnical: () => write.promise, saveAdministrationEligibility: async () => { eligibilityWrites++; return { profileId: person.id, eligible: true, active: false, expiresAt: null }; } } });
    await owner.planning.loadAdministration();
    const editor = owner.planning.beginAdministrationPersonEdit(person);
    const input = { eligible: true, technicalIdentity: { githubLogin: "private-draft", googleChatUserId: "private-chat", googleChatDmSpace: "private-space" } };
    const result = editor.save(input);
    await vi.advanceTimersByTimeAsync(60001);
    owner.internal.bindAdministrationAuthority(sessionAuthority({ platformRole: "ceo", credentialKind: "session", administratorAccess: { eligible: true, active: true, expiresAt: new Date(now + 180000).toISOString() } }));
    write.resolve({ profile: { id: person.id, ...input.technicalIdentity } });
    await expect(result).resolves.toMatchObject({ kind: "sessionSuperseded" });
    expect(editor.view()).toMatchObject({ phase: "ended", submitted: null });
    expect(eligibilityWrites).toBe(0);
    expect(JSON.stringify(owner.planning.administration())).not.toContain("private-chat");
});
test("confirmed loss of the actor CEO role revokes eligibility scope without clearing independent Team or Task data", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(now);
    const actor = { ...profile, id: "actor", platformRole: "ceo" as const };
    const ceoOnly = sessionAuthority({ platformRole: "ceo", credentialKind: "session", administratorAccess: { eligible: false, active: false, expiresAt: null } });
    const owner = createPlanningState({ userId: "user", initialData: { ...emptyPlanningShellState, profiles: [actor, profile] }, administrationActorProfileId: actor.id, initialAdministrationAuthority: ceoOnly, adapter: { saveTask: async () => ({ task: {} }), readWorkspace: async () => null, readAdministration: async () => ({ ...model, capabilities: ceoOnly.capabilities, coverage: { people: "complete", technical: false, notificationEvents: "none", notificationDeliveries: "none" } }), saveTeamProfile: async (id, patch) => ({ id, ...patch }) } });
    await owner.planning.loadAdministration();
    expect(owner.planning.administration().model).not.toBeNull();
    await owner.planning.saveTeamProfile(actor.id, { platformRole: "founder" });
    expect(owner.planning.administration()).toMatchObject({ model: null, readStatus: "forbidden" });
    expect(owner.planning.profileSettings(person.id).profile?.id).toBe(person.id);
    expect(owner.planning.protectedCache()?.profiles).toHaveLength(2);
});
test("Administration uses the same accepted GitHub identity as Team without treating a Team read as a complete technical editing basis", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(now);
    let writes = 0;
    const owner = createPlanningState({ userId: "user", initialData: { ...emptyPlanningShellState, profiles: [profile] }, initialAdministrationAuthority: authority, adapter: { saveTask: async () => ({ task: {} }), readWorkspace: async () => ({ data: { ...emptyPlanningShellState, profiles: [{ ...profile, githubLogin: "team-confirmed" }] } }), readAdministration: async () => model, saveAdministrationTechnical: async (id, patch) => { writes++; return { profile: { id, ...patch } }; } } });
    await owner.planning.loadAdministration();
    const editor = owner.planning.beginAdministrationPersonEdit(person);
    await owner.planning.refreshWorkspace("team");
    expect(owner.planning.administration()).toMatchObject({ readStatus: "stale", model: { people: [{ githubLogin: "team-confirmed", technicalBasis: undefined }] } });
    await expect(editor.save({ eligible: false, technicalIdentity: { githubLogin: "retained", googleChatUserId: "chat-user", googleChatDmSpace: "dm-space" } })).resolves.toMatchObject({ kind: "versionConflict" });
    expect(writes).toBe(0);
});
test("CEO eligibility conflict can be compared and consciously saved without granting technical authority", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(now);
    const ceoOnly = sessionAuthority({ platformRole: "ceo", credentialKind: "session", administratorAccess: { eligible: false, active: false, expiresAt: null } });
    let reads = 0, writes = 0;
    let eligible = false;
    const owner = createPlanningState({ userId: "user", initialData: emptyPlanningShellState, initialAdministrationAuthority: ceoOnly, adapter: { saveTask: async () => ({ task: {} }), readWorkspace: async () => null, readAdministration: async () => ({ ...model, capabilities: ceoOnly.capabilities, coverage: { people: "complete", technical: false, notificationEvents: "none", notificationDeliveries: "none" }, people: [{ ...person, administratorAccess: { eligible: reads++ ? true : eligible, active: false, expiresAt: null } }] }), saveAdministrationEligibility: async (id, next, expected) => { writes++; expect(expected).toBe(true); eligible = next; return { profileId: id, eligible: next, active: false, expiresAt: null }; } } });
    await owner.planning.loadAdministration();
    const shown = owner.planning.administration().model!.people[0];
    const editor = owner.planning.beginAdministrationPersonEdit(shown);
    await owner.planning.loadAdministration();
    const patch = { eligible: true, technicalIdentity: { githubLogin: "", googleChatUserId: "", googleChatDmSpace: "" } };
    await expect(editor.save(patch)).resolves.toMatchObject({ kind: "versionConflict" });
    expect(await editor.refreshConflict()).toBe(true);
    expect(editor.view().canResave).toBe(true);
    await expect(editor.resave({ ...patch, eligible: false })).resolves.toMatchObject({ ok: true });
    expect(writes).toBe(1);
    expect(owner.planning.administration().coverage.technical).toBe(false);
});
test("a retained unsent dependent person input becomes editable after a known predecessor rejection without sending itself", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(now);
    const write = deferred<{
        profile?: never;
    }>();
    let writes = 0;
    const owner = createPlanningState({ userId: "user", initialData: emptyPlanningShellState, initialAdministrationAuthority: authority, adapter: { saveTask: async () => ({ task: {} }), readWorkspace: async () => null, readAdministration: async () => model, saveAdministrationTechnical: async () => { writes++; return write.promise; } } });
    await owner.planning.loadAdministration();
    const first = owner.planning.beginAdministrationPersonEdit(person), dependent = owner.planning.beginAdministrationPersonEdit(person);
    const input = { eligible: false, technicalIdentity: { githubLogin: "first", googleChatUserId: "chat-user", googleChatDmSpace: "dm-space" } };
    const saving = first.save(input);
    await dependent.save({ ...input, technicalIdentity: { ...input.technicalIdentity, githubLogin: "retained dependent" } });
    expect(dependent.view().phase).toBe("blocked");
    write.reject(Object.assign(new Error("Known rejection"), { status: 400 }));
    await saving;
    await dependent.checkOutcome();
    expect(dependent.view()).toMatchObject({ phase: "editing", submitted: { technicalIdentity: { githubLogin: "retained dependent" } } });
    expect(writes).toBe(1);
});
test("an older own technical receipt confirms its step without replacing a later accepted foreign identity", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(now);
    let reads = 0;
    const write = deferred<{
        profile: {
            id: string;
            githubLogin: string;
            googleChatUserId: string;
            googleChatDmSpace: string;
        };
    }>();
    const foreign = { ...person, githubLogin: "foreign-after-own", technicalBasis: { ...person.technicalBasis, githubLogin: "foreign-after-own" } };
    const owner = createPlanningState({ userId: "user", initialData: { ...emptyPlanningShellState, profiles: [profile] }, initialAdministrationAuthority: authority, adapter: { saveTask: async () => ({ task: {} }), readWorkspace: async () => null, readAdministration: async () => { reads++; if (reads === 1)
                return model; if (reads === 2)
                return { ...model, people: [foreign] }; throw Object.assign(new Error("Reload unavailable"), { status: 503 }); }, saveAdministrationTechnical: () => write.promise } });
    await owner.planning.loadAdministration();
    const editor = owner.planning.beginAdministrationPersonEdit(person);
    const input = { eligible: false, technicalIdentity: { ...person.technicalBasis, githubLogin: "own-confirmed" } };
    const saving = editor.save(input);
    await owner.planning.loadAdministration();
    write.resolve({ profile: { id: person.id, ...input.technicalIdentity } });
    await expect(saving).resolves.toEqual({ ok: true });
    expect(editor.view()).toMatchObject({ phase: "saved", technical: { phase: "confirmed" } });
    expect(owner.planning.administration().model?.people[0].githubLogin).toBe("foreign-after-own");
    expect(owner.planning.profileSettings(person.id).profile?.githubLogin).toBe("foreign-after-own");
    expect(owner.planning.protectedCache()?.profiles[0].githubLogin).toBe("foreign-after-own");
    await expect(editor.save({ ...input, technicalIdentity: { ...input.technicalIdentity, githubLogin: "next-draft" } })).resolves.toMatchObject({ kind: "versionConflict" });
});
test.each([null, "another-account"])("session replacement %s clears restricted submitted input and rejects late reads and confirmations", async (replacement) => {
    vi.useFakeTimers();
    vi.setSystemTime(now);
    let session!: (userId: string | null) => void;
    let reads = 0;
    const read = deferred<AdministrationWorkspaceModel>(), write = deferred<{
        profile: {
            id: string;
            githubLogin: string;
            googleChatUserId: string;
            googleChatDmSpace: string;
        };
    }>();
    const owner = createPlanningState({ userId: "user", initialData: emptyPlanningShellState, initialAdministrationAuthority: authority, adapter: { saveTask: async () => ({ task: {} }), readWorkspace: async () => null, subscribeSession: listener => { session = listener; return () => { }; }, readAdministration: async () => ++reads === 1 ? model : read.promise, saveAdministrationTechnical: () => write.promise } });
    await owner.planning.loadAdministration();
    const editor = owner.planning.beginAdministrationPersonEdit(person), input = { eligible: false, technicalIdentity: { ...person.technicalBasis, googleChatUserId: "private-submitted" } };
    const saving = editor.save(input), loading = owner.planning.loadAdministration();
    session(replacement);
    write.resolve({ profile: { id: person.id, ...input.technicalIdentity } });
    read.resolve(model);
    await expect(saving).resolves.toMatchObject({ kind: "sessionSuperseded" });
    await loading;
    expect(owner.planning.administration()).toMatchObject({ model: null, readStatus: "forbidden" });
    expect(owner.planning.administrationPersonEdits(person.id)).toEqual([]);
    expect(editor.view()).toMatchObject({ phase: "ended", submitted: null });
});
test("an uncertain person's write does not block another person's independent confirmed eligibility", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(now);
    let technicalWrites = 0, eligibilityWrites = 0;
    const other = { ...person, id: "independent" };
    const owner = createPlanningState({ userId: "user", initialData: emptyPlanningShellState, initialAdministrationAuthority: authority, adapter: { saveTask: async () => ({ task: {} }), readWorkspace: async () => null, readAdministration: async () => ({ ...model, people: [person, other] }), saveAdministrationTechnical: async () => { technicalWrites++; throw new Error("Lost response"); }, saveAdministrationEligibility: async (id, eligible) => { eligibilityWrites++; return { profileId: id, eligible, active: false, expiresAt: null }; } } });
    await owner.planning.loadAdministration();
    const uncertain = owner.planning.beginAdministrationPersonEdit(person);
    await uncertain.save({ eligible: true, technicalIdentity: { ...person.technicalBasis, githubLogin: "unknown" } });
    const independent = owner.planning.beginAdministrationPersonEdit(other);
    await expect(independent.save({ eligible: true, technicalIdentity: other.technicalBasis })).resolves.toEqual({ ok: true });
    expect(independent.view().eligibility.phase).toBe("confirmed");
    expect(uncertain.view().phase).toBe("unconfirmed");
    expect({ technicalWrites, eligibilityWrites }).toEqual({ technicalWrites: 1, eligibilityWrites: 1 });
});
test("a known authorization rejection cannot be regranted by the same cached authority snapshot", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(now);
    let reads = 0;
    const owner = createPlanningState({ userId: "user", initialData: emptyPlanningShellState, initialAdministrationAuthority: authority, adapter: { saveTask: async () => ({ task: {} }), readWorkspace: async () => null, readAdministration: async () => { reads++; return model; }, saveAdministrationTechnical: async () => { throw Object.assign(new Error("Denied"), { status: 403 }); } } });
    await owner.planning.loadAdministration();
    const editor = owner.planning.beginAdministrationPersonEdit(person);
    await editor.save({ eligible: false, technicalIdentity: { ...person.technicalBasis, googleChatUserId: "private-denied" } });
    owner.internal.bindAdministrationAuthority(authority);
    await owner.planning.loadAdministration();
    expect(owner.planning.administration()).toMatchObject({ model: null, readStatus: "forbidden" });
    expect(editor.view()).toMatchObject({ phase: "ended", submitted: null });
    expect(reads).toBe(1);
});


test("an explicitly restored same-account protected lifetime binds its current authority without reviving old person input",async()=>{
 vi.useFakeTimers();vi.setSystemTime(now);
 const owner=createPlanningState({userId:"user",initialData:emptyPlanningShellState,initialAdministrationAuthority:authority,adapter:{saveTask:async()=>({task:{}}),readWorkspace:async()=>null,readAdministration:async()=>model,saveAdministrationTechnical:async()=>{throw new Error("Uncertain before held logout");}}});
 await owner.planning.loadAdministration();const editor=owner.planning.beginAdministrationPersonEdit(person);await editor.save({eligible:false,technicalIdentity:{...person.technicalBasis,googleChatUserId:"discarded-private"}});
 owner.internal.suspendProtected();owner.internal.acceptHydration(emptyPlanningShellState,"user","administration");owner.internal.bindAdministrationAuthority(authority);
 expect(await owner.planning.loadAdministration()).toBe(true);expect(owner.planning.administration().coverage.technical).toBe(true);expect(owner.planning.administrationPersonEdits(person.id)).toEqual([]);expect(editor.view()).toMatchObject({phase:"ended",submitted:null});
});


test("a partial person read retains membership without treating omitted identities as new common confirmations",async()=>{
 vi.useFakeTimers();vi.setSystemTime(now);let reads=0;
 const owner=createPlanningState({userId:"user",initialData:{...emptyPlanningShellState,profiles:[profile]},initialAdministrationAuthority:authority,adapter:{saveTask:async()=>({task:{}}),readWorkspace:async()=>({data:{...emptyPlanningShellState,profiles:[{...profile,githubLogin:"common-newer"}]}}),readAdministration:async()=>++reads===1?model:{...model,people:[],coverage:{...model.coverage!,people:"partial"}}}});
 await owner.planning.loadAdministration();await owner.planning.refreshWorkspace("team");await owner.planning.loadAdministration();expect(owner.planning.profileSettings(person.id).profile?.githubLogin).toBe("common-newer");expect(owner.planning.administration()).toMatchObject({readStatus:"stale",coverage:{people:"partial"},model:{people:[{id:person.id,githubLogin:"common-newer",technicalBasis:undefined}]}});
});
