import type { NotionDecisionLogEntry } from "@/lib/notion-decision-log";

export const DECISION_LOG_PAGE_SIZE = 25;

export const decisionLogScopes = ["attention", "all", "decided", "archive"] as const;
export type DecisionLogScope = (typeof decisionLogScopes)[number];

export const decisionLogReasonKeys = [
  "decision_required",
  "vote_in_progress",
  "objections_open",
  "postponed",
  "confirmation_open",
  "review_open",
] as const;
export type DecisionLogReasonKey = (typeof decisionLogReasonKeys)[number];

export type DecisionLogAttentionReason = {
  key: DecisionLogReasonKey;
  label: string;
  explanation: string;
  tone: "amber" | "blue" | "orange" | "red" | "slate";
};

export type DecisionLogSort = "date" | "decision" | "status" | "owner";

export type DecisionLogFilters = {
  scope: DecisionLogScope;
  query: string;
  reasons: DecisionLogReasonKey[];
  categories: string[];
  sort: DecisionLogSort;
  direction: "asc" | "desc";
};

export const DEFAULT_DECISION_LOG_FILTERS: DecisionLogFilters = {
  scope: "attention",
  query: "",
  reasons: [],
  categories: [],
  sort: "date",
  direction: "desc",
};

export function decisionLogFilterKey(filters: DecisionLogFilters) {
  return JSON.stringify([
    filters.scope,
    filters.query,
    [...filters.reasons].sort(),
    [...filters.categories].sort((left, right) => left.localeCompare(right, "de")),
    filters.sort,
    filters.direction,
  ]);
}

export const decisionLogReasonOptions: Array<{ value: DecisionLogReasonKey; label: string }> = [
  { value: "decision_required", label: "Entscheidung erforderlich" },
  { value: "vote_in_progress", label: "In Abstimmung" },
  { value: "objections_open", label: "Einwände offen" },
  { value: "postponed", label: "Vertagt" },
  { value: "confirmation_open", label: "Bestätigung offen" },
  { value: "review_open", label: "Prüfung offen" },
];

function normalized(value: string) {
  return value
    .trim()
    .toLocaleLowerCase("de")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

export function isArchivedDecision(entry: NotionDecisionLogEntry) {
  return normalized(entry.status) === "archiviert";
}

export function isConfirmedDecision(entry: NotionDecisionLogEntry) {
  return ["bestatigt", "confirmed"].includes(normalized(entry.status));
}

function addReason(reasons: DecisionLogAttentionReason[], reason: DecisionLogAttentionReason) {
  if (!reasons.some((item) => item.key === reason.key)) reasons.push(reason);
}

export function decisionLogAttentionReasons(entry: NotionDecisionLogEntry) {
  const reasons: DecisionLogAttentionReason[] = [];
  const status = normalized(entry.status);
  const vote = normalized(entry.vote);
  const confirmation = normalized(entry.confirmation);
  const resolution = normalized(entry.resolution);
  const closed = isConfirmedDecision(entry) || isArchivedDecision(entry);

  if (!closed) {
    const resolutionOpen = !resolution || ["offen", "kein beschluss"].includes(resolution);
    if (status === "entwurf" || resolutionOpen) {
      addReason(reasons, {
        key: "decision_required",
        label: "Entscheidung erforderlich",
        explanation: "Der Beschluss ist noch nicht abschließend dokumentiert.",
        tone: "amber",
      });
    }
    if (vote === "in abstimmung") {
      addReason(reasons, {
        key: "vote_in_progress",
        label: "In Abstimmung",
        explanation: "Die Abstimmung ist noch offen.",
        tone: "blue",
      });
    }
    if (vote === "einwande offen") {
      addReason(reasons, {
        key: "objections_open",
        label: "Einwände offen",
        explanation: "Vor dem Beschluss müssen noch Einwände geklärt werden.",
        tone: "orange",
      });
    }
    if (vote === "vertagt") {
      addReason(reasons, {
        key: "postponed",
        label: "Vertagt",
        explanation: "Die Entscheidung wurde vertagt und benötigt einen neuen Abschluss.",
        tone: "orange",
      });
    }
    if (["offen", "form versendet", "teilweise bestatigt"].includes(confirmation)) {
      addReason(reasons, {
        key: "confirmation_open",
        label: "Bestätigung offen",
        explanation: "Die erforderliche Bestätigung ist noch nicht vollständig.",
        tone: "orange",
      });
    }
    if (status === "in prufung" && reasons.length === 0) {
      addReason(reasons, {
        key: "review_open",
        label: "Prüfung offen",
        explanation: "Die Entscheidung befindet sich noch in Prüfung.",
        tone: "slate",
      });
    }
  }

  return reasons;
}

export function decisionLogFormLabel(entry: NotionDecisionLogEntry) {
  return isConfirmedDecision(entry) || isArchivedDecision(entry)
    ? "Abstimmung ansehen ↗"
    : "Zur Abstimmung ↗";
}

function matchesScope(entry: NotionDecisionLogEntry, scope: DecisionLogScope) {
  if (scope === "attention") return decisionLogAttentionReasons(entry).length > 0;
  if (scope === "decided") return isConfirmedDecision(entry);
  if (scope === "archive") return isArchivedDecision(entry);
  return true;
}

function compareText(left: string, right: string, direction: "asc" | "desc") {
  return (direction === "asc" ? 1 : -1) * left.localeCompare(right, "de");
}

function compareOptional(left: string, right: string, direction: "asc" | "desc") {
  if (!left && !right) return 0;
  if (!left) return 1;
  if (!right) return -1;
  return compareText(left, right, direction);
}

function uniqueEntries(entries: NotionDecisionLogEntry[]) {
  const seen = new Set<string>();
  return entries.filter((entry) => {
    if (seen.has(entry.id)) return false;
    seen.add(entry.id);
    return true;
  });
}

export function buildDecisionLogViewModel({
  entries,
  filters: rawFilters,
}: {
  entries: NotionDecisionLogEntry[];
  filters: Partial<DecisionLogFilters>;
}) {
  const filters = { ...DEFAULT_DECISION_LOG_FILTERS, ...rawFilters };
  const decisions = uniqueEntries(entries);
  const reasonsById = new Map(decisions.map((entry) => [entry.id, decisionLogAttentionReasons(entry)]));
  const scopedEntries = decisions.filter((entry) => matchesScope(entry, filters.scope));
  const query = normalized(filters.query);
  const filteredEntries = scopedEntries
    .filter((entry) => !filters.reasons.length || filters.reasons.some((reason) => reasonsById.get(entry.id)?.some((item) => item.key === reason)))
    .filter((entry) => !filters.categories.length || filters.categories.includes(entry.category))
    .filter((entry) => !query || normalized([
      entry.decision,
      entry.summary,
      entry.resolution,
      entry.category,
      entry.status,
      entry.owners.join(" "),
      entry.decisionCircle.join(" "),
    ].join(" ")).includes(query))
    .map((entry, index) => ({ entry, index }))
    .sort((left, right) => {
      let result = 0;
      if (filters.sort === "decision") result = compareText(left.entry.decision, right.entry.decision, filters.direction);
      else if (filters.sort === "status") result = compareText(left.entry.status, right.entry.status, filters.direction);
      else if (filters.sort === "owner") result = compareText(left.entry.owners.join(", "), right.entry.owners.join(", "), filters.direction);
      else result = compareOptional(left.entry.date, right.entry.date, filters.direction);
      return result || left.index - right.index;
    })
    .map(({ entry }) => entry);

  return {
    entries: decisions,
    scopedEntries,
    filteredEntries,
    reasonsById,
    categories: Array.from(new Set(decisions.map((entry) => entry.category).filter(Boolean))).sort((left, right) => left.localeCompare(right, "de")),
    counts: {
      attention: decisions.filter((entry) => matchesScope(entry, "attention")).length,
      all: decisions.filter((entry) => matchesScope(entry, "all")).length,
      decided: decisions.filter((entry) => matchesScope(entry, "decided")).length,
      archive: decisions.filter((entry) => matchesScope(entry, "archive")).length,
    },
  };
}

export function visibleDecisionLogEntries(entries: NotionDecisionLogEntry[], limit: number) {
  return entries.slice(0, Math.max(0, limit));
}
