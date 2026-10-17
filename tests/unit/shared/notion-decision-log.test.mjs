import assert from "node:assert/strict";
import { test } from "vitest";
import { importTestModule } from "../../helpers/vitest-module.mjs";

const {
  mapNotionDecisionLogEntry,
  safeDecisionLogUrl,
} = await importTestModule("src/lib/notion-decision-log.ts", {
  "server-only": {},
});

const {
  buildDecisionLogViewModel,
  DECISION_LOG_PAGE_SIZE,
  decisionLogAttentionReasons,
  decisionLogFilterKey,
  decisionLogFormLabel,
  visibleDecisionLogEntries,
} = await importTestModule("src/features/decision-log/model/decision-log-view-model.ts");

function notionPage(overrides = {}) {
  return {
    object: "page",
    id: "decision-1",
    url: "https://notion.so/decision-1",
    properties: {
      Decision: { title: [{ plain_text: "Technische " }, { plain_text: "Entscheidung" }] },
      Datum: { date: { start: "2026-07-17" } },
      Status: { status: { name: "Bestätigt" } },
      Kategorie: { select: { name: "Tech" } },
      Owner: { people: [{ name: "Sebastian" }, { name: "Mehmet" }] },
      Kurzfassung: { rich_text: [{ plain_text: "Kurzer " }, { plain_text: "Nachweis" }] },
      Beschluss: { rich_text: [{ plain_text: "Wir " }, { plain_text: "setzen um." }] },
      "Erforderliche Zustimmung": { select: { name: "Einfache Mehrheit" } },
      Abstimmung: { select: { name: "Abgeschlossen" } },
      Bestätigung: { select: { name: "Bestätigt" } },
      Entscheidungskreis: { people: [{ name: "Sebastian" }, { name: "Mehmet" }] },
      Review: { date: { start: "2026-10-01" } },
      "Quelle / Meeting": { url: "https://meet.google.com/example" },
      "Google Form": { url: "https://docs.google.com/forms/example" },
      "PDF Archiv": { url: "https://drive.google.com/example.pdf" },
    },
    ...overrides,
  };
}

function entry(overrides = {}) {
  return {
    id: "decision-1",
    notionUrl: "https://notion.so/decision-1",
    decision: "Technische Entscheidung",
    date: "2026-07-17",
    status: "Entwurf",
    category: "Tech",
    owners: ["Sebastian"],
    summary: "Kurzer Nachweis",
    resolution: "",
    requiredApproval: "Einfache Mehrheit",
    vote: "Offen",
    confirmation: "Offen",
    decisionCircle: ["Sebastian", "Mehmet"],
    reviewDate: "2026-07-20",
    sourceUrl: "https://meet.google.com/example",
    googleFormUrl: "https://docs.google.com/forms/example",
    pdfArchiveUrl: "https://drive.google.com/example.pdf",
    ...overrides,
  };
}

test("maps every approved Notion property without loading page content", () => {
  assert.deepEqual(mapNotionDecisionLogEntry(notionPage()), {
    id: "decision-1",
    notionUrl: "https://notion.so/decision-1",
    decision: "Technische Entscheidung",
    date: "2026-07-17",
    status: "Bestätigt",
    category: "Tech",
    owners: ["Sebastian", "Mehmet"],
    summary: "Kurzer Nachweis",
    resolution: "Wir setzen um.",
    requiredApproval: "Einfache Mehrheit",
    vote: "Abgeschlossen",
    confirmation: "Bestätigt",
    decisionCircle: ["Sebastian", "Mehmet"],
    reviewDate: "2026-10-01",
    sourceUrl: "https://meet.google.com/example",
    googleFormUrl: "https://docs.google.com/forms/example",
    pdfArchiveUrl: "https://drive.google.com/example.pdf",
  });
});

test("maps missing properties to safe values and rejects unsafe links", () => {
  assert.deepEqual(mapNotionDecisionLogEntry(notionPage({ url: "javascript:alert(1)", properties: {} })), {
    id: "decision-1",
    notionUrl: "",
    decision: "Ohne Titel",
    date: "",
    status: "",
    category: "",
    owners: [],
    summary: "",
    resolution: "",
    requiredApproval: "",
    vote: "",
    confirmation: "",
    decisionCircle: [],
    reviewDate: "",
    sourceUrl: "",
    googleFormUrl: "",
    pdfArchiveUrl: "",
  });
  assert.equal(mapNotionDecisionLogEntry({ object: "database" }), null);
  assert.equal(safeDecisionLogUrl("file:///private/example"), "");
  assert.equal(safeDecisionLogUrl("https://example.com/path"), "https://example.com/path");
});

test("derives unique attention reasons without interpreting the ambiguous Review date", () => {
  const openReasons = decisionLogAttentionReasons(entry({ vote: "In Abstimmung", confirmation: "Form versendet" }));
  assert.deepEqual(openReasons.map((reason) => reason.key), ["decision_required", "vote_in_progress", "confirmation_open"]);

  const openResolutionReasons = decisionLogAttentionReasons(entry({ resolution: "Offen", vote: "Abgeschlossen", confirmation: "Bestätigt", reviewDate: "2026-08-01" }));
  assert.deepEqual(openResolutionReasons.map((reason) => reason.key), ["decision_required"]);

  const confirmedReasons = decisionLogAttentionReasons(entry({ status: "Bestätigt", vote: "In Abstimmung", confirmation: "Offen" }));
  assert.deepEqual(confirmedReasons.map((reason) => reason.key), []);

  const reviewingReasons = decisionLogAttentionReasons(entry({ status: "In Prüfung", resolution: "Vorläufig geklärt", vote: "Abgeschlossen", confirmation: "Bestätigt", reviewDate: "2026-08-01" }));
  assert.deepEqual(reviewingReasons.map((reason) => reason.key), ["review_open"]);
});

test("builds tabs, OR/AND filters, unique rows and stable sorting", () => {
  const entries = [
    entry({ id: "alpha", decision: "Alpha", category: "Tech", date: "2026-07-20", vote: "In Abstimmung", confirmation: "Bestätigt", reviewDate: "2026-08-01" }),
    entry({ id: "beta", decision: "Beta", category: "People", date: "2026-07-19", status: "Bestätigt", resolution: "Beschlossen", vote: "Abgeschlossen", confirmation: "Bestätigt", reviewDate: "2026-08-01" }),
    entry({ id: "archive", decision: "Archiv", category: "Tech", date: "2026-07-18", status: "Archiviert", resolution: "Beschlossen", vote: "Abgeschlossen", confirmation: "Bestätigt", reviewDate: "2026-07-01" }),
    entry({ id: "alpha", decision: "Duplikat" }),
  ];
  const defaultView = buildDecisionLogViewModel({ entries, filters: {} });
  assert.equal(defaultView.entries.length, 3);
  assert.deepEqual(defaultView.counts, { attention: 1, all: 3, decided: 1, archive: 1 });

  const filtered = buildDecisionLogViewModel({
    entries,
    filters: {
      scope: "attention",
      reasons: ["vote_in_progress", "confirmation_open"],
      categories: ["Tech"],
      query: "alpha",
      sort: "decision",
      direction: "asc",
    },
  });
  assert.deepEqual(filtered.filteredEntries.map((item) => item.id), ["alpha"]);
});

test("reveals already loaded decisions in deterministic groups of 25", () => {
  const entries = Array.from({ length: 55 }, (_, index) => entry({ id: `decision-${index}` }));

  assert.equal(DECISION_LOG_PAGE_SIZE, 25);
  assert.equal(visibleDecisionLogEntries(entries, DECISION_LOG_PAGE_SIZE).length, 25);
  assert.equal(visibleDecisionLogEntries(entries, DECISION_LOG_PAGE_SIZE * 2).length, 50);
  assert.equal(visibleDecisionLogEntries(entries, DECISION_LOG_PAGE_SIZE * 3).length, 55);
});

test("keys the visible-row limit to URL-backed filters regardless of multi-filter order", () => {
  const filters = {
    scope: "attention",
    query: "alpha",
    reasons: ["confirmation_open", "vote_in_progress"],
    categories: ["Tech", "People"],
    sort: "date",
    direction: "desc",
  };

  assert.equal(decisionLogFilterKey(filters), decisionLogFilterKey({
    ...filters,
    reasons: ["vote_in_progress", "confirmation_open"],
    categories: ["People", "Tech"],
  }));
  assert.notEqual(decisionLogFilterKey(filters), decisionLogFilterKey({ ...filters, scope: "all" }));
  assert.notEqual(decisionLogFilterKey(filters), decisionLogFilterKey({ ...filters, query: "beta" }));
});

test("labels the form as an action and moves closed forms to history language", () => {
  assert.equal(decisionLogFormLabel(entry()), "Zur Abstimmung ↗");
  assert.equal(decisionLogFormLabel(entry({ status: "Bestätigt" })), "Abstimmung ansehen ↗");
});
