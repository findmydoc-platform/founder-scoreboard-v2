import { validToolPreviewPath } from "@/lib/tool-preview-image";
import { NextResponse, type NextRequest } from "next/server";
import { apiError, authzError } from "@/lib/api-response";
import { authorizeCredentialAction } from "@/lib/credentials";

export const runtime = "nodejs";

const maxUploadBytes = 5 * 1024 * 1024;
const allowedMimeTypes = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
]);
export async function POST(request: NextRequest) {
  const permission = await authorizeCredentialAction({ credential: { kind: "session-request", request }, action: "account.preview.write" });
  if (!permission.ok) return authzError(permission);

  const formData = await request.formData();
  const file = formData.get("file");
  if (!(file instanceof File)) return apiError("Bild ist erforderlich.", 400);
  if (file.size <= 0) return apiError("Bild ist leer.", 400);
  if (file.size > maxUploadBytes) return apiError("Bild ist zu groß. Maximal erlaubt sind 5 MB.", 413);
  if (!allowedMimeTypes.has(file.type)) return apiError("Bildtyp wird nicht unterstützt.", 415);

  const result = await permission.account.uploadPreview({ bytes: new Uint8Array(await file.arrayBuffer()), contentType: file.type });
  if (result.error) return apiError(result.error.message, result.error.status);
  const path = result.path!;

  return NextResponse.json({
    ok: true,
    imageUrl: `/api/tools/preview-image?path=${encodeURIComponent(path)}`,
    source: "manual",
  });
}

export async function GET(request: NextRequest) {
  const path = request.nextUrl.searchParams.get("path") || "";
  if (!validToolPreviewPath(path)) return apiError("Ungültiger Bildpfad.", 400);
  const permission = await authorizeCredentialAction({ credential: { kind: "server-cookies" }, action: "account.preview.read", path });
  if (!permission.ok) return apiError(permission.error, permission.status);
  const { data, error } = await permission.account.readPreview();
  if (error || !data) return apiError("Bild nicht verfügbar.", 404);
  return new NextResponse(data, { headers: {
    "Content-Type": data.type, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff",
  } });
}
