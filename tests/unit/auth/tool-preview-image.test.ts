import { expect, it, vi } from "vitest";
import { protectedToolPreviewUrl, isProtectedToolPreviewUrl, validToolPreviewPath } from "@/lib/tool-preview-image";
import { safeRelativeNext } from "@/lib/auth-redirect";

it("preserves uploaded images through a protected path without proxying arbitrary URLs", () => {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://database.example");
  try {
    const result = protectedToolPreviewUrl("https://database.example/storage/v1/object/public/fmd-tool-previews/quicklinks/2026-09-26/123-abc.png");
    expect(result).toBe("/api/tools/preview-image?path=quicklinks%2F2026-09-26%2F123-abc.png");
    expect(isProtectedToolPreviewUrl(result)).toBe(true);
    expect(protectedToolPreviewUrl("https://other.example/image.png")).toBe("https://other.example/image.png");
    expect(validToolPreviewPath("../private/avatar.png")).toBe(false);
    expect(validToolPreviewPath("quicklinks/2026-09-26/../secret.png")).toBe(false);
  } finally { vi.unstubAllEnvs(); }
});
it.each(["//evil.example", "/\\evil.example", "https://evil.example", "javascript:alert(1)"])("rejects external return URL %s", value => {
  expect(safeRelativeNext(value)).toBe("/");
});
