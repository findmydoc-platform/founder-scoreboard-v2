import type { FmdTool, PlanningHeaderData, PlanningShellState } from "@/lib/types";
import type { PlanningReadStatus } from "../planning-state";
import type { FmdToolDraft } from "@/features/tools/model/fmd-tools";
import { fmdToolCategoryLabel, fmdToolStatusFromUrl, sortFmdTools } from "@/features/tools/model/fmd-tools";
import { isProtectedToolPreviewUrl } from "@/lib/tool-preview-image";
import type { PlanningToolsState, ToolConfirmation, ToolOperation, ToolPreviewResult, ToolPreviewView, ToolRead, ToolResult, ToolsAdapter } from "@/features/tools/model/tool-state";
function httpUrl(value: string) { try { return ["http:", "https:"].includes(new URL(value).protocol); } catch { return false; } }
function normalize(draft: FmdToolDraft) {
  const name = draft.name.trim(), description = draft.description.trim(), url = draft.url.trim(), previewImageUrl = draft.previewImageUrl.trim();
  if (name.length < 2) throw new Error("Name ist erforderlich.");
  if (description.length < 8) throw new Error("Beschreibung muss mindestens 8 Zeichen haben.");
  if (url && !httpUrl(url)) throw new Error("Link muss mit http:// oder https:// beginnen.");
  if (previewImageUrl && !isProtectedToolPreviewUrl(previewImageUrl) && !httpUrl(previewImageUrl)) throw new Error("Vorschaubild muss mit http:// oder https:// beginnen.");
  return { name, category: draft.category, kind: fmdToolCategoryLabel(draft.category), description, url, owner: draft.owner.trim() || "Team", status: fmdToolStatusFromUrl(url), isCurated: Boolean(draft.isCurated && url), previewImageUrl, previewImageSource: previewImageUrl ? draft.previewImageSource : "none" as const };
}
function quickLinksIdentity(tools: readonly FmdTool[]) {
  return JSON.stringify(tools.filter(tool => tool.isCurated && tool.url).map(({ id, name, category, url, previewImageUrl }) => ({ id, name, category, url, previewImageUrl })).sort((a, b) => a.id.localeCompare(b.id)));
}
function affectsQuickLinks(before: FmdTool | undefined, after: FmdTool) { return quickLinksIdentity(before ? [before] : []) !== quickLinksIdentity([after]); }
function statusCode(error: unknown) { return (error as { status?: number })?.status; }
export function createToolsState(options: { initial: readonly FmdTool[]; loaded: boolean; adapter: ToolsAdapter; active: () => boolean; generation: () => number; changed: () => void; endSession: () => void; invalidateQuickLinks: () => void; beginHeaderRead: () => number; acceptHeaderRead: (data: PlanningHeaderData, started: number) => void; refreshWorkspace: () => Promise<boolean> }) {
  let records = [...options.initial], readStatus: PlanningReadStatus = options.loaded ? "current" : "not-loaded", completeness: "complete" | "partial" = "partial", sequence = 0, mutationBoundary = 0, acceptedReadAt = 0, completeReadAt = 0, authority = 0, denied = false, localId = 0;
  const receipts = new Map<string, { started: number; acceptedAt: number; basisVersion: string | undefined }>();
  const accepted = new Map<string, number>(), operations = new Map<string, ToolOperation>(), previews = new Map<string, ToolPreviewView>();
  let reading: { started: number; promise: Promise<boolean> } | undefined;
  function visible() {
    if (!options.active() || denied) return [];
    const tools = [...records];
    for (const operation of operations.values()) if (["saving", "unconfirmed"].includes(operation.phase)) {
      const index = tools.findIndex(tool => tool.id === operation.toolId), original = tools[index];
      const tool = { ...(original || { id: operation.toolId, sortOrder: Number.MAX_SAFE_INTEGER }), ...normalize(operation.draft), id: operation.toolId } as FmdTool;
      if (index >= 0) tools[index] = tool; else tools.push(tool);
    }
    return sortFmdTools(tools);
  }
  function beginRead() { readStatus = "loading"; return ++sequence; }
  function acceptRead(result: ToolRead, started: number, includesHeader = false) {
    if (started < acceptedReadAt) return false;
    const previous = quickLinksIdentity(records), incoming = new Map(result.tools.map(tool => [tool.id, tool])); let stale = false;
    const protectedTool = (id: string, incoming?: FmdTool) => {
      const own = receipts.get(id);
      const successor = incoming && own && own.acceptedAt === accepted.get(id) && started > own.started && incoming.updatedAt !== own.basisVersion;
      return (accepted.get(id) || 0) > started && !successor;
    };
    records = records.filter(tool => {
      if (protectedTool(tool.id, incoming.get(tool.id))) { stale = true; incoming.delete(tool.id); return true; }
      if (incoming.has(tool.id)) return false;
      if (result.completeness !== "complete") return true;
      accepted.set(tool.id, started); return false;
    });
    for (const tool of incoming.values()) if (!protectedTool(tool.id, tool)) { records.push(tool); accepted.set(tool.id, started); receipts.delete(tool.id); } else stale = true;
    acceptedReadAt = started; if (result.completeness === "complete") completeReadAt = started;
    denied = false; completeness = result.completeness; readStatus = stale ? "stale" : "current";
    if (!includesHeader && previous !== quickLinksIdentity(records)) options.invalidateQuickLinks(); return true;
  }
  function failed(error: unknown, started: number) {
    if (started < acceptedReadAt) return;
    readStatus = [401, 403].includes(statusCode(error) || 0) ? "forbidden" : "unavailable";
    if (readStatus === "forbidden") { denied = true; authority++; acceptedReadAt = ++sequence; records = []; completeness = "partial"; operations.clear(); previews.clear(); }
  }
  async function refresh() {
    if (!options.active()) return false;
    if (!options.adapter.readTools) return options.refreshWorkspace();
    if (reading && reading.started >= mutationBoundary) return reading.promise;
    const generation = options.generation(), started = beginRead(), headerRead = options.beginHeaderRead(); options.changed();
    const promise = (async () => {
      try {
        const result = await options.adapter.readTools!();
        if (!options.active() || generation !== options.generation()) return false;
        const hasHeader = result.headerData?.quickLinks.state === "ready" && result.headerData.quickLinks.freshness !== "stale";
        if (!acceptRead(result, started, hasHeader)) return false;
        if (result.headerData) options.acceptHeaderRead(result.headerData, headerRead);
        options.changed(); return true;
      } catch (error) { if (options.active() && generation === options.generation()) { failed(error, started); options.changed(); } return false; }
    })();
    reading = { started, promise }; void promise.finally(() => { if (reading?.promise === promise) reading = undefined; }); return promise;
  }
  async function save(id: string, draft: FmdToolDraft, basis?: FmdTool): Promise<ToolResult> {
    if (!options.active()) return { phase: "session-ended" };
    if (denied) return { phase: "rejected", error: "Links sind in dieser Sitzung nicht verfügbar. Lade zuerst den aktuellen Stand." };
    const previous = operations.get(id) || [...operations.values()].find(operation => basis && operation.toolId === basis.id && ["saving", "unconfirmed"].includes(operation.phase));
    if (previous && ["saving", "unconfirmed", "saved"].includes(previous.phase)) return { phase: previous.phase === "saved" ? "saved" : "unconfirmed", error: previous.error, warning: previous.warning };
    let prepared: ReturnType<typeof normalize>;
    try { prepared = normalize(draft); } catch (error) { return { phase: "rejected", error: (error as Error).message }; }
    const current = basis && records.find(tool => tool.id === basis.id);
    if (basis && (!basis.updatedAt || (current?.updatedAt && current.updatedAt !== basis.updatedAt))) {
      const error = "Der Link wurde geändert oder seine Ausgangsversion fehlt. Bitte den aktuellen Aktuellen Stand prüfen.";
      operations.set(id, { id, toolId: basis.id, draft: prepared, phase: "conflict", error, checking: false }); options.changed(); return { phase: "conflict", error };
    }
    const writer = basis ? options.adapter.updateTool && (() => options.adapter.updateTool!(basis, prepared)) : options.adapter.createTool && (() => options.adapter.createTool!(prepared));
    if (!writer) return { phase: "rejected", error: "Link-Speicherung ist nicht verfügbar." };
    const operation: ToolOperation = { id, toolId: basis?.id || `local-tool:${++localId}`, draft: prepared, phase: "saving", error: "", checking: false };
    operations.set(id, operation); const generation = options.generation(), scope = authority, started = ++sequence; mutationBoundary = started; options.changed();
    try {
      const result: ToolConfirmation = await writer();
      if (!options.active() || generation !== options.generation() || scope !== authority) return { phase: "session-ended" };
      if (!result.tool.id || !result.tool.updatedAt || (basis && result.tool.id !== basis.id)) throw new Error("Ob der Link gespeichert wurde, ist noch unklar.");
      const current = records.find(tool => tool.id === result.tool.id);
      if (((accepted.get(result.tool.id) || 0) > started || completeReadAt > started) && current?.updatedAt !== result.tool.updatedAt && (basis ? current?.updatedAt !== basis.updatedAt : Boolean(current))) readStatus = "stale";
      else { const acceptedAt = ++sequence; records = [...records.filter(tool => tool.id !== result.tool.id), result.tool]; accepted.set(result.tool.id, acceptedAt); receipts.set(result.tool.id, { started, acceptedAt, basisVersion: basis?.updatedAt }); }
      mutationBoundary = ++sequence; operation.toolId = result.tool.id; operation.phase = "saved"; operation.warning = result.warning;
      if (affectsQuickLinks(basis, result.tool)) options.invalidateQuickLinks(); options.changed(); return { phase: "saved", warning: result.warning };
    } catch (error) {
      if (!options.active() || generation !== options.generation() || scope !== authority) return { phase: "session-ended" };
      const failure = error as { status?: number; code?: string; message?: string };
      if (failure.code === "session_superseded") { options.endSession(); return { phase: "session-ended" }; }
      operation.phase = failure.code === "tool_version_conflict" ? "conflict" : failure.status && failure.status < 500 ? "rejected" : "unconfirmed";
      operation.error = failure.message || "Ob der Link gespeichert wurde, ist noch unklar.";
      if (operation.phase === "unconfirmed") { mutationBoundary = ++sequence; readStatus = "stale"; if (!basis || affectsQuickLinks(basis, { ...basis, ...prepared })) options.invalidateQuickLinks(); }
      options.changed(); return { phase: operation.phase, error: operation.error };
    }
  }
  const publicState: PlanningToolsState = {
    tools: () => ({ tools: visible(), completeness, readStatus: options.active() ? readStatus : "not-loaded", curatedCount: options.active() && !denied && completeness === "complete" && readStatus === "current" && ![...operations.values()].some(operation => ["saving", "unconfirmed"].includes(operation.phase)) ? records.filter(tool => tool.isCurated && tool.url).length : null, operations: options.active() && !denied ? [...operations.values()].map(operation => ({ ...operation, draft: structuredClone(operation.draft) })) : [], previews: options.active() && !denied ? [...previews.values()].map(preview => ({ ...preview, image: preview.image && { ...preview.image } })) : [] }),
    refreshTools: refresh, createTool: (id, draft) => save(id, draft), updateTool: (id, basis, draft) => save(id, draft, basis),
    async checkToolOutcome(id) { const operation = operations.get(id); if (!operation || operation.phase !== "unconfirmed" || !options.active()) return false; operation.checking = true; options.changed(); const generation = options.generation(), scope = authority; const result = await refresh(); if (options.active() && generation === options.generation() && scope === authority) { operation.checking = false; options.changed(); } return result; },
    async uploadToolPreview(id, file): Promise<ToolPreviewResult> {
      if (!options.active()) return { phase: "session-ended" }; if (denied) return { phase: "rejected", error: "Links sind in dieser Sitzung nicht verfügbar." };
      const previous = previews.get(id); if (previous && ["uploading", "uploaded", "unconfirmed"].includes(previous.phase)) return { phase: previous.phase === "uploaded" ? "uploaded" : "unconfirmed", image: previous.image, error: previous.error };
      const error = file.size <= 0 ? "Bild ist leer." : file.size > 5 * 1024 * 1024 ? "Bild ist zu groß. Maximal erlaubt sind 5 MB." : !["image/png", "image/jpeg", "image/webp", "image/gif"].includes(file.type) ? "Bildtyp wird nicht unterstützt." : "";
      if (error || !options.adapter.uploadToolPreview) return { phase: "rejected", error: error || "Bild-Upload ist nicht verfügbar." };
      const preview: ToolPreviewView = { id, fileName: file.name, phase: "uploading", error: "", checking: false, verification: "not-checked" }; previews.set(id, preview);
      const generation = options.generation(), scope = authority; options.changed();
      try {
        const image = await options.adapter.uploadToolPreview(file);
        if (!options.active() || generation !== options.generation() || scope !== authority) return { phase: "session-ended" };
        if (!isProtectedToolPreviewUrl(image.imageUrl) || image.source !== "manual") throw new Error("Ob das Bild hochgeladen wurde, ist noch unklar.");
        preview.phase = "uploaded"; preview.image = image; options.changed(); return { phase: "uploaded", image };
      } catch (error) {
        if (!options.active() || generation !== options.generation() || scope !== authority) return { phase: "session-ended" };
        const failure = error as { status?: number; code?: string; message?: string };
        if (failure.code === "session_superseded") { options.endSession(); return { phase: "session-ended" }; }
        preview.phase = failure.status && failure.status < 500 ? "rejected" : "unconfirmed"; preview.error = failure.message || "Ob das Bild hochgeladen wurde, ist noch unklar."; options.changed(); return { phase: preview.phase, error: preview.error };
      }
    },
    async checkToolPreview(id) {
      const preview = previews.get(id); if (!preview || !options.active() || denied) return { phase: "session-ended", verification: "forbidden" };
      if (!preview.image) { preview.verification = "no-reference"; options.changed(); return { phase: preview.phase === "rejected" ? "rejected" : "unconfirmed", verification: "no-reference" }; }
      if (!options.adapter.readToolPreview) return { phase: "uploaded", verification: "unavailable" };
      preview.checking = true; options.changed(); const generation = options.generation(), scope = authority;
      try { const found = await options.adapter.readToolPreview(preview.image.imageUrl); if (!options.active() || generation !== options.generation() || scope !== authority) return { phase: "session-ended", verification: "forbidden" }; preview.verification = found ? "present" : "unavailable"; }
      catch (error) { if (!options.active() || generation !== options.generation() || scope !== authority) return { phase: "session-ended", verification: "forbidden" }; preview.verification = [401, 403].includes(statusCode(error) || 0) ? "forbidden" : "unavailable"; }
      preview.checking = false; options.changed(); return { phase: "uploaded", verification: preview.verification };
    },
  };
  return { publicState, beginRead, acceptRead, failed, projectConfirmed: (data: PlanningShellState): PlanningShellState => ({ ...data, fmdTools: denied ? [] : records }), projectVisible: (data: PlanningShellState): PlanningShellState => ({ ...data, fmdTools: visible() }), clear() { records = []; operations.clear(); previews.clear(); accepted.clear(); receipts.clear(); reading = undefined; completeness = "partial"; readStatus = "not-loaded"; } };
}
