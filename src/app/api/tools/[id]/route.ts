import { NextResponse, type NextRequest } from "next/server";
import { auditRequestMetadata, cleanText } from "@/lib/api-input";
import { apiError, requireJsonApiContext } from "@/lib/api-response";
import { requireTeamMember } from "@/lib/authz";
import { mapFmdTool } from "@/lib/planning-data-mappers";
import type { DbFmdTool } from "@/lib/planning-data-row-types";
import type { FmdTool } from "@/lib/types";

const maxCuratedFmdToolLinks = 5;

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
const fmdToolSelect = "id,name,category,kind,description,url,owner,status,is_curated,preview_image_url,preview_image_source,sort_order";

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
  const apiContext = await requireJsonApiContext<FmdToolPayload>(request, requireTeamMember, {});
  if (!apiContext.ok) return apiContext.response;

  const { payload, permission, supabase } = apiContext;
  const { id } = await context.params;
  if (!id.trim()) return apiError("Link ist erforderlich.", 400);

  const { data: current, error: currentError } = await supabase
    .from("fmd_tools")
    .select(fmdToolSelect)
    .eq("id", id)
    .single();

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
  if (isCurated) {
    const { count, error: countError } = await supabase
      .from("fmd_tools")
      .select("id", { count: "exact", head: true })
      .eq("is_curated", true)
      .not("url", "is", null)
      .neq("id", id);
    if (countError) return apiError(countError.message, 500);
    if ((count || 0) >= maxCuratedFmdToolLinks) return apiError(`Es können maximal ${maxCuratedFmdToolLinks} kuratierte Links sein.`, 400);
  }
  const update = {
    name,
    category,
    kind,
    description,
    url: normalizedUrl || null,
    owner,
    status,
    is_curated: isCurated,
    preview_image_url: normalizedPreviewImageUrl || null,
    preview_image_source: previewImageSource,
    updated_at: new Date().toISOString(),
  };

  const { data: updated, error } = await supabase
    .from("fmd_tools")
    .update(update)
    .eq("id", id)
    .select(fmdToolSelect)
    .single();

  if (error || !updated) return apiError(error?.message || "Link konnte nicht gespeichert werden.", 500);

  await supabase.from("audit_log").insert({
    actor_profile_id: permission.profile?.id || null,
    action: "fmd_tool.update",
    entity_type: "fmd_tool",
    entity_id: id,
    before_data: current,
    after_data: update,
    ...auditRequestMetadata(request),
  });

  return NextResponse.json({ ok: true, tool: mapFmdTool(updated as DbFmdTool) });
}
