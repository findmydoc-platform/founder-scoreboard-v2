export const MAX_EVIDENCE_LINKS = 20;

export type EvidenceLinkProvider = "github" | "notion" | "web";

type EvidenceLinkNormalization =
  | { ok: true; links: string[] }
  | { ok: false; error: string };

export function parseEvidenceUrl(value: string) {
  try {
    const url = new URL(value.trim());
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return url;
  } catch {
    return null;
  }
}

export function normalizeEvidenceLinkList(value: unknown): EvidenceLinkNormalization {
  if (!Array.isArray(value)) {
    return { ok: false, error: "Nachweis-Links müssen als Liste übergeben werden." };
  }

  const populated = value.flatMap((entry) => {
    if (typeof entry !== "string") return [entry];
    const trimmed = entry.trim();
    return trimmed ? [trimmed] : [];
  });
  if (populated.some((entry) => typeof entry !== "string")) {
    return { ok: false, error: "Jeder Nachweis-Link muss eine URL sein." };
  }
  if (populated.length > MAX_EVIDENCE_LINKS) {
    return { ok: false, error: `Es können höchstens ${MAX_EVIDENCE_LINKS} Nachweis-Links gespeichert werden.` };
  }

  const links: string[] = [];
  const seen = new Set<string>();
  for (const entry of populated as string[]) {
    const url = parseEvidenceUrl(entry);
    if (!url) {
      return { ok: false, error: "Bitte nur vollständige http- oder https-URLs als Nachweis speichern." };
    }
    if (url.href.length > 2048) {
      return { ok: false, error: "Ein Nachweis-Link darf höchstens 2048 Zeichen lang sein." };
    }
    const key = url.href.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    links.push(url.href);
  }

  return { ok: true, links };
}

export function evidenceLinkFields(values: string[]) {
  const fields = values.slice(0, MAX_EVIDENCE_LINKS);
  while (fields.length > 1 && !fields.at(-1)?.trim() && !fields.at(-2)?.trim()) {
    fields.pop();
  }
  if (!fields.length) return [""];
  if (fields.at(-1)?.trim() && fields.length < MAX_EVIDENCE_LINKS) fields.push("");
  return fields;
}

export function evidenceLinkProvider(value: string): EvidenceLinkProvider {
  const url = parseEvidenceUrl(value);
  const hostname = url?.hostname.toLowerCase().replace(/^www\./u, "") || "";
  if (hostname === "github.com" || hostname.endsWith(".github.com")) return "github";
  if (hostname === "notion.so" || hostname.endsWith(".notion.so") || hostname === "notion.site" || hostname.endsWith(".notion.site")) {
    return "notion";
  }
  return "web";
}

export function evidenceLinkPresentation(value: string) {
  const url = parseEvidenceUrl(value);
  if (!url) return { host: "", label: value, provider: "web" as const };
  const host = url.hostname.replace(/^www\./u, "");
  const provider = evidenceLinkProvider(value);
  return {
    host,
    label: provider === "github" ? "GitHub" : provider === "notion" ? "Notion" : host,
    provider,
  };
}
