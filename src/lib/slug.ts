export type SlugifyOptions = {
  separator?: "-" | " ";
  maxLength?: number;
};

export function normalizeAscii(value: string) {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

export function slugify(value: string | null | undefined, options: SlugifyOptions = {}) {
  const separator = options.separator || "-";
  const repeatedSeparator = separator === "-" ? /-+/g : /\s+/g;
  const edgeSeparator = separator === "-" ? /^-+|-+$/g : /^\s+|\s+$/g;
  const normalized = normalizeAscii(value || "")
    .replace(/[^a-z0-9]+/g, separator)
    .replace(repeatedSeparator, separator)
    .replace(edgeSeparator, "");

  return options.maxLength ? normalized.slice(0, options.maxLength) : normalized;
}

export function normalizeLookup(value: string | null | undefined) {
  return (value || "").trim().toLowerCase();
}

export function compactAlphanumeric(value: string | null | undefined) {
  return normalizeAscii(value || "").replace(/[^a-z0-9]/g, "");
}
