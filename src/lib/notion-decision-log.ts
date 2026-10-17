import "server-only";

import type { NotionDecisionLogCapability } from "./credentials/notion-types";

type NotionPage = {
  id?: unknown;
  object?: unknown;
  properties?: unknown;
  url?: unknown;
};

export type NotionDecisionLogEntry = {
  id: string;
  notionUrl: string;
  decision: string;
  date: string;
  status: string;
  category: string;
  owners: string[];
  summary: string;
  resolution: string;
  requiredApproval: string;
  vote: string;
  confirmation: string;
  decisionCircle: string[];
  reviewDate: string;
  sourceUrl: string;
  googleFormUrl: string;
  pdfArchiveUrl: string;
};

export type NotionDecisionLogResult =
  | {
      ok: true;
      entries: NotionDecisionLogEntry[];
      fetchedAt: string;
    }
  | {
      ok: false;
      code: "missing_configuration" | "notion_unavailable" | "invalid_response";
      fetchedAt: string;
      message: string;
    };

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function notionProperty(properties: unknown, name: string) {
  if (!isRecord(properties)) return {};
  const value = properties[name];
  return isRecord(value) ? value : {};
}

function richText(value: unknown) {
  if (!Array.isArray(value)) return "";
  return value
    .map((item) => isRecord(item) && typeof item.plain_text === "string" ? item.plain_text : "")
    .join("")
    .trim();
}

function optionName(value: unknown) {
  return isRecord(value) && typeof value.name === "string" ? value.name.trim() : "";
}

function textProperty(properties: unknown, name: string) {
  const value = notionProperty(properties, name);
  return richText(value.title)
    || richText(value.rich_text)
    || optionName(value.select)
    || optionName(value.status);
}

function dateProperty(properties: unknown, name: string) {
  const value = notionProperty(properties, name);
  return isRecord(value.date) && typeof value.date.start === "string" ? value.date.start : "";
}

function peopleProperty(properties: unknown, name: string) {
  const value = notionProperty(properties, name);
  if (!Array.isArray(value.people)) return [];
  return value.people
    .map((person) => isRecord(person) && typeof person.name === "string" ? person.name.trim() : "")
    .filter(Boolean);
}

export function safeDecisionLogUrl(value: unknown) {
  if (typeof value !== "string" || !value.trim()) return "";
  try {
    const url = new URL(value.trim());
    return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : "";
  } catch {
    return "";
  }
}

function urlProperty(properties: unknown, name: string) {
  const value = notionProperty(properties, name);
  if (typeof value.url === "string") return safeDecisionLogUrl(value.url);
  if (isRecord(value.formula) && typeof value.formula.string === "string") {
    return safeDecisionLogUrl(value.formula.string);
  }
  return "";
}

export function mapNotionDecisionLogEntry(page: unknown): NotionDecisionLogEntry | null {
  if (!isRecord(page) || page.object !== "page") return null;
  const typedPage = page as NotionPage;
  const id = typeof typedPage.id === "string" ? typedPage.id.trim() : "";
  if (!id) return null;
  const properties = typedPage.properties;

  return {
    id,
    notionUrl: safeDecisionLogUrl(typedPage.url),
    decision: textProperty(properties, "Decision") || "Ohne Titel",
    date: dateProperty(properties, "Datum"),
    status: textProperty(properties, "Status"),
    category: textProperty(properties, "Kategorie"),
    owners: peopleProperty(properties, "Owner"),
    summary: textProperty(properties, "Kurzfassung"),
    resolution: textProperty(properties, "Beschluss"),
    requiredApproval: textProperty(properties, "Erforderliche Zustimmung"),
    vote: textProperty(properties, "Abstimmung"),
    confirmation: textProperty(properties, "Bestätigung"),
    decisionCircle: peopleProperty(properties, "Entscheidungskreis"),
    reviewDate: dateProperty(properties, "Review"),
    sourceUrl: urlProperty(properties, "Quelle / Meeting"),
    googleFormUrl: urlProperty(properties, "Google Form"),
    pdfArchiveUrl: urlProperty(properties, "PDF Archiv"),
  };
}

function invalidResponse(fetchedAt: string): NotionDecisionLogResult {
  return {
    ok: false,
    code: "invalid_response",
    fetchedAt,
    message: "Notion hat eine unerwartete Antwort geliefert.",
  };
}

function notionUnavailable(fetchedAt: string): NotionDecisionLogResult {
  return {
    ok: false,
    code: "notion_unavailable",
    fetchedAt,
    message: "Notion ist gerade nicht erreichbar.",
  };
}

export async function loadNotionDecisionLog(notion: NotionDecisionLogCapability | null): Promise<NotionDecisionLogResult> {
  const fetchedAt = new Date().toISOString();
  if (!notion) return { ok: false, code: "missing_configuration", fetchedAt, message: "Die Notion-Konfiguration für das Decision Log fehlt." };

  const entries: NotionDecisionLogEntry[] = [];
  const seenCursors = new Set<string>();
  let cursor = "";

  do {
    let response: Awaited<ReturnType<NotionDecisionLogCapability["queryPage"]>>;
    try { response = await notion.queryPage(cursor); }
    catch { return notionUnavailable(fetchedAt); }

    if (!response.ok) {
      return {
        ok: false,
        code: "notion_unavailable",
        fetchedAt,
        message: "Der Zugriff auf das Notion Decision Log ist fehlgeschlagen.",
      };
    }

    const payload = response.payload;
    if (!isRecord(payload) || !Array.isArray(payload.results)) return invalidResponse(fetchedAt);

    entries.push(...payload.results
      .map(mapNotionDecisionLogEntry)
      .filter((entry): entry is NotionDecisionLogEntry => Boolean(entry)));

    if (payload.has_more !== true) break;
    if (typeof payload.next_cursor !== "string" || !payload.next_cursor || seenCursors.has(payload.next_cursor)) {
      return invalidResponse(fetchedAt);
    }
    cursor = payload.next_cursor;
    seenCursors.add(cursor);
  } while (cursor);

  return {
    ok: true,
    entries: entries.sort((left, right) => (
      right.date.localeCompare(left.date)
      || left.decision.localeCompare(right.decision, "de")
      || left.id.localeCompare(right.id)
    )),
    fetchedAt,
  };
}
