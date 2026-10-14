const bucketSegment = "/storage/v1/object/public/fmd-tool-previews/";
export function protectedToolPreviewUrl(value: string) {
  try {
    const url = new URL(value);
    const configured = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
    if (!configured || url.origin !== new URL(configured).origin || !url.pathname.startsWith(bucketSegment)) return value;
    return `/api/tools/preview-image?path=${encodeURIComponent(decodeURIComponent(url.pathname.slice(bucketSegment.length)))}`;
  } catch { return value; }
}
export function isProtectedToolPreviewUrl(value: string) {
  if (!value.startsWith("/api/tools/preview-image?")) return false;
  try {
    const url = new URL(value, "http://localhost");
    return url.pathname === "/api/tools/preview-image" && validToolPreviewPath(url.searchParams.get("path") || "");
  } catch { return false; }
}
export function validToolPreviewPath(path: string) {
  return /^quicklinks\/\d{4}-\d{2}-\d{2}\/[a-zA-Z0-9-]+\.(png|jpeg|webp|gif)$/.test(path);
}
