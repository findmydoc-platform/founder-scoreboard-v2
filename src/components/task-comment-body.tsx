"use client";

import { GitHubCommentImage } from "@/components/github-comment-image";

type MarkdownPart =
  | { type: "text"; text: string }
  | { type: "link"; text: string; href: string }
  | { type: "image"; alt: string; href: string };

function decodeHtmlEntities(value: string) {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function safeUrl(value: string) {
  try {
    const url = new URL(decodeHtmlEntities(value.trim()));
    if (url.protocol === "https:" || url.protocol === "http:") return url.toString();
  } catch {
    return "";
  }
  return "";
}

function isImageUrl(value: string) {
  const url = safeUrl(value);
  if (!url) return false;
  try {
    const parsed = new URL(url);
    return /\.(png|jpe?g|gif|webp|svg)(?:$|[?#])/i.test(parsed.pathname)
      || parsed.hostname.endsWith("githubusercontent.com")
      || parsed.hostname === "github.com" && parsed.pathname.includes("/user-attachments/assets/");
  } catch {
    return false;
  }
}

function pushInlineText(parts: MarkdownPart[], value: string) {
  if (value) parts.push({ type: "text", text: value });
}

function renderMarkdownParts(line: string) {
  const parts: MarkdownPart[] = [];
  const pattern = /<img\b[^>]*\balt=["']([^"']*)["'][^>]*\bsrc=["'](https?:\/\/[^"']+)["'][^>]*>|<img\b[^>]*\bsrc=["'](https?:\/\/[^"']+)["'][^>]*>|!\[([^\]]*)\]\((https?:\/\/[^)\s"'>]+)\)|\[([^\]]+)\]\((https?:\/\/[^)\s"'>]+)\)|(https?:\/\/[^\s)"'>]+)/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(line)) !== null) {
    pushInlineText(parts, line.slice(lastIndex, match.index));
    if (match[2]) {
      parts.push({ type: "image", alt: match[1] || "Anhang", href: safeUrl(match[2]) });
    } else if (match[3]) {
      parts.push({ type: "image", alt: "Anhang", href: safeUrl(match[3]) });
    } else if (match[5]) {
      parts.push({ type: "image", alt: match[4] || "Anhang", href: safeUrl(match[5]) });
    } else if (match[7]) {
      parts.push({ type: "link", text: match[6], href: safeUrl(match[7]) });
    } else if (match[8]) {
      const href = safeUrl(match[8]);
      parts.push(isImageUrl(href) ? { type: "image", alt: "Anhang", href } : { type: "link", text: href, href });
    }
    lastIndex = pattern.lastIndex;
  }

  pushInlineText(parts, line.slice(lastIndex));
  return parts.filter((part) => part.type === "text" || Boolean(part.href));
}

export function CommentBody({ value }: { value: string }) {
  const lines = value.split(/\r?\n/);

  return (
    <div className="mt-1 grid gap-1.5 text-sm leading-6 text-slate-700">
      {lines.map((line, lineIndex) => {
        const parts = renderMarkdownParts(line);
        if (!parts.length) return <div key={`line-${lineIndex}`} className="h-2" />;

        return (
          <div key={`line-${lineIndex}`} className="break-words">
            {parts.map((part, partIndex) => {
              if (part.type === "text") return <span key={partIndex}>{part.text}</span>;
              if (part.type === "link") {
                return (
                  <a key={partIndex} href={part.href} target="_blank" rel="noreferrer" className="font-semibold text-blue-600 hover:text-blue-700">
                    {part.text}
                  </a>
                );
              }
              return <GitHubCommentImage key={`${part.href}-${partIndex}`} href={part.href} alt={part.alt} />;
            })}
          </div>
        );
      })}
    </div>
  );
}
