import { fromMarkdown } from "mdast-util-from-markdown";

export const taskBriefFields = [
  "description", "problemStatement", "intendedOutcome", "scopeConstraints",
  "acceptanceCriteria", "evidenceRequired", "definitionOfDone",
] as const;

export type LinkedTaskBrief = Record<(typeof taskBriefFields)[number], string>;
export type GitHubBriefReferenceContext = {
  githubRepo?: string;
  repositories?: readonly string[];
};
export type GitHubBriefReferenceSegment = { text: string; href?: string };

type MarkdownNode = {
  type: string;
  position?: { start: { offset?: number }; end: { offset?: number } };
  children?: readonly MarkdownNode[];
};
const protectedNodeTypes = new Set(["code", "inlineCode", "link", "linkReference", "image", "imageReference", "definition"]);

function protectedMarkdownRanges(value: string) {
  const ranges: { start: number; end: number }[] = [];
  const visit = (node: MarkdownNode) => {
    if (protectedNodeTypes.has(node.type) && node.position?.start.offset !== undefined && node.position.end.offset !== undefined) {
      ranges.push({ start: node.position.start.offset, end: node.position.end.offset });
      return;
    }
    node.children?.forEach(visit);
  };
  visit(fromMarkdown(value));
  for (const match of value.matchAll(/(?<![A-Za-z0-9+.-])[A-Za-z][A-Za-z0-9+.-]*:\/\/[^\s<>]+/gu)) {
    ranges.push({ start: match.index, end: match.index + match[0].length });
  }
  return ranges.sort((left, right) => left.start - right.start || right.end - left.end);
}

function referenceSegments(value: string, context: GitHubBriefReferenceContext): GitHubBriefReferenceSegment[] {
  const segments: GitHubBriefReferenceSegment[] = [];
  let cursor = 0;
  for (const match of value.matchAll(/[\p{L}\p{M}\p{N}_./@#\\+-]+/gu)) {
    const token = match[0].replace(/\.+$/u, "");
    const qualifiedToken = token.startsWith("#") && context.githubRepo ? `${context.githubRepo}${token}` : token;
    const reference = /^([A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?)\/([A-Za-z0-9_.-]{1,100})#([0-9]+)$/u.exec(qualifiedToken);
    if (!reference || !/[1-9]/u.test(reference[3]) || [".", ".."].includes(reference[2])) continue;
    const start = match.index;
    if (start > cursor) segments.push({ text: value.slice(cursor, start) });
    segments.push({ text: token, href: `https://github.com/${reference[1]}/${reference[2]}/issues/${reference[3]}` });
    cursor = start + token.length;
  }
  if (cursor < value.length) segments.push({ text: value.slice(cursor) });
  return segments;
}

export function gitHubBriefReferenceSegments(value: string, context: GitHubBriefReferenceContext = {}): GitHubBriefReferenceSegment[] {
  const segments: GitHubBriefReferenceSegment[] = [];
  let cursor = 0;
  for (const range of protectedMarkdownRanges(value)) {
    if (range.end <= cursor) continue;
    if (range.start > cursor) segments.push(...referenceSegments(value.slice(cursor, range.start), context));
    segments.push({ text: value.slice(Math.max(cursor, range.start), range.end) });
    cursor = range.end;
  }
  segments.push(...referenceSegments(value.slice(cursor), context));
  return segments;
}

export function linkGitHubBriefReferences(value: string, context: GitHubBriefReferenceContext = {}): string {
  return gitHubBriefReferenceSegments(value, context)
    .map(({ text, href }) => href ? `[${text}](${href})` : text).join("");
}

export function linkedTaskBrief(brief: Partial<Record<(typeof taskBriefFields)[number], unknown>>, context: GitHubBriefReferenceContext = {}): LinkedTaskBrief {
  return Object.fromEntries(taskBriefFields.map((field) => [field,
    linkGitHubBriefReferences(typeof brief[field] === "string" ? brief[field] as string : "", context),
  ])) as LinkedTaskBrief;
}
