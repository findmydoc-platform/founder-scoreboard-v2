import assert from "node:assert/strict";
import test from "node:test";
import { loadTranspiledModule } from "./helpers/transpile-module.mjs";

test("api input helpers preserve required and optional text semantics", async () => {
  const { auditRequestMetadata, cleanDate, cleanOptionalDate, cleanOptionalText, cleanText, cleanTime, isIsoDate } = await loadTranspiledModule("src/lib/api-input.ts");

  assert.equal(cleanText("  FounderOps  ", 20), "FounderOps");
  assert.equal(cleanText("  FounderOps  ", 7), "Founder");
  assert.equal(cleanText(42, 20), "");
  assert.equal(cleanText("", 20), "");

  assert.equal(cleanOptionalText("  FounderOps  ", 20), "FounderOps");
  assert.equal(cleanOptionalText("  FounderOps  ", 7), "Founder");
  assert.equal(cleanOptionalText("   ", 20), "");
  assert.equal(cleanOptionalText(undefined, 20), undefined);
  assert.equal(cleanOptionalText(42, 20), undefined);

  assert.equal(isIsoDate("2026-06-09"), true);
  assert.equal(isIsoDate("2026-6-9"), false);
  assert.equal(isIsoDate(42), false);

  assert.equal(cleanDate("2026-06-09"), "2026-06-09");
  assert.equal(cleanDate("2026-6-9"), "");
  assert.equal(cleanDate(undefined), "");

  assert.equal(cleanOptionalDate("2026-06-09"), "2026-06-09");
  assert.equal(cleanOptionalDate(""), null);
  assert.equal(cleanOptionalDate(undefined), null);
  assert.equal(cleanOptionalDate("2026-6-9"), undefined);

  assert.equal(cleanTime("09:30"), "09:30");
  assert.equal(cleanTime("9:30"), "");
  assert.equal(cleanTime(undefined), "");

  const metadata = auditRequestMetadata({
    headers: new Map([
      ["x-forwarded-for", "203.0.113.10, 198.51.100.3"],
      ["user-agent", "FounderOps Test"],
    ]),
  });
  assert.deepEqual(metadata, {
    request_ip: "203.0.113.10",
    user_agent: "FounderOps Test",
  });
  assert.deepEqual(auditRequestMetadata({ headers: new Map() }), {
    request_ip: null,
    user_agent: undefined,
  });
});
