import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { loadTranspiledModule } from "./helpers/transpile-module.mjs";

const {
  loadNotionDecisionLog,
  mapNotionDecisionLogEntry,
  NOTION_DECISION_LOG_REQUEST_TIMEOUT_MS,
  NOTION_DECISION_LOG_TOTAL_TIMEOUT_MS,
  safeDecisionLogUrl,
} = await loadTranspiledModule("src/lib/notion-decision-log.ts", {
  "server-only": {},
});

const {
  buildDecisionLogViewModel,
  DECISION_LOG_PAGE_SIZE,
  decisionLogAttentionReasons,
  decisionLogFilterKey,
  decisionLogFormLabel,
  visibleDecisionLogEntries,
} = await loadTranspiledModule("src/features/decision-log/model/decision-log-view-model.ts");

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

test("paginates every Notion result and keeps server request details deterministic", async () => {
  const requests = [];
  const result = await loadNotionDecisionLog(
    {
      NOTION_DECISION_LOG_TOKEN: "secret-test-token",
      NOTION_DECISION_LOG_DATA_SOURCE_ID: "collection://source-id",
    },
    async (url, init) => {
      requests.push({ url, init });
      if (requests.length === 1) {
        return Response.json({ results: [notionPage({ id: "later", properties: { ...notionPage().properties, Datum: { date: { start: "2026-07-18" } } } })], has_more: true, next_cursor: "cursor-2" });
      }
      return Response.json({ results: [notionPage({ id: "earlier" })], has_more: false, next_cursor: null });
    },
  );

  assert.equal(result.ok, true);
  assert.deepEqual(result.entries.map((item) => item.id), ["later", "earlier"]);
  assert.equal(requests.length, 2);
  assert.match(requests[0].url, /data_sources\/source-id\/query$/);
  assert.equal(requests[0].init.cache, "no-store");
  assert.equal(requests[0].init.signal instanceof AbortSignal, true);
  assert.equal(requests[0].init.headers.Authorization, "Bearer secret-test-token");
  assert.deepEqual(JSON.parse(requests[0].init.body), {
    page_size: 100,
    sorts: [{ property: "Datum", direction: "descending" }],
  });
  assert.deepEqual(JSON.parse(requests[1].init.body), {
    page_size: 100,
    sorts: [{ property: "Datum", direction: "descending" }],
    start_cursor: "cursor-2",
  });
});

test("bounds each Notion request and the complete pagination window", async () => {
  const environment = {
    NOTION_DECISION_LOG_TOKEN: "secret-test-token",
    NOTION_DECISION_LOG_DATA_SOURCE_ID: "source-id",
  };
  const timeoutRequests = [];
  let now = 0;
  let requestCount = 0;
  const result = await loadNotionDecisionLog(
    environment,
    async () => {
      requestCount += 1;
      now = NOTION_DECISION_LOG_TOTAL_TIMEOUT_MS + 1;
      return Response.json({ results: [], has_more: true, next_cursor: "cursor-2" });
    },
    {
      now: () => now,
      createTimeoutSignal: (timeoutMs) => {
        timeoutRequests.push(timeoutMs);
        return new AbortController().signal;
      },
    },
  );

  assert.equal(NOTION_DECISION_LOG_REQUEST_TIMEOUT_MS, 8_000);
  assert.equal(NOTION_DECISION_LOG_TOTAL_TIMEOUT_MS, 15_000);
  assert.deepEqual(timeoutRequests, [NOTION_DECISION_LOG_REQUEST_TIMEOUT_MS]);
  assert.equal(requestCount, 1);
  assert.equal(result.ok, false);
  assert.equal(result.code, "notion_unavailable");
});

test("classifies configuration, network, API and response failures without leaking secrets", async () => {
  let called = false;
  const missing = await loadNotionDecisionLog({}, async () => {
    called = true;
    return new Response();
  });
  assert.equal(called, false);
  assert.equal(missing.code, "missing_configuration");

  const environment = {
    NOTION_DECISION_LOG_TOKEN: "secret-test-token",
    NOTION_DECISION_LOG_DATA_SOURCE_ID: "source-id",
  };
  const network = await loadNotionDecisionLog(environment, async () => { throw new Error("secret-test-token"); });
  const api = await loadNotionDecisionLog(environment, async () => new Response("secret-test-token", { status: 403 }));
  const invalid = await loadNotionDecisionLog(environment, async () => Response.json({ value: [] }));
  const empty = await loadNotionDecisionLog(environment, async () => Response.json({ results: [] }));

  assert.equal(network.code, "notion_unavailable");
  assert.equal(api.code, "notion_unavailable");
  assert.equal(invalid.code, "invalid_response");
  assert.equal(network.message.includes("secret-test-token"), false);
  assert.equal(api.message.includes("secret-test-token"), false);
  assert.equal(empty.ok, true);
  assert.deepEqual(empty.entries, []);
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

test("productive workspace keeps the integration server-only and the UI accessible", async () => {
  const routes = await readFile("src/features/planning/model/workspace-routes.ts", "utf8");
  const workspacePage = await readFile("src/app/(workspaces)/workspace-page.tsx", "utf8");
  const overview = await readFile("src/features/decision-log/organisms/decision-log-overview.tsx", "utf8");
  const detail = await readFile("src/features/decision-log/molecules/decision-detail-panel.tsx", "utf8");
  const loader = await readFile("src/lib/notion-decision-log.ts", "utf8");

  assert.match(routes, /id: "decision-log"/);
  assert.match(routes, /href: "\/decision-log"/);
  assert.match(workspacePage, /\["ceo", "founder", "deputy", "viewer"\]/);
  assert.match(loader, /import "server-only"/);
  assert.match(loader, /cache: "no-store"/);
  assert.match(overview, /namespace: "decisions"/);
  assert.match(overview, /DECISION_LOG_PAGE_SIZE/);
  assert.match(overview, /Mehr anzeigen/);
  assert.match(overview, /decisionLogFilterKey\(filters\)/);
  assert.match(overview, /visibleRowsState\.filterKey !== filterKey/);
  assert.match(overview, /setVisibleRowsState\(\{ filterKey, limit: DECISION_LOG_PAGE_SIZE \}\)/);
  assert.match(overview, /aria-pressed=\{selected\}/);
  assert.match(overview, /aria-live="polite"/);
  assert.match(overview, /aria-label="Warum jetzt erklären"/);
  assert.match(overview, /role="tooltip"/);
  assert.match(overview, /Das Review-Datum allein zählt nicht/);
  assert.doesNotMatch(overview, /aria-selected=\{selected\}/);
  assert.match(overview, /DataTableFrame/);
  assert.match(detail, /useModalDialog/);
  assert.match(detail, /aria-modal="true"/);
  assert.match(detail, /Review-Datum/);
  assert.match(detail, /min-w-0 break-words/);
  assert.doesNotMatch(overview, /Review fällig/);
  assert.match(detail, /Zur Abstimmung|decisionLogFormLabel/);
});

test("decision log release is explained through a dedicated product update and tour", async () => {
  const updates = JSON.parse(
    await readFile("src/features/product-updates/model/product-updates.json", "utf8"),
  );
  const tourRegistry = await readFile(
    "src/features/product-tours/model/feature-tour-registry.ts",
    "utf8",
  );
  const update = updates.find((item) => item.id === "2026-07-21-decision-log");

  assert.equal(update?.featureTourId, "decision-log-workspace-v1");
  assert.equal(
    update?.slides[0]?.image.src,
    "/product-updates/2026-07-21-decision-log/decision-log.png",
  );
  assert.match(tourRegistry, /productUpdateId: "2026-07-21-decision-log"/);
  assert.match(tourRegistry, /workspace-nav-decision-log/);
  assert.match(tourRegistry, /doneWorkspace: "decision-log"/);
});
