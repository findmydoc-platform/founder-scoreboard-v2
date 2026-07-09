import { Buffer } from "node:buffer";
import { randomUUID } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { apiError, requireApiContext } from "@/lib/api-response";
import { requireTeamMember } from "@/lib/authz";
import { compactAlphanumeric, slugify } from "@/lib/slug";

export const runtime = "nodejs";

const bucketName = "fmd-tool-previews";
const maxUploadBytes = 5 * 1024 * 1024;
const allowedMimeTypes = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
]);
const extensionByMimeType: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
};

function safeFileName(value: string) {
  const fallback = "preview";
  const trimmed = value.trim() || fallback;
  const parts = trimmed.split(".");
  const extension = parts.length > 1 ? parts.pop() || "" : "";
  const base = slugify(parts.join(".") || trimmed, { maxLength: 80 }) || fallback;
  return extension ? `${base}.${compactAlphanumeric(extension)}` : base;
}

export async function POST(request: NextRequest) {
  const context = await requireApiContext(request, requireTeamMember);
  if (!context.ok) return context.response;

  const formData = await request.formData();
  const file = formData.get("file");
  if (!(file instanceof File)) return apiError("Bild ist erforderlich.", 400);
  if (file.size <= 0) return apiError("Bild ist leer.", 400);
  if (file.size > maxUploadBytes) return apiError("Bild ist zu groß. Maximal erlaubt sind 5 MB.", 413);
  if (!allowedMimeTypes.has(file.type)) return apiError("Bildtyp wird nicht unterstützt.", 415);

  const extension = extensionByMimeType[file.type] || safeFileName(file.name).split(".").pop() || "bin";
  const path = `quicklinks/${new Date().toISOString().slice(0, 10)}/${Date.now()}-${randomUUID()}.${extension}`;
  const buffer = Buffer.from(await file.arrayBuffer());
  const { error } = await context.supabase.storage.from(bucketName).upload(path, buffer, {
    contentType: file.type,
    upsert: false,
  });

  if (error) return apiError(error.message || "Bild konnte nicht gespeichert werden.", 500);

  const { data } = context.supabase.storage.from(bucketName).getPublicUrl(path);
  return NextResponse.json({
    ok: true,
    imageUrl: data.publicUrl,
    source: "manual",
  });
}
