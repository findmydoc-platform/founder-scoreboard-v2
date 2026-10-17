import { isProtectedToolPreviewUrl } from "@/lib/tool-preview-image";
import { NextResponse, type NextRequest } from "next/server";
import { auditRequestMetadata, cleanText } from "@/lib/api-input";
import { apiError, authzError, readJsonPayload } from "@/lib/api-response";
import { authorizeCredentialAction } from "@/lib/credentials";
import { mapFmdTool } from "@/lib/planning-row-mappers";
import type { DbFmdTool } from "@/lib/planning-row-types";
import type { FmdTool } from "@/lib/types";
import { invalidateSharedPlanningHeaderCache } from "@/lib/planning-header-cache";

type FmdToolPayload = {
  name?: string;
  category?: string;
  kind?: string;
  description?: string;
  url?: string;
  owner?: string;
  status?: string;
  isCurated?: boolean;
  previewImageUrl?: string;
  previewImageSource?: string;
};

const toolCategories = new Set<FmdTool["category"]>(["tool", "repo", "knowledge", "asset"]);
const previewImageSources = new Set<FmdTool["previewImageSource"]>(["none", "og", "manual"]);

function normalizeToolUrl(value: string) {
  if (!value) return "";
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    return url.toString();
  } catch {
    return null;
  }
}

function normalizePreviewImageUrl(value: string) {
  if (isProtectedToolPreviewUrl(value)) return value;
  if (!value) return "";
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    return url.toString();
  } catch {
    return null;
  }
}

export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const permission = await authorizeCredentialAction({ credential: { kind: "session-request", request }, action: "tools.update", targetId: id });
  if (!permission.ok) return authzError(permission);
  const payload = await readJsonPayload<FmdToolPayload>(request, {});
  if (!id.trim()) return apiError("Link ist erforderlich.", 400);

  const { data: current, error: currentError } = await permission.resource.readTool();

  if (currentError || !current) return apiError("Link wurde nicht gefunden.", 404);

  const name = cleanText(payload.name, 160);
  const description = cleanText(payload.description, 1200);
  const kind = cleanText(payload.kind, 80) || current.kind || "Tool";
  const owner = cleanText(payload.owner, 120) || permission.profile?.name || "Team";
  const category = toolCategories.has(payload.category as FmdTool["category"]) ? payload.category as FmdTool["category"] : "tool";
  const normalizedUrl = normalizeToolUrl(cleanText(payload.url, 600));
  const normalizedPreviewImageUrl = normalizePreviewImageUrl(cleanText(payload.previewImageUrl, 1000));

  if (name.length < 2) return apiError("Name ist erforderlich.", 400);
  if (description.length < 8) return apiError("Beschreibung muss mindestens 8 Zeichen haben.", 400);
  if (normalizedUrl === null) return apiError("Link muss mit http:// oder https:// beginnen.", 400);
  if (normalizedPreviewImageUrl === null) return apiError("Vorschaubild muss mit http:// oder https:// beginnen.", 400);

  const status: FmdTool["status"] = normalizedUrl ? "active" : "missing_link";
  const isCurated = Boolean(payload.isCurated && normalizedUrl);
  const previewImageSource = normalizedPreviewImageUrl && previewImageSources.has(payload.previewImageSource as FmdTool["previewImageSource"])
    ? payload.previewImageSource as FmdTool["previewImageSource"]
    : "none";
  const result = await permission.resource.saveTool({
    name, category, kind, description, url: normalizedUrl || null, owner, status,
    is_curated: isCurated, preview_image_url: normalizedPreviewImageUrl || null, preview_image_source: previewImageSource,
  }, auditRequestMetadata(request));
  if (!result.ok) return apiError(result.error, result.status);

  invalidateSharedPlanningHeaderCache("quickLinks");

  return NextResponse.json({ ok: true, tool: mapFmdTool(result.tool as DbFmdTool) });
}
