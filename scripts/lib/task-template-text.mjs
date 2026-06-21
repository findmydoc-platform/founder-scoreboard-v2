import { resolve } from "node:path";

export function cleanText(value) {
  return typeof value === "string" ? value.trim() : "";
}

export function firstSentence(value) {
  const text = cleanText(value).replace(/\s+/g, " ");
  if (!text) return "";
  const match = text.match(/^(.+?[.!?])\s/);
  return match ? match[1] : text;
}

export function ensurePeriod(value) {
  const text = cleanText(value);
  if (!text) return "";
  return /[.!?]$/.test(text) ? text : `${text}.`;
}

export function compactText(value, max = 900) {
  const text = cleanText(value).replace(/\s+/g, " ");
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1).trim()}…`;
}

export function includesAny(text, terms) {
  const lower = `${text}`.toLowerCase();
  return terms.some((term) => lower.includes(term));
}

export function hasQuestionMarkReplacement(value) {
  const text = cleanText(value);
  return /[A-Za-zÄÖÜäöüß]\?[A-Za-zÄÖÜäöüß]/.test(text);
}

export function hasSuspiciousEncoding(value) {
  const text = cleanText(value);
  return hasQuestionMarkReplacement(text) || text.includes("Ã") || text.includes("Â");
}

export function taskTemplateBackupPath(prefix) {
  return resolve(
    process.cwd(),
    "docs",
    `${prefix}-${new Date().toISOString().replace(/[:.]/g, "-")}.json`,
  );
}
