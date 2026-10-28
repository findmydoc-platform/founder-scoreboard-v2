import type { AdministrationDeliveryAdapter, AdministrationDeliverySelection, AdministrationDeliveryView } from "@/features/administration/model/administration-delivery-state";
export function createAdministrationDeliveryState(options: {
    deny(status: number, code?: string): void;
    invalidate(): void;
    refreshAffected(): Promise<void>;
    active(): boolean;
    epoch(): number;
    generation(): number;
    changed(): void;
    read(): Promise<boolean>;
    readStatus(): import("../planning-state").PlanningReadStatus;
    adapter: AdministrationDeliveryAdapter;
}) {
    const withheld = (view: AdministrationDeliveryView): AdministrationDeliveryView => ({ ...view, phase: "ended", selection: null, results: [], sent: null, failed: null, skipped: null, error: "", readStatus: "forbidden", checking: false });
    const operations = new Map<string, {
        view: AdministrationDeliveryView;
        active(): boolean;
    }>();
    let sequence = 0;
    function overlaps(first: AdministrationDeliverySelection, second: AdministrationDeliverySelection) {
        if (first.kind === "pending" || second.kind === "pending")
            return true;
        if (first.kind === "events" && second.kind === "events")
            return first.eventIds.some(id => second.eventIds.includes(id));
        return first.kind === second.kind && (first.kind !== "direct-message-test" || second.kind !== "direct-message-test" || first.profileId === second.profileId);
    }
    function pending(selection: AdministrationDeliverySelection) { return [...operations.values()].find(entry => entry.active() && ["saving", "unconfirmed"].includes(entry.view.phase) && entry.view.selection && overlaps(selection, entry.view.selection)); }
    async function run(input: AdministrationDeliverySelection): Promise<AdministrationDeliveryView> {
        const selection = structuredClone(input), previous = pending(selection);
        if (previous)
            return structuredClone(previous.view);
        const id = `delivery:${++sequence}`, epoch = options.epoch(), generation = options.generation();
        const active = () => options.active() && epoch === options.epoch() && generation === options.generation();
        const entry = { active, view: { id, selection: structuredClone(selection), phase: "saving", sent: null, failed: null, skipped: null, results: [], error: "", readStatus: "stale", checking: false } as AdministrationDeliveryView };
        operations.set(id, entry);
        options.changed();
        if (!active())
            return withheld(entry.view);
        options.invalidate();
        try {
            if (!options.adapter.executeAdministrationDelivery)
                throw Object.assign(new Error("Zustellung ist nicht verfügbar."), { status: 400 });
            const response = await options.adapter.executeAdministrationDelivery(selection);
            if (response.status === 401 || response.status === 403)
                options.deny(response.status, response.code);
            if (!active())
                return withheld(entry.view);
            const complete = Array.isArray(response.results) && [response.sent, response.failed, response.skipped].every(count => Number.isInteger(count) && Number(count) >= 0) && (response.sent! + response.failed! + response.skipped!) === response.results.length && new Set(response.results.map(item => item.eventId)).size === response.results.length && response.results.every(item => Number.isInteger(item.eventId) && item.eventId > 0 && ["sent", "failed", "skipped"].includes(item.status) && (selection.kind !== "events" || selection.eventIds.includes(item.eventId))) && ["sent", "failed", "skipped"].every(status => response.results!.filter(item => item.status === status).length === response[status as "sent" | "failed" | "skipped"]);
            if (!complete) {
                entry.view = { ...entry.view, phase: !response.ok && [400, 401, 403, 404, 422, 424].includes(response.status) ? "rejected" : "unconfirmed", error: response.error || "Das Zustellergebnis ist noch nicht bestätigt." };
                options.changed();
                return structuredClone(entry.view);
            }
            entry.view = { ...entry.view, phase: response.failed || !response.ok ? "partial" : "reported", readStatus: "loading", sent: response.sent!, failed: response.failed!, skipped: response.skipped!, results: response.results!.map(item => ({ eventId: item.eventId, status: item.status, ...(item.error ? { error: item.error } : {}) })), error: response.error || "" };
            options.changed();
            options.invalidate();
            let readFailed = false;
            try {
                await Promise.all([options.read(), options.refreshAffected()]);
            }
            catch {
                readFailed = true;
            }
            if (!active())
                return withheld(entry.view);
            if (active()) {
                entry.view = { ...entry.view, readStatus: readFailed ? "unavailable" : options.readStatus() };
                options.changed();
            }
            return structuredClone(entry.view);
        }
        catch (error) {
            const failure = error as {
                status?: number;
                code?: string;
            };
            if (failure.status === 401 || failure.status === 403)
                options.deny(failure.status, failure.code);
            if (!active())
                return withheld(entry.view);
            const status = (error as {
                status?: number;
            }).status;
            entry.view = { ...entry.view, phase: status && [400, 401, 403, 404, 422, 424].includes(status) ? "rejected" : "unconfirmed", error: error instanceof Error ? error.message : "Zustellung fehlgeschlagen." };
            options.changed();
            return structuredClone(entry.view);
        }
    }
    return { run, views: () => [...operations.values()].map(entry => entry.active() ? structuredClone(entry.view) : withheld(entry.view)), async check(id: string) {
            const entry = operations.get(id);
            if (!entry || !entry.active())
                return false;
            entry.view = { ...entry.view, checking: true };
            options.changed();
            options.invalidate();
            const [ok] = await Promise.all([options.read(), options.refreshAffected()]);
            if (!entry.active())
                return false;
            entry.view = { ...entry.view, checking: false, readStatus: options.readStatus() };
            options.changed();
            return ok;
        }, availability: (selection: AdministrationDeliverySelection) => !options.active() ? "forbidden" as const : pending(selection) ? "pending" as const : "available" as const, clear() { operations.clear(); } };
}
