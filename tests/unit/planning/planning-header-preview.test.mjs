import assert from "node:assert/strict";
import { test } from "vitest";
import { importTestModule } from "../../helpers/vitest-module.mjs";

test("header quick links protect private preview images from database and cached data", async () => {
  const previous = process.env.NEXT_PUBLIC_SUPABASE_URL;
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://database.example";
  try {
    const header = await importTestModule("src/lib/planning-header-data.ts", {
      "@/lib/notification-resolution": { reconcileNotificationEvents: async () => ({}) },
      "@/lib/platform": { isOperationalLeadRole: () => false },
    });
    const original = "https://database.example/storage/v1/object/public/fmd-tool-previews/quicklinks/2026-09-26/123-abc.png";
    const expected = "/api/tools/preview-image?path=quicklinks%2F2026-09-26%2F123-abc.png";
    const query = {
      select() { return query; }, eq() { return query; }, not() { return query; },
      neq() { return query; }, order() { return query; }, limit() { return query; },
      then(resolve) { return Promise.resolve(resolve({ data: [{ id: "tool-1", name: "Tool", category: "other", url: "https://example.com", preview_image_url: original }], error: null })); },
    };
    const database = { from(table) { assert.equal(table, "fmd_tools"); return query; } };
    const loaded = await header.loadHeaderQuickLinks(database);
    assert.equal(loaded.data[0].previewImageUrl, expected);
    const cached = header.normalizePlanningHeaderData({ quickLinks: { state: "ready", data: [{ ...loaded.data[0], previewImageUrl: original }] } });
    assert.equal(cached.quickLinks.data[0].previewImageUrl, expected);
    assert.equal(header.projectHeaderQuickLinks([{ ...loaded.data[0], isCurated: true, previewImageUrl: original }])[0].previewImageUrl, expected);
  } finally {
    if (previous === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    else process.env.NEXT_PUBLIC_SUPABASE_URL = previous;
  }
});
