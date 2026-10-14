"use client";

import type { ReactNode } from "react";

const trailingPunctuation = /[.,!?;:]$/u;
const closingBrackets: Record<string, string> = {
  ")": "(",
  "]": "[",
  "}": "{",
};

function splitTrailingPunctuation(candidate: string) {
  let url = candidate;
  let suffix = "";

  while (trailingPunctuation.test(url)) {
    suffix = `${url.at(-1)}${suffix}`;
    url = url.slice(0, -1);
  }

  while (url.length > 0) {
    const closing = url.at(-1) || "";
    const opening = closingBrackets[closing];
    if (!opening) break;
    const closingCount = [...url].filter((character) => character === closing).length;
    const openingCount = [...url].filter((character) => character === opening).length;
    if (closingCount <= openingCount) break;
    suffix = `${closing}${suffix}`;
    url = url.slice(0, -1);
  }

  return { url, suffix };
}

function isHttpUrl(value: string) {
  try {
    const url = new URL(value);
    return (url.protocol === "http:" || url.protocol === "https:") && Boolean(url.hostname);
  } catch {
    return false;
  }
}

export function LinkifiedText({ value }: { value: string }) {
  const parts: ReactNode[] = [];
  let cursor = 0;
  let key = 0;

  for (const match of value.matchAll(/https?:\/\/[^\s<>"'`]+/giu)) {
    const index = match.index ?? 0;
    const candidate = match[0];
    const { url, suffix } = splitTrailingPunctuation(candidate);
    if (!isHttpUrl(url)) continue;

    if (index > cursor) parts.push(value.slice(cursor, index));
    parts.push(
      <a
        key={`url-${key++}`}
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        aria-label={`${url} (öffnet in neuem Tab)`}
        className="font-semibold text-blue-600 underline-offset-2 [overflow-wrap:anywhere] hover:text-blue-700 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
      >
        {url}
      </a>,
    );
    if (suffix) parts.push(suffix);
    cursor = index + candidate.length;
  }

  if (!parts.length) return <>{value}</>;
  if (cursor < value.length) parts.push(value.slice(cursor));
  return <>{parts}</>;
}
