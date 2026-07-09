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
  previewImageUrl: string;
  previewImageSource: FmdTool["previewImageSource"];
};

const maxPreviewImageBytes = 5 * 1024 * 1024;
const allowedPreviewImageTypes = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);

function isValidHttpUrl(value: string) {
  try {
    const parsedUrl = new URL(value);
    return parsedUrl.protocol === "https:" || parsedUrl.protocol === "http:";
  } catch {
    return false;
  }
}

function readFileAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("Bild konnte nicht gelesen werden."));
    reader.readAsDataURL(file);
  });
}

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
    const previewImageUrl = draft.previewImageUrl.trim();
    const previewImageSource = previewImageUrl ? draft.previewImageSource : "none";

    if (name.length < 2) {
      setSaveError("Name ist erforderlich.");
      return null;
    }
    if (description.length < 8) {
      setSaveError("Beschreibung muss mindestens 8 Zeichen haben.");
      return null;
    }
    if (url) {
      if (!isValidHttpUrl(url)) {
        setSaveError("Link muss mit http:// oder https:// beginnen.");
        return null;
      }
    }
    if (previewImageUrl && !isValidHttpUrl(previewImageUrl) && !(source !== "supabase" && previewImageUrl.startsWith("data:image/"))) {
      setSaveError("Vorschaubild muss mit http:// oder https:// beginnen.");
      return null;
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
      previewImageUrl,
      previewImageSource,
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
    setFmdToolMessage(`Link eingetragen: ${localTool.name}`);

    if (source !== "supabase") return true;

    setFmdToolPending(true);
    try {
      const { response, body } = await planningApi.createFmdToolRequest(apiClient, prepared);
      if (!response.ok || !body?.tool) throw new Error(body?.error || "Link konnte nicht gespeichert werden.");

      setData((current) => ({
        ...current,
        fmdTools: sortFmdTools(current.fmdTools.map((tool) => (tool.id === localTool.id ? body.tool! : tool))),
      }));
      setFmdToolMessage(`Link gespeichert: ${body.tool.name}`);
      return true;
    } catch (error) {
      setData((current) => ({
        ...current,
        fmdTools: current.fmdTools.filter((tool) => tool.id !== localTool.id),
      }));
      setFmdToolMessage("");
      setSaveError(error instanceof Error ? error.message : "Link konnte nicht gespeichert werden.");
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
    setFmdToolMessage(`Link aktualisiert: ${updatedTool.name}`);

    if (source !== "supabase") return true;

    setFmdToolPending(true);
    try {
      const { response, body } = await planningApi.updateFmdToolRequest(apiClient, tool.id, prepared);
      if (!response.ok || !body?.tool) throw new Error(body?.error || "Link konnte nicht gespeichert werden.");

      setData((current) => ({
        ...current,
        fmdTools: sortFmdTools(current.fmdTools.map((item) => (item.id === tool.id ? body.tool! : item))),
      }));
      setFmdToolMessage(`Link gespeichert: ${body.tool.name}`);
      return true;
    } catch (error) {
      setData((current) => ({
        ...current,
        fmdTools: sortFmdTools(current.fmdTools.map((item) => (item.id === tool.id ? tool : item))),
      }));
      setFmdToolMessage("");
      setSaveError(error instanceof Error ? error.message : "Link konnte nicht gespeichert werden.");
      return false;
    } finally {
      setFmdToolPending(false);
    }
  };

  const loadFmdToolMetadata = async (url: string) => {
    setSaveError("");
    setFmdToolMessage("");
    const normalizedUrl = url.trim();
    if (!normalizedUrl) {
      setSaveError("URL ist erforderlich.");
      return null;
    }
    if (!isValidHttpUrl(normalizedUrl)) {
      setSaveError("Link muss mit http:// oder https:// beginnen.");
      return null;
    }

    try {
      const { response, body } = await planningApi.requestFmdToolMetadata(apiClient, normalizedUrl);
      if (!response.ok || !body?.metadata) throw new Error(body?.error || "Metadaten konnten nicht geladen werden.");
      setFmdToolMessage("Metadaten geladen.");
      return body.metadata;
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : "Metadaten konnten nicht geladen werden.");
      return null;
    }
  };

  const uploadFmdToolPreviewImage = async (file: File) => {
    setSaveError("");
    setFmdToolMessage("");

    if (file.size <= 0) {
      setSaveError("Bild ist leer.");
      return null;
    }
    if (!allowedPreviewImageTypes.has(file.type)) {
      setSaveError("Bildtyp wird nicht unterstützt.");
      return null;
    }
    if (file.size > maxPreviewImageBytes) {
      setSaveError("Bild ist zu groß. Maximal erlaubt sind 5 MB.");
      return null;
    }

    if (source !== "supabase") {
      try {
        return {
          imageUrl: await readFileAsDataUrl(file),
          source: "manual" as const,
        };
      } catch (error) {
        setSaveError(error instanceof Error ? error.message : "Bild konnte nicht gelesen werden.");
        return null;
      }
    }

    try {
      const { response, body } = await planningApi.uploadFmdToolPreviewImageRequest(apiClient, file);
      if (!response.ok || !body?.imageUrl || body.source !== "manual") throw new Error(body?.error || "Bild konnte nicht gespeichert werden.");
      setFmdToolMessage("Vorschaubild gespeichert.");
      return { imageUrl: body.imageUrl, source: body.source };
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : "Bild konnte nicht gespeichert werden.");
      return null;
    }
  };

  return {
    createFmdTool,
    fmdToolMessage,
    fmdToolPending,
    loadFmdToolMetadata,
    uploadFmdToolPreviewImage,
    updateFmdTool,
  };
}
