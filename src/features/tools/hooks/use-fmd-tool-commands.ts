"use client";

import { useState } from "react";
import type { PlanningCommandContext } from "@/features/planning/hooks/planning-command-context";
import * as planningApi from "@/features/planning/model/planning-api-client";
import { fmdToolCategoryLabel, fmdToolStatusFromUrl, maxCuratedFmdToolLinks, sortFmdTools, type FmdToolDraft } from "@/features/tools/model/fmd-tools";
import type { FmdTool } from "@/lib/types";

type PreparedFmdToolDraft = {
  name: string;
  category: FmdTool["category"];
  kind: string;
  description: string;
  url: string;
  owner: string;
  status: FmdTool["status"];
  isCurated: boolean;
};

export function useFmdToolCommands({
  apiClient,
  currentProfile,
  data,
  setData,
  setSaveError,
  source,
}: PlanningCommandContext) {
  const [fmdToolMessage, setFmdToolMessage] = useState("");
  const [fmdToolPending, setFmdToolPending] = useState(false);

  const prepareDraft = (draft: FmdToolDraft, currentToolId = ""): PreparedFmdToolDraft | null => {
    setSaveError("");
    setFmdToolMessage("");

    const name = draft.name.trim();
    const description = draft.description.trim();
    const url = draft.url.trim();
    const owner = draft.owner.trim() || currentProfile?.name || "Team";
    const kind = fmdToolCategoryLabel(draft.category);
    const status = fmdToolStatusFromUrl(url);
    const isCurated = Boolean(draft.isCurated && url);

    if (name.length < 2) {
      setSaveError("Name ist erforderlich.");
      return null;
    }
    if (description.length < 8) {
      setSaveError("Beschreibung muss mindestens 8 Zeichen haben.");
      return null;
    }
    if (url) {
      try {
        const parsedUrl = new URL(url);
        if (parsedUrl.protocol !== "https:" && parsedUrl.protocol !== "http:") {
          setSaveError("Link muss mit http:// oder https:// beginnen.");
          return null;
        }
      } catch {
        setSaveError("Link muss mit http:// oder https:// beginnen.");
        return null;
      }
    }
    if (isCurated) {
      const curatedLinkCount = data.fmdTools.filter((tool) => tool.id !== currentToolId && tool.isCurated && tool.url).length;
      if (curatedLinkCount >= maxCuratedFmdToolLinks) {
        setSaveError(`Es können maximal ${maxCuratedFmdToolLinks} kuratierte Links sein.`);
        return null;
      }
    }

    return {
      name,
      category: draft.category,
      kind,
      description,
      url,
      owner,
      status,
      isCurated,
    };
  };

  const createFmdTool = async (draft: FmdToolDraft) => {
    const prepared = prepareDraft(draft);
    if (!prepared) return false;

    const localTool: FmdTool = {
      id: `local-tool-${Date.now().toString(36)}`,
      ...prepared,
      sortOrder: Math.max(0, ...data.fmdTools.map((tool) => tool.sortOrder)) + 10,
    };

    setData((current) => ({
      ...current,
      fmdTools: sortFmdTools([...current.fmdTools, localTool]),
    }));
    setFmdToolMessage(`Werkzeug eingetragen: ${localTool.name}`);

    if (source !== "supabase") return true;

    setFmdToolPending(true);
    try {
      const { response, body } = await planningApi.createFmdToolRequest(apiClient, prepared);
      if (!response.ok || !body?.tool) throw new Error(body?.error || "Werkzeug konnte nicht gespeichert werden.");

      setData((current) => ({
        ...current,
        fmdTools: sortFmdTools(current.fmdTools.map((tool) => (tool.id === localTool.id ? body.tool! : tool))),
      }));
      setFmdToolMessage(`Werkzeug gespeichert: ${body.tool.name}`);
      return true;
    } catch (error) {
      setData((current) => ({
        ...current,
        fmdTools: current.fmdTools.filter((tool) => tool.id !== localTool.id),
      }));
      setFmdToolMessage("");
      setSaveError(error instanceof Error ? error.message : "Werkzeug konnte nicht gespeichert werden.");
      return false;
    } finally {
      setFmdToolPending(false);
    }
  };

  const updateFmdTool = async (tool: FmdTool, draft: FmdToolDraft) => {
    const prepared = prepareDraft(draft, tool.id);
    if (!prepared) return false;

    const updatedTool: FmdTool = {
      ...tool,
      ...prepared,
    };

    setData((current) => ({
      ...current,
      fmdTools: sortFmdTools(current.fmdTools.map((item) => (item.id === tool.id ? updatedTool : item))),
    }));
    setFmdToolMessage(`Werkzeug aktualisiert: ${updatedTool.name}`);

    if (source !== "supabase") return true;

    setFmdToolPending(true);
    try {
      const { response, body } = await planningApi.updateFmdToolRequest(apiClient, tool.id, prepared);
      if (!response.ok || !body?.tool) throw new Error(body?.error || "Werkzeug konnte nicht gespeichert werden.");

      setData((current) => ({
        ...current,
        fmdTools: sortFmdTools(current.fmdTools.map((item) => (item.id === tool.id ? body.tool! : item))),
      }));
      setFmdToolMessage(`Werkzeug gespeichert: ${body.tool.name}`);
      return true;
    } catch (error) {
      setData((current) => ({
        ...current,
        fmdTools: sortFmdTools(current.fmdTools.map((item) => (item.id === tool.id ? tool : item))),
      }));
      setFmdToolMessage("");
      setSaveError(error instanceof Error ? error.message : "Werkzeug konnte nicht gespeichert werden.");
      return false;
    } finally {
      setFmdToolPending(false);
    }
  };

  return {
    createFmdTool,
    fmdToolMessage,
    fmdToolPending,
    updateFmdTool,
  };
}
