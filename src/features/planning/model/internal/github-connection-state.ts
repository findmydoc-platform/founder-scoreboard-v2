import type { GitHubConnectionSnapshot, GitHubConnectionView } from "@/features/tasks/model/task-github-sync-state";
const empty: GitHubConnectionView = { installationAvailable: false, userConnected: false, state: "unknown", waitingCommentCount: null, readStatus: "not-loaded" };
export function createGitHubConnectionState(options: {
    active(): boolean;
    generation(): number;
    changed(): void;
    endSession(): void;
    read?: () => Promise<GitHubConnectionSnapshot>;
}) {
    let value = empty;
    let sequence = 0;
    let inFlight: Promise<boolean> | null = null;
    let reloadAfterFlight = false;
    const load = (): Promise<boolean> => {
        if (!options.active() || !options.read)
            return Promise.resolve(false);
        if (inFlight)
            return inFlight;
        if (value.readStatus === "current")
            return Promise.resolve(true);
        const generation = options.generation(), started = ++sequence;
        value = { ...value, readStatus: "loading" };
        options.changed();
        const reading = (async () => {
            try {
                const result = await options.read!();
                if (!options.active() || generation !== options.generation() || started !== sequence)
                    return false;
                value = { ...result, waitingCommentCount: Number.isSafeInteger(result.waitingCommentCount) && result.waitingCommentCount! >= 0 ? result.waitingCommentCount : null, readStatus: "current" };
                options.changed();
                return true;
            }
            catch (error) {
                if (!options.active() || generation !== options.generation() || started !== sequence)
                    return false;
                const failure = error && typeof error === "object" ? error as {
                    status?: number;
                    code?: string;
                } : {};
                if (failure.code === "session_superseded") {
                    options.endSession();
                    return false;
                }
                const status = failure.status;
                value = { ...empty, readStatus: status === 401 || status === 403 ? "forbidden" : "unavailable" };
                options.changed();
                return false;
            }
        })();
        inFlight = reading;
        void reading.finally(() => {
            if (inFlight !== reading)
                return;
            inFlight = null;
            if (reloadAfterFlight) {
                reloadAfterFlight = false;
                void load();
            }
        });
        return reading;
    };
    return {
        load,
        view: () => options.active() ? { ...value } : { ...empty },
        invalidate() {
            if (!options.active() || value.readStatus === "not-loaded" || value.readStatus === "forbidden")
                return;
            value = { ...value, waitingCommentCount: null, readStatus: "stale" };
            if (inFlight) {
                sequence++;
                reloadAfterFlight = true;
                options.changed();
            }
            else
                void load();
        },
        clear() { sequence++; inFlight = null; reloadAfterFlight = false; value = empty; },
    };
}
