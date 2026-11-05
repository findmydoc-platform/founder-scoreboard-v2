"use client";

import { gitHubBriefReferenceSegments, type GitHubBriefReferenceContext } from "@/lib/github-brief-references";
import { LinkifiedText } from "@/shared/atoms/linkified-text";

export function TaskBriefText({ value, context, checklistLine }: {
  value: string;
  context: GitHubBriefReferenceContext;
  checklistLine?: number;
}) {
  let start = 0;
  let end = value.length;
  if (checklistLine !== undefined) {
    const lines = value.split("\n");
    const raw = lines[checklistLine] || "";
    const content = raw.trim().replace(/^\s*[-*]?\s*\[[ xX]\]\s*/u, "");
    start = lines.slice(0, checklistLine).reduce((length, line) => length + line.length + 1, 0) + raw.indexOf(content);
    end = start + content.length;
  }
  const content = [];
  let cursor = 0;
  for (const [index, segment] of gitHubBriefReferenceSegments(value, context).entries()) {
    const segmentStart = cursor;
    cursor += segment.text.length;
    if (cursor <= start || segmentStart >= end) continue;
    const text = segment.text.slice(Math.max(0, start - segmentStart), Math.min(segment.text.length, end - segmentStart));
    content.push(segment.href ? (
      <a key={index} href={segment.href} target="_blank" rel="noopener noreferrer"
        aria-label={`${text} (öffnet in neuem Tab)`}
        className="font-semibold text-blue-600 underline-offset-2 [overflow-wrap:anywhere] hover:text-blue-700 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
      >{text}</a>
    ) : <LinkifiedText key={index} value={text} />);
  }
  return <>{content}</>;
}
