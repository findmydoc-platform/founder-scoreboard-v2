import type { TeamPlanningItemTokenRecord } from "@/features/planning-items/model/planning-items-contract";
import type { ProfileApiTokenAdapter, ProfileApiTokenDraft, ProfileApiTokenIssueResult, ProfileApiTokenOperation, ProfileApiTokensView } from "@/features/profile/model/profile-api-token-state";
import type { ProfileSettingsResult } from "@/features/profile/model/profile-settings-contract";
import type { PlanningReadStatus } from "../planning-state";

export function createProfileApiTokensState(context: { active(): boolean; generation(): number; changed(): void; adapter: ProfileApiTokenAdapter }) {
  let tokens: TeamPlanningItemTokenRecord[] = [];
  let canIssueEmptyEpicDeletes = false;
  let readStatus: PlanningReadStatus = "not-loaded";
  let denied = false;
  let sequence = 0;
  let acceptedRead = 0;
  let confirmedAt = 0;
  let loading: Promise<boolean> | undefined;
  const operations: ProfileApiTokenOperation[] = [];
  let snapshot: ProfileApiTokensView | undefined;
  function changed() { snapshot = undefined; context.changed(); }
  function view(): ProfileApiTokensView {
    const active = context.active();
    return snapshot ||= { tokens: active && !denied ? tokens : [], canIssueEmptyEpicDeletes: active && !denied && canIssueEmptyEpicDeletes, readStatus: active ? denied ? "forbidden" : readStatus : "not-loaded", operations: active && !denied ? operations.map(operation => ({ ...operation, submitted: operation.submitted ? { ...operation.submitted } : undefined })) : [] };
  }
  function load() {
    if (!context.active() || !context.adapter.readProfileApiTokens) return Promise.resolve(false);
    if (loading) return loading;
    const generation = context.generation();
    const started = ++sequence;
    acceptedRead = started;
    readStatus = "loading";
    changed();
    const read = context.adapter.readProfileApiTokens;
    loading = (async () => {
      try {
        const result = await read();
        if (!context.active() || context.generation() !== generation || started !== acceptedRead) return false;
        if (started >= confirmedAt) { tokens = result.tokens; canIssueEmptyEpicDeletes = result.canIssueEmptyEpicDeletes; readStatus = "current"; }
        else readStatus = "stale";
        denied = false;
        changed();
        return true;
      } catch (error) {
        if (!context.active() || context.generation() !== generation || started !== acceptedRead) return false;
        const status = error && typeof error === "object" ? (error as { status?: number }).status : undefined;
        if (status === 401 || status === 403) denied = true;
        readStatus = denied ? "forbidden" : "unavailable";
        changed();
        return false;
      } finally { if (context.generation() === generation) loading = undefined; }
    })();
    return loading;
  }
  function failure(error: unknown): Exclude<ProfileSettingsResult, { ok: true }> {
    const { status, code } = error && typeof error === "object" ? error as { status?: number; code?: string } : {};
    return { ok: false, kind: code === "session_superseded" ? "sessionSuperseded" : status && status >= 400 && status < 500 ? "rejected" : "unconfirmed", error: error instanceof Error ? error.message : "Die Token-Aktion ist noch nicht bestätigt.", status, code };
  }
  async function issue(draft: ProfileApiTokenDraft): Promise<ProfileApiTokenIssueResult> {
    if (!context.active()) return { ok: false, kind: "sessionSuperseded", error: "Die Sitzung wurde ersetzt." };
    if (denied) return { ok: false, kind: "rejected", status: 403, error: "API-Tokens sind nicht verfügbar." };
    if (operations.some(item => item.action === "issue" && (item.phase === "saving" || item.phase === "unconfirmed"))) return { ok: false, kind: "unconfirmed", error: "Die vorherige Token-Erstellung ist noch nicht bestätigt. Prüfe zuerst die Token-Liste." };
    const generation = context.generation();
    const operation: ProfileApiTokenOperation = { action: "issue", submitted: { ...draft }, phase: "saving", error: "" };
    operations.push(operation);
    changed();
    try {
      if (!context.adapter.issueProfileApiToken) throw new Error("Token-Erstellung ist nicht verfügbar.");
      const result = await context.adapter.issueProfileApiToken(draft);
      if (!context.active() || context.generation() !== generation) return { ok: false, kind: "sessionSuperseded", error: "Die Sitzung wurde ersetzt." };
      if (!result.token || !result.tokenRecord) throw new Error("Die Token-Erstellung ist noch nicht bestätigt.");
      tokens = [result.tokenRecord, ...tokens.filter(token => token.id !== result.tokenRecord.id)];
      confirmedAt = ++sequence;
      operation.phase = "saved";
      changed();
      if (denied) return { ok: false, kind: "rejected", status: 403, error: "Der Token wurde erstellt. Der Zugriff auf die einmalige Anzeige ist nicht mehr freigegeben." };
      return { ok: true, token: result.token };
    } catch (error) {
      if (!context.active() || context.generation() !== generation) return { ok: false, kind: "sessionSuperseded", error: "Die Sitzung wurde ersetzt." };
      const result = failure(error);
      operation.phase = result.kind === "rejected" ? "rejected" : "unconfirmed";
      operation.error = result.error;
      changed();
      if (result.kind === "unconfirmed") void load();
      return result;
    }
  }
  async function revoke(tokenId: string): Promise<ProfileSettingsResult> {
    if (!context.active()) return { ok: false, kind: "sessionSuperseded", error: "Die Sitzung wurde ersetzt." };
    if (denied) return { ok: false, kind: "rejected", status: 403, error: "API-Tokens sind nicht verfügbar." };
    if (operations.some(item => item.tokenId === tokenId && (item.phase === "saving" || item.phase === "unconfirmed"))) return { ok: false, kind: "unconfirmed", error: "Der vorherige Widerruf ist noch nicht bestätigt." };
    const generation = context.generation();
    const operation: ProfileApiTokenOperation = { action: "revoke", tokenId, phase: "saving", error: "" };
    operations.push(operation);
    changed();
    try {
      if (!context.adapter.revokeProfileApiToken) throw new Error("Token-Widerruf ist nicht verfügbar.");
      await context.adapter.revokeProfileApiToken(tokenId);
      if (!context.active() || context.generation() !== generation) return { ok: false, kind: "sessionSuperseded", error: "Die Sitzung wurde ersetzt." };
      tokens = tokens.filter(token => token.id !== tokenId);
      confirmedAt = ++sequence;
      operation.phase = "saved";
      readStatus = "stale";
      changed();
      void load();
      return { ok: true };
    } catch (error) {
      if (!context.active() || context.generation() !== generation) return { ok: false, kind: "sessionSuperseded", error: "Die Sitzung wurde ersetzt." };
      const result = failure(error);
      operation.phase = result.kind === "rejected" ? "rejected" : "unconfirmed";
      operation.error = result.error;
      changed();
      if (result.kind === "unconfirmed") void load();
      return result;
    }
  }
  return { view, load, issue, revoke, clear() { snapshot = undefined; tokens = []; operations.length = 0; canIssueEmptyEpicDeletes = false; denied = false; readStatus = "not-loaded"; loading = undefined; sequence++; acceptedRead = sequence; } };
}
