"use client";
import { useState } from "react";
import type { PlanningCommandContext } from "@/features/planning/hooks/planning-command-context";
import * as planningApi from "@/features/planning/model/planning-api-client";
import type { FmdToolDraft } from "../model/fmd-tools";
import type { ToolResult } from "../model/tool-state";
import type { FmdTool } from "@/lib/types";

export function useFmdToolCommands({ apiClient, planningState, currentProfile, setSaveError }: Pick<PlanningCommandContext, "apiClient" | "planningState" | "currentProfile" | "setSaveError">) {
  const [fmdToolMessage, setFmdToolMessage] = useState("");
  function prepare(draft: FmdToolDraft) { return { ...draft, owner: draft.owner.trim() || currentProfile?.name || "Team" }; }
  function finish(result: ToolResult, name: string) {
    if (result.phase !== "saved") { setSaveError(result.error || "Die Bestätigung steht aus. Eingaben bleiben erhalten; bitte zuerst den Serverstand prüfen."); return false; }
    setFmdToolMessage(result.warning || `Link gespeichert: ${name}`); return true;
  }
  return {
    fmdToolMessage,
    fmdToolPending: planningState.tools().operations.some(operation => operation.phase === "saving"),
    async createFmdTool(draft: FmdToolDraft, submissionId: string) {
      setSaveError(""); setFmdToolMessage(""); return finish(await planningState.createTool(submissionId, prepare(draft)), draft.name);
    },
    async updateFmdTool(tool: FmdTool, draft: FmdToolDraft, submissionId: string) {
      setSaveError(""); setFmdToolMessage(""); return finish(await planningState.updateTool(submissionId, tool, prepare(draft)), draft.name);
    },
    async loadFmdToolMetadata(url: string) {
      setSaveError(""); setFmdToolMessage("");
      try {
        const normalized = new URL(url.trim()); if (!["http:", "https:"].includes(normalized.protocol)) return null;
        const { response, body } = await planningApi.requestFmdToolMetadata(apiClient, normalized.toString());
        return response.ok && body?.metadata ? body.metadata : null;
      } catch { return null; }
    },
    async uploadFmdToolPreviewImage(file: File, uploadId: string) {
      setSaveError(""); setFmdToolMessage("");
      const result = await planningState.uploadToolPreview(uploadId, file);
      if (result.phase !== "uploaded" || !result.image) { setSaveError(result.error || "Bild-Upload ist noch nicht bestätigt. Bitte nicht erneut hochladen."); return null; }
      setFmdToolMessage("Vorschaubild hochgeladen. Der Link ist damit noch nicht gespeichert."); return result.image;
    },
  };
}
