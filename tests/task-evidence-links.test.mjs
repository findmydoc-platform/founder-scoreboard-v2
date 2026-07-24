import assert from "node:assert/strict";
import test from "node:test";
import { loadTranspiledModule } from "./helpers/transpile-module.mjs";

const {
  evidenceLinkFields,
  evidenceLinkPresentation,
  evidenceLinkProvider,
  normalizeEvidenceLinkList,
} = await loadTranspiledModule("src/features/tasks/model/task-evidence-links.ts");

test("lazy evidence fields always keep exactly one trailing empty field", () => {
  assert.deepEqual(evidenceLinkFields([]), [""]);
  assert.deepEqual(evidenceLinkFields(["https://example.com"]), ["https://example.com", ""]);
  assert.deepEqual(
    evidenceLinkFields(["https://one.example", "", "https://two.example"]),
    ["https://one.example", "", "https://two.example", ""],
  );
  assert.deepEqual(
    evidenceLinkFields(["https://one.example", "", ""]),
    ["https://one.example", ""],
  );
});

test("evidence link normalization removes blanks and deduplicates canonical HTTP URLs", () => {
  assert.deepEqual(
    normalizeEvidenceLinkList([
      " https://example.com/evidence ",
      "",
      "https://example.com/evidence",
      "http://notion.so/page",
    ]),
    {
      ok: true,
      links: ["https://example.com/evidence", "http://notion.so/page"],
    },
  );
});

test("evidence link normalization rejects invalid protocols and more than twenty links", () => {
  assert.deepEqual(normalizeEvidenceLinkList(["javascript:alert(1)"]), {
    ok: false,
    error: "Bitte nur vollständige http- oder https-URLs als Nachweis speichern.",
  });
  const tooMany = Array.from({ length: 21 }, (_, index) => `https://example.com/${index}`);
  assert.equal(normalizeEvidenceLinkList(tooMany).ok, false);
});

test("evidence providers distinguish GitHub, Notion, and generic web links", () => {
  assert.equal(evidenceLinkProvider("https://github.com/findmydoc-platform/management/pull/42"), "github");
  assert.equal(evidenceLinkProvider("https://workspace.notion.site/Decision-123"), "notion");
  assert.equal(evidenceLinkProvider("https://example.com/proof"), "web");
  assert.deepEqual(evidenceLinkPresentation("https://github.com/findmydoc-platform/management"), {
    host: "github.com",
    label: "GitHub",
    provider: "github",
  });
});
