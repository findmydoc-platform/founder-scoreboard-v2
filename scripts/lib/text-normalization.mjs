export function normalizeWords(value) {
  return String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

export function normalizeWordsWithoutQuotes(value) {
  return normalizeWords(String(value || "").replace(/[`'"]/g, ""));
}
