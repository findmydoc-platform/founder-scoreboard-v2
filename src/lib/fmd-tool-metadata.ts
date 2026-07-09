import { Buffer } from "node:buffer";
import { lookup } from "node:dns/promises";
import net from "node:net";

export type FmdToolMetadata = {
  title: string;
  description: string;
  imageUrl: string;
  siteName: string;
};

const blockedHostnames = new Set([
  "localhost",
  "localhost.localdomain",
  "ip6-localhost",
  "ip6-loopback",
]);
const maxRedirects = 4;
const metadataTimeoutMs = 5000;
const maxHtmlBytes = 256 * 1024;

export function cleanMetadataText(value: string, maxLength: number) {
  return value
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

export function normalizeMetadataUrl(value: string, baseUrl?: string) {
  try {
    const url = baseUrl ? new URL(value, baseUrl) : new URL(value);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    url.hash = "";
    return url;
  } catch {
    return null;
  }
}

export function isBlockedHostname(hostname: string) {
  const normalized = hostname.toLowerCase().replace(/\.$/, "");
  return blockedHostnames.has(normalized)
    || normalized.endsWith(".localhost")
    || normalized.endsWith(".local")
    || normalized.endsWith(".internal")
    || !normalized.includes(".");
}

export function isPrivateIpAddress(address: string) {
  const normalized = address.toLowerCase();
  if (normalized === "::1") return true;
  if (normalized.startsWith("fc") || normalized.startsWith("fd") || normalized.startsWith("fe80:")) return true;
  if (normalized.startsWith("::ffff:")) return isPrivateIpAddress(normalized.slice(7));

  if (net.isIP(normalized) === 4) {
    const [first = 0, second = 0] = normalized.split(".").map((part) => Number(part));
    if (first === 10 || first === 127 || first === 0) return true;
    if (first === 169 && second === 254) return true;
    if (first === 172 && second >= 16 && second <= 31) return true;
    if (first === 192 && second === 168) return true;
    return false;
  }

  return false;
}

export async function assertPublicHttpUrl(url: URL) {
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error("URL muss mit http:// oder https:// beginnen.");
  }
  if (isBlockedHostname(url.hostname)) {
    throw new Error("Interne oder lokale URLs werden nicht unterstützt.");
  }

  if (net.isIP(url.hostname)) {
    if (isPrivateIpAddress(url.hostname)) throw new Error("Interne oder lokale URLs werden nicht unterstützt.");
    return;
  }

  const addresses = await lookup(url.hostname, { all: true, verbatim: true }).catch(() => []);
  if (!addresses.length) throw new Error("URL konnte nicht geprüft werden.");
  if (addresses.some((entry) => isPrivateIpAddress(entry.address))) {
    throw new Error("Interne oder lokale URLs werden nicht unterstützt.");
  }
}

function metaContent(html: string, attribute: "property" | "name", value: string) {
  const pattern = new RegExp(`<meta\\s+[^>]*${attribute}=["']${escapeRegex(value)}["'][^>]*>`, "i");
  const tag = html.match(pattern)?.[0] || "";
  return tag.match(/\scontent=["']([^"']*)["']/i)?.[1] || "";
}

function titleContent(html: string) {
  return html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || "";
}

function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function readLimitedText(response: Response) {
  if (!response.body) return "";

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;

  while (bytes <= maxHtmlBytes) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    if (bytes > maxHtmlBytes) {
      await reader.cancel();
      throw new Error("Metadaten-Antwort ist zu groß.");
    }
    chunks.push(value);
  }

  return new TextDecoder("utf-8", { fatal: false }).decode(Buffer.concat(chunks));
}

async function fetchMetadataHtml(url: URL, redirectCount = 0): Promise<{ html: string; finalUrl: string }> {
  await assertPublicHttpUrl(url);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), metadataTimeoutMs);

  try {
    const response = await fetch(url, {
      headers: {
        accept: "text/html,application/xhtml+xml",
        "user-agent": "FounderOps Quicklinks Metadata",
      },
      redirect: "manual",
      signal: controller.signal,
      cache: "no-store",
    });

    if ([301, 302, 303, 307, 308].includes(response.status)) {
      if (redirectCount >= maxRedirects) throw new Error("Zu viele Weiterleitungen.");
      const location = response.headers.get("location");
      const redirectedUrl = location ? normalizeMetadataUrl(location, url.toString()) : null;
      if (!redirectedUrl) throw new Error("Weiterleitung konnte nicht gelesen werden.");
      return fetchMetadataHtml(redirectedUrl, redirectCount + 1);
    }

    if (!response.ok) throw new Error(`Metadaten konnten nicht geladen werden (${response.status}).`);

    const contentType = response.headers.get("content-type")?.toLowerCase() || "";
    if (contentType && !contentType.includes("text/html") && !contentType.includes("application/xhtml")) {
      throw new Error("URL liefert keine HTML-Metadaten.");
    }

    return { html: await readLimitedText(response), finalUrl: url.toString() };
  } finally {
    clearTimeout(timeout);
  }
}

export async function loadFmdToolMetadata(value: string): Promise<FmdToolMetadata> {
  const url = normalizeMetadataUrl(value);
  if (!url) throw new Error("URL muss mit http:// oder https:// beginnen.");

  const { html, finalUrl } = await fetchMetadataHtml(url);
  const imageUrl = normalizeMetadataUrl(
    metaContent(html, "property", "og:image")
      || metaContent(html, "name", "twitter:image"),
    finalUrl,
  );

  if (imageUrl) await assertPublicHttpUrl(imageUrl);

  return {
    title: cleanMetadataText(
      metaContent(html, "property", "og:title")
        || metaContent(html, "name", "twitter:title")
        || titleContent(html),
      160,
    ),
    description: cleanMetadataText(
      metaContent(html, "property", "og:description")
        || metaContent(html, "name", "description")
        || metaContent(html, "name", "twitter:description"),
      500,
    ),
    imageUrl: imageUrl?.toString() || "",
    siteName: cleanMetadataText(metaContent(html, "property", "og:site_name"), 120),
  };
}
