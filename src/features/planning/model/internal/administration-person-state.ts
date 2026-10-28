import type { AuthorityProjection } from "@/features/administrator-access/model/administrator-access";
import { inactiveAdministratorAccess, sessionAuthority } from "@/features/administrator-access/model/administrator-access";
import type { AdministrationProfile, PersonAdministrationPatch, AdministrationReadCoverage, AdministrationWorkspaceModel, TechnicalIdentityBasis } from "@/features/administration/model/administration-read-model";
import type { AdministrationPersonAdapter, AdministrationPersonEditor, AdministrationPersonEditView, AdministrationPersonResult, AdministrationStateView } from "@/features/administration/model/administration-state";
import type { PlanningReadStatus } from "../planning-state";
import type { Profile } from "@/lib/types";
function sameTechnicalBasis(first: TechnicalIdentityBasis | undefined, second: TechnicalIdentityBasis | undefined) {
    return first && second ? (["githubLogin", "googleChatUserId", "googleChatDmSpace"] as const).every(field => first[field] === second[field]) : first === second;
}
const none: AdministrationReadCoverage = { people: "partial", technical: false, notificationEvents: "none", notificationDeliveries: "none" };
const inactive = sessionAuthority({ platformRole: "viewer", credentialKind: "session", administratorAccess: inactiveAdministratorAccess });
export function createAdministrationPersonState(options: {
    actorRole?(): import("@/lib/types").PlatformRole | null;
    active(): boolean;
    generation(): number;
    changed(): void;
    now(): number;
    nextSequence(): number;
    profiles(): readonly Profile[];
    acceptCommonPeople(people: readonly ({
        id: string;
    } & Partial<Pick<Profile, "name" | "platformRole" | "orgRole" | "githubLogin">>)[], started: number): void;
    initialAuthority?: AuthorityProjection;
    read?: () => Promise<AdministrationWorkspaceModel>;
    adapter: AdministrationPersonAdapter;
}) {
    let authority = options.initialAuthority || inactive;
    let boundSignature = JSON.stringify(authority);
    const editors = new Map<symbol, {
        id: string;
        editor: AdministrationPersonEditor;
        revokeTechnical(): void;
    }>();
    const technicalStamps = new Map<string, number>(), eligibilityStamps = new Map<string, number>();
    let epoch = 0, sequence = 0;
    let eligibilityDenied = false;
    let model: AdministrationWorkspaceModel | null = null;
    let readStatus: PlanningReadStatus = "not-loaded";
    let expiry: ReturnType<typeof setTimeout> | undefined;
    function technical() { return authority.capabilities.technicalAdministration && authority.administratorAccess.active && authority.administratorAccess.eligible && Boolean(authority.administratorAccess.expiresAt) && Date.parse(authority.administratorAccess.expiresAt!) > options.now(); }
    function mayRead() { return options.active() && !eligibilityDenied && (authority.capabilities.ceoGovernance || technical() && authority.capabilities.manageAdministratorEligibility); }
    function eligibilityAudience() { return eligibilityDenied ? "denied" : authority.capabilities.ceoGovernance ? "ceo" : technical() ? `admin:${authority.administratorAccess.expiresAt}` : "none"; }
    function revokeTechnical() { for (const entry of editors.values())
        entry.revokeTechnical(); }
    function reduced(current: AdministrationWorkspaceModel): AdministrationWorkspaceModel {
        return { ...current, capabilities: { ...authority.capabilities, technicalAdministration: false, operationalCorrection: false, manageAdministratorEligibility: mayRead() }, people: current.people.map(person => ({ ...person, githubLogin: "", githubConnection: null, googleChatUserId: "", googleChatDmSpace: "", notificationsEnabled: false, googleChatReady: false, technicalBasis: undefined })), githubProject: null, notificationEvents: [], notificationDeliveries: [], coverage: { ...current.coverage || none, technical: false, notificationEvents: "none", notificationDeliveries: "none" }, integrationStatus: { githubApp: null, googleChat: { ready: false, webhookConfigured: false, apiConfigured: false, deliveryEnabled: false, mode: "not-configured" }, mentionTeam: { state: "fallback", githubHandle: "", profilesWithoutGitHubLogin: 0 }, pendingDeliveries: 0, failedDeliveries: 0 } };
    }
    function enforceExpiry() {
        const actorRole = options.actorRole?.();
        if (authority.capabilities.ceoGovernance && actorRole && actorRole !== "ceo") {
            authority = { ...authority, capabilities: { ...authority.capabilities, ceoGovernance: false, manageAdministratorEligibility: technical() } };
            epoch++;
            sequence++;
            if (!mayRead()) {
                model = null;
                readStatus = "forbidden";
            }
            options.changed();
        }
        if (authority.capabilities.technicalAdministration && !technical()) {
            authority = { ...authority, administratorAccess: { ...authority.administratorAccess, active: false, expiresAt: null }, capabilities: { ...authority.capabilities, technicalAdministration: false, operationalCorrection: false, manageAdministratorEligibility: authority.capabilities.ceoGovernance } };
            epoch++;
            sequence++;
            revokeTechnical();
            model = mayRead() && model ? reduced(model) : null;
            readStatus = mayRead() && model ? "stale" : "forbidden";
            options.changed();
        }
    }
    function schedule() {
        if (expiry)
            clearTimeout(expiry);
        if (technical()) {
            expiry = setTimeout(enforceExpiry, Math.max(0, Date.parse(authority.administratorAccess.expiresAt!) - options.now()));
            expiry.unref?.();
        }
    }
    schedule();
    function bindAuthority(next: AuthorityProjection) {
        enforceExpiry();
        const signature = JSON.stringify(next);
        if (signature === boundSignature)
            return;
        boundSignature = signature;
        const previousTechnical = technical();
        authority = structuredClone(next);
        eligibilityDenied = false;
        epoch++;
        sequence++;
        if (previousTechnical && !technical())
            revokeTechnical();
        enforceExpiry();
        if (!mayRead()) {
            model = null;
            readStatus = "forbidden";
        }
        else if (!technical() && model) {
            model = reduced(model);
            readStatus = "stale";
        }
        schedule();
        options.changed();
    }
    async function load() {
        enforceExpiry();
        if (!mayRead() || !options.read) {
            readStatus = mayRead() ? "unavailable" : "forbidden";
            options.changed();
            return false;
        }
        const generation = options.generation(), startedEpoch = epoch, token = ++sequence, full = technical(), started = options.nextSequence();
        readStatus = "loading";
        options.changed();
        try {
            const incoming = await options.read();
            enforceExpiry();
            if (!options.active() || generation !== options.generation() || startedEpoch !== epoch || token !== sequence)
                return false;
            if (!incoming.capabilities.manageAdministratorEligibility) {
                eligibilityDenied = true;
                revokeTechnical();
                model = null;
                readStatus = "forbidden";
                epoch++;
                options.changed();
                return false;
            }
            if (!incoming.capabilities.technicalAdministration && full) {
                authority = { ...authority, capabilities: { ...authority.capabilities, technicalAdministration: false, operationalCorrection: false, manageAdministratorEligibility: authority.capabilities.ceoGovernance } };
                epoch++;
                revokeTechnical();
            }
            const previous = model;
            const people = incoming.people.map(person => {
                const before = previous?.people.find(row => row.id === person.id);
                if (!before)
                    return person;
                return { ...person,
                    ...((technicalStamps.get(person.id) || 0) > started ? { githubLogin: before.githubLogin, googleChatUserId: before.googleChatUserId, googleChatDmSpace: before.googleChatDmSpace, technicalBasis: before.technicalBasis, googleChatReady: before.googleChatReady, githubConnection: before.githubConnection } : {}),
                    ...((eligibilityStamps.get(person.id) || 0) > started ? { administratorAccess: before.administratorAccess } : {}),
                };
            });
            if (incoming.coverage?.people !== "complete")
                for (const person of previous?.people || [])
                    if (!people.some(row => row.id === person.id))
                        people.push(person);
            options.acceptCommonPeople(people.filter(person => incoming.people.some(actual => actual.id === person.id)).map(person => ({ id: person.id, name: person.name, platformRole: person.platformRole, orgRole: person.orgRole, ...(full && incoming.capabilities.technicalAdministration ? { githubLogin: person.githubLogin } : {}) })), started);
            const covered = { ...incoming, people };
            model = full && incoming.capabilities.technicalAdministration ? structuredClone(covered) : reduced(covered);
            readStatus = "current";
            options.changed();
            return true;
        }
        catch (error) {
            enforceExpiry();
            if (!options.active() || generation !== options.generation() || startedEpoch !== epoch || token !== sequence)
                return false;
            const failure = error as {
                status?: number;
                code?: string;
            };
            if (failure.status === 401 || failure.status === 403 || failure.code === "administrator_access_required" || failure.code === "administrator_access_expired") {
                if (failure.status === 401 || failure.status === 403 && !["administrator_access_required", "administrator_access_expired"].includes(failure.code || ""))
                    eligibilityDenied = true;
                revokeTechnical();
                epoch++;
                authority = { ...authority, administratorAccess: inactiveAdministratorAccess, capabilities: { ...inactive.capabilities, ceoGovernance: authority.capabilities.ceoGovernance, manageAdministratorEligibility: authority.capabilities.ceoGovernance } };
                model = null;
                readStatus = "forbidden";
            }
            else
                readStatus = "unavailable";
            options.changed();
            return false;
        }
    }
    function projectPerson(person: AdministrationProfile): AdministrationProfile {
        const profile = options.profiles().find(profile => profile.id === person.id);
        if (!profile)
            return person;
        const githubLogin = technical() ? profile.githubLogin : person.githubLogin;
        const technicalBasis = person.technicalBasis && (person.technicalBasis.githubLogin || "") === githubLogin ? person.technicalBasis : undefined;
        return { ...person, name: profile.name, platformRole: profile.platformRole, orgRole: profile.orgRole, githubLogin, technicalBasis };
    }
    function current(id: string) { const person = model?.people.find(person => person.id === id); return person ? projectPerson(person) : null; }
    function begin(shown: AdministrationProfile): AdministrationPersonEditor {
        let basis = structuredClone(shown);
        const generation = options.generation(), key = Symbol(shown.id), audience = eligibilityAudience();
        let closed = false, technicalEnded = false;
        let acknowledgedTechnical: PersonAdministrationPatch["technicalIdentity"] | null = null;
        let technicalBasisPending = false;
        let view: AdministrationPersonEditView = { profileId: shown.id, phase: "editing", submitted: null, technical: { phase: "not-needed", error: "" }, eligibility: { phase: "not-needed", error: "" }, error: "", readStatus, serverPerson: null, canResave: false };
        const active = () => { enforceExpiry(); return options.active() && generation === options.generation() && mayRead() && audience === eligibilityAudience(); };
        const changed = () => options.changed();
        const updatePerson = (patch: Partial<AdministrationProfile>) => { if (model)
            model = { ...model, people: model.people.map(person => person.id === shown.id ? { ...person, ...patch } : person) }; };
        async function save(input: PersonAdministrationPatch): Promise<AdministrationPersonResult> {
            if (closed || technicalEnded || !active())
                return { ok: false, kind: "sessionSuperseded", error: "Der Administrationszugang wurde beendet." };
            if (["saving", "unconfirmed", "conflict"].includes(view.phase))
                return { ok: false, kind: view.phase === "conflict" ? "versionConflict" : "unconfirmed", error: view.error || "Eine vorherige Speicherung ist noch nicht bestätigt." };
            if ([...editors.values()].some(entry => entry.editor !== editor && entry.id === shown.id && ["saving", "unconfirmed", "conflict"].includes(entry.editor.view().phase))) {
                view = { ...view, phase: "blocked", submitted: structuredClone(input) };
                changed();
                return { ok: false, kind: "unconfirmed", error: "Eine vorherige Speicherung derselben Person ist offen." };
            }
            const requestedTechnicalChanged = (["githubLogin", "googleChatUserId", "googleChatDmSpace"] as const).some(field => basis[field] !== input.technicalIdentity[field]);
            const repeatsAcknowledged = Boolean(acknowledgedTechnical && JSON.stringify(acknowledgedTechnical) === JSON.stringify(input.technicalIdentity));
            const technicalChanged = requestedTechnicalChanged && !repeatsAcknowledged;
            if (technicalChanged && technicalBasisPending) {
                view = { ...view, phase: "conflict", submitted: structuredClone(input), error: "Die erste technische Speicherung ist bestätigt. Vor einer weiteren technischen Änderung muss der aktuelle Stand verglichen werden." };
                changed();
                return { ok: false, kind: "versionConflict", error: view.error };
            }
            const eligibilityChanged = basis.administratorAccess.eligible !== input.eligible;
            if (technicalChanged && !technical())
                return { ok: false, kind: "rejected", error: "Ein aktiver Adminzugang ist erforderlich." };
            if (technicalChanged && !basis.technicalBasis) {
                view = { ...view, phase: "conflict", submitted: structuredClone(input), error: "Die vollständige technische Bearbeitungsbasis muss zuerst verglichen werden." };
                changed();
                return { ok: false, kind: "versionConflict", error: view.error };
            }
            const latest = current(shown.id);
            if (!latest)
                return { ok: false, kind: "rejected", error: "Die Person ist nicht mehr verfügbar." };
            if (technicalChanged && !sameTechnicalBasis(latest.technicalBasis, basis.technicalBasis) || eligibilityChanged && latest.administratorAccess.eligible !== basis.administratorAccess.eligible) {
                view = { ...view, phase: "conflict", submitted: structuredClone(input), error: "Die Person wurde zwischenzeitlich geändert. Deine Eingaben bleiben erhalten." };
                changed();
                return { ok: false, kind: "versionConflict", error: view.error };
            }
            if (!technicalChanged && !eligibilityChanged)
                return { ok: true };
            const technicalEpoch = epoch;
            sequence++;
            view = { ...view, phase: "saving", submitted: structuredClone(input), error: "", technical: { phase: technicalChanged ? "saving" : view.technical.phase === "confirmed" ? "confirmed" : "not-needed", error: "" }, eligibility: { phase: eligibilityChanged ? "saving" : "not-needed", error: "" } };
            changed();
            let step: "technical" | "eligibility" = "technical";
            try {
                if (technicalChanged) {
                    if (!basis.technicalBasis)
                        throw Object.assign(new Error("Die ursprüngliche technische Basis fehlt. Bitte vergleichen."), { status: 400 });
                    if (!options.adapter.saveAdministrationTechnical)
                        throw Object.assign(new Error("Technische Identität ist nicht verfügbar."), { status: 400 });
                    const result = await options.adapter.saveAdministrationTechnical(shown.id, input.technicalIdentity, basis.technicalBasis);
                    if (!active() || technicalEnded || !technical() || technicalEpoch !== epoch)
                        return { ok: false, kind: "sessionSuperseded", error: "Der technische Adminzugang wurde beendet." };
                    if (result.profile) {
                        if (result.profile.id !== shown.id)
                            throw new Error("Technische Identität noch nicht bestätigt.");
                        const { id, ...actual } = result.profile;
                        const patch = { githubLogin: actual.githubLogin || "", googleChatUserId: actual.googleChatUserId || "", googleChatDmSpace: actual.googleChatDmSpace || "", technicalBasis: actual };
                        const currentBasis = current(id)?.technicalBasis;
                        // An own receipt advances its editor, but cannot replace a foreign accepted tuple.
                        if (sameTechnicalBasis(currentBasis, basis.technicalBasis) || sameTechnicalBasis(currentBasis, actual)) {
                            updatePerson(patch);
                            technicalStamps.set(id, options.nextSequence());
                            options.acceptCommonPeople([{ id, githubLogin: patch.githubLogin }], options.nextSequence());
                        }
                        basis = { ...basis, ...patch };
                    }
                    acknowledgedTechnical = structuredClone(input.technicalIdentity);
                    technicalBasisPending = !result.profile;
                    view = { ...view, technical: { phase: "confirmed", error: "" } };
                    readStatus = "stale";
                    changed();
                }
                step = "eligibility";
                if (eligibilityChanged) {
                    if (!active() || !authority.capabilities.manageAdministratorEligibility)
                        throw Object.assign(new Error("Adminberechtigung kann nicht mehr geändert werden."), { status: 403 });
                    if (!options.adapter.saveAdministrationEligibility)
                        throw Object.assign(new Error("Adminberechtigung ist nicht verfügbar."), { status: 400 });
                    const eligibilityScope = eligibilityAudience();
                    const saved = await options.adapter.saveAdministrationEligibility(shown.id, input.eligible, basis.administratorAccess.eligible);
                    if (!active() || eligibilityScope !== eligibilityAudience())
                        return { ok: false, kind: "sessionSuperseded", error: "Der Administrationszugang wurde beendet." };
                    if (saved.profileId !== shown.id || typeof saved.eligible !== "boolean")
                        throw new Error("Adminberechtigung noch nicht bestätigt.");
                    const { profileId, ...access } = saved;
                    updatePerson({ administratorAccess: access });
                    basis = { ...basis, administratorAccess: access };
                    eligibilityStamps.set(profileId, options.nextSequence());
                    view = { ...view, eligibility: { phase: "confirmed", error: "" } };
                    changed();
                }
                view = { ...view, phase: "saved" };
                await load();
                if (active()) {
                    view = { ...view, readStatus };
                    changed();
                }
                return { ok: true };
            }
            catch (error) {
                if (!active())
                    return { ok: false, kind: "sessionSuperseded", error: "Der Administrationszugang wurde beendet." };
                const failure = error as {
                    status?: number;
                    code?: string;
                };
                const conflict = ["administration_technical_conflict", "administration_eligibility_conflict"].includes(failure.code || "");
                const unknown = !conflict && (!failure.status || failure.status >= 500 || failure.code === "session_superseded");
                const message = error instanceof Error ? error.message : "Personenzugang konnte nicht gespeichert werden.";
                view = { ...view, [step]: { phase: unknown ? "unconfirmed" : "rejected", error: message }, phase: conflict ? "conflict" : unknown ? "unconfirmed" : view.technical.phase === "confirmed" ? "partial" : "rejected", error: message };
                if (step === "technical")
                    view = { ...view, eligibility: { phase: "not-needed", error: "" } };
                if (failure.status === 401 || failure.status === 403 || failure.code === "administrator_access_expired" || failure.code === "administrator_access_required") {
                    if (failure.status === 401 || failure.status === 403 && !["administrator_access_required", "administrator_access_expired"].includes(failure.code || ""))
                        eligibilityDenied = true;
                    revokeTechnical();
                    authority = { ...authority, administratorAccess: inactiveAdministratorAccess, capabilities: { ...inactive.capabilities, ceoGovernance: authority.capabilities.ceoGovernance, manageAdministratorEligibility: authority.capabilities.ceoGovernance } };
                    epoch++;
                    sequence++;
                    model = null;
                    readStatus = "forbidden";
                }
                changed();
                if (!unknown)
                    await load();
                if (active()) {
                    view = { ...view, readStatus };
                    changed();
                }
                return { ok: false, kind: conflict ? "versionConflict" : failure.code === "session_superseded" ? "sessionSuperseded" : unknown ? "unconfirmed" : view.technical.phase === "confirmed" ? "partial" : "rejected", error: message };
            }
        }
        const editor: AdministrationPersonEditor = { view() { if (technicalEnded || !active() || !technical() && ["saving", "unconfirmed"].includes(view.technical.phase))
                return { ...view, phase: "ended", submitted: null, serverPerson: null, error: "", technical: { ...view.technical, error: "" }, eligibility: { ...view.eligibility, error: "" }, canResave: false }; const shownView = structuredClone(view); if (!technical()) {
                if (shownView.submitted)
                    shownView.submitted = { eligible: shownView.submitted.eligible, technicalIdentity: { githubLogin: "", googleChatUserId: "", googleChatDmSpace: "" } };
                shownView.serverPerson = shownView.serverPerson ? reduced({ ...model!, people: [shownView.serverPerson] }).people[0] : null;
                const needsTechnical = Boolean(shownView.submitted && (["githubLogin", "googleChatUserId", "googleChatDmSpace"] as const).some(field => shownView.submitted!.technicalIdentity[field] !== basis[field]));
                shownView.canResave = shownView.canResave && !needsTechnical;
                shownView.technical.error = "";
            } return shownView; }, save, async checkOutcome() {
                if (!active() || technicalEnded)
                    return false;
                const ok = await load();
                if (active()) {
                    const blocked = view.phase === "blocked" && ![...editors.values()].some(entry => entry.editor !== editor && entry.id === shown.id && ["saving", "unconfirmed", "conflict"].includes(entry.editor.view().phase));
                    view = { ...view, ...(blocked ? { phase: "editing" as const, error: "" } : {}), readStatus, serverPerson: current(shown.id) };
                    changed();
                }
                return ok;
            }, async refreshConflict() { if (view.phase !== "conflict" || technicalEnded || !active())
                return false; const ok = await load(); const actual = current(shown.id); const needsTechnical = Boolean(view.submitted && (["githubLogin", "googleChatUserId", "googleChatDmSpace"] as const).some(field => view.submitted!.technicalIdentity[field] !== basis[field])); const complete = model?.coverage?.people === "complete" && (!needsTechnical || technical() && Boolean(actual?.technicalBasis)); view = { ...view, readStatus, serverPerson: ok && complete && actual ? structuredClone(actual) : null, canResave: Boolean(ok && complete && actual) }; changed(); return view.canResave; }, resave(patch) { if (!view.canResave || !view.serverPerson)
                return Promise.resolve({ ok: false, kind: "rejected", error: "Bitte zuerst den aktuellen Serverstand vergleichen." }); basis = structuredClone(view.serverPerson); technicalBasisPending = false; acknowledgedTechnical = null; view = { ...view, phase: "editing", canResave: false, serverPerson: null }; return save(patch); }, close() { if (!view.submitted) {
                closed = true;
                editors.delete(key);
            } } };
        editors.set(key, { id: shown.id, editor, revokeTechnical() {
                technicalEnded ||= ["saving", "unconfirmed"].includes(view.technical.phase) || Boolean(view.submitted && (["githubLogin", "googleChatUserId", "googleChatDmSpace"] as const).some(field => view.submitted!.technicalIdentity[field] !== basis[field]));
                basis = { ...basis, githubLogin: "", googleChatUserId: "", googleChatDmSpace: "", technicalBasis: undefined, githubConnection: null };
                acknowledgedTechnical = null;
                technicalBasisPending = true;
                view = { ...view, submitted: view.submitted ? { eligible: view.submitted.eligible, technicalIdentity: { githubLogin: "", googleChatUserId: "", googleChatDmSpace: "" } } : null, serverPerson: null, canResave: false };
            } });
        return editor;
    }
    return { bindAuthority, load, begin, views: (id: string) => options.active() ? [...editors.values()].filter(entry => entry.id === id).map(entry => entry.editor.view()) : [], resume: (id: string) => [...editors.values()].findLast(entry => entry.id === id && entry.editor.view().submitted)?.editor || null,
        view(): AdministrationStateView {
            enforceExpiry();
            let shown = mayRead() && model ? technical() ? model : reduced(model) : null;
            const commonStale = Boolean(shown && technical() && shown.people.some(person => projectPerson(person).githubLogin !== person.githubLogin));
            if (shown)
                shown = { ...shown, people: shown.people.map(projectPerson) };
            if (shown)
                for (const entry of editors.values()) {
                    const view = entry.editor.view();
                    if (view.submitted && ["saving", "unconfirmed"].includes(view.phase))
                        shown = { ...shown, people: shown.people.map(person => person.id !== entry.id ? person : { ...person, ...(technical() && ["saving", "unconfirmed"].includes(view.technical.phase) ? view.submitted!.technicalIdentity : {}), ...(["saving", "unconfirmed"].includes(view.eligibility.phase) ? { administratorAccess: { ...person.administratorAccess, eligible: view.submitted!.eligible } } : {}) }) };
                }
            return { model: shown ? structuredClone(shown) : null, readStatus: options.active() ? commonStale && readStatus === "current" ? "stale" : readStatus : "forbidden", coverage: shown?.coverage || (shown ? { ...none, technical: technical() } : none) };
        },
        clear() { if (expiry)
            clearTimeout(expiry); authority = inactive; boundSignature = JSON.stringify(inactive); eligibilityDenied = false; model = null; editors.clear(); technicalStamps.clear(); eligibilityStamps.clear(); epoch++; sequence++; readStatus = "not-loaded"; },
    };
}
