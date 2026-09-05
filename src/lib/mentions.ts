export type MentionProfile = {
  id: string;
  name?: string | null;
  githubLogin?: string | null;
};

export type ActiveMarkdownMention = {
  query: string;
  start: number;
  end: number;
};

export type MentionReplacement = {
  value: string;
  caret: number;
};

const gitHubMentionPatternSource = String.raw`(^|[^A-Za-z0-9])@([A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?)(?![A-Za-z0-9_-]|\.[A-Za-z0-9])`;

function gitHubMentionMatches(segment: string) {
  return segment.matchAll(new RegExp(gitHubMentionPatternSource, "g"));
}

function mentionSearchKey(value: string) {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function githubLoginKey(value: string) {
  return value.trim().toLowerCase();
}

function exactGitHubProfile(login: string, profiles: MentionProfile[]) {
  const key = githubLoginKey(login);
  const matches = profiles.filter((profile) => (
    profile.id
    && profile.githubLogin
    && githubLoginKey(profile.githubLogin) === key
  ));
  return matches.length === 1 ? matches[0] : null;
}

function profileNameWords(profile: MentionProfile) {
  return (profile.name || "")
    .split(/\s+/u)
    .map(mentionSearchKey)
    .filter(Boolean);
}

function uniqueGitHubProfiles(profiles: MentionProfile[]) {
  const profileCounts = new Map<string, number>();
  for (const profile of profiles) {
    if (!profile.id || !profile.githubLogin?.trim()) continue;
    const login = githubLoginKey(profile.githubLogin);
    profileCounts.set(login, (profileCounts.get(login) || 0) + 1);
  }
  return profiles.filter((profile) => (
    Boolean(profile.id && profile.githubLogin?.trim())
    && profileCounts.get(githubLoginKey(profile.githubLogin || "")) === 1
  ));
}

function exactMentionedProfileIds(comment: string, profiles: MentionProfile[]) {
  const matches = new Set<string>();
  mapMarkdownText(comment, (segment) => {
    for (const match of gitHubMentionMatches(segment)) {
      const profile = exactGitHubProfile(match[2] || "", profiles);
      if (profile?.id) matches.add(profile.id);
    }
    return segment;
  });
  return [...matches];
}

export function mentionedProfileIds(comment: string, profiles: MentionProfile[]) {
  return exactMentionedProfileIds(comment, profiles);
}

export function mentionSuggestions(query: string, profiles: MentionProfile[]) {
  const normalizedQuery = mentionSearchKey(query);
  return uniqueGitHubProfiles(profiles)
    .filter((profile) => {
      if (!normalizedQuery) return true;
      const login = githubLoginKey(profile.githubLogin || "");
      const name = mentionSearchKey(profile.name || "");
      return login.includes(normalizedQuery) || name.includes(normalizedQuery);
    })
    .sort((left, right) => {
      const rank = (profile: MentionProfile) => {
        if (!normalizedQuery) return 0;
        const login = githubLoginKey(profile.githubLogin || "");
        const name = mentionSearchKey(profile.name || "");
        if (login === normalizedQuery) return 0;
        if (profileNameWords(profile).some((word) => word.startsWith(normalizedQuery))) return 1;
        if (login.startsWith(normalizedQuery)) return 2;
        if (name.includes(normalizedQuery)) return 3;
        return 4;
      };
      const rankDifference = rank(left) - rank(right);
      if (rankDifference) return rankDifference;
      const nameDifference = (left.name || left.githubLogin || "").localeCompare(right.name || right.githubLogin || "", "de");
      return nameDifference || githubLoginKey(left.githubLogin || "").localeCompare(githubLoginKey(right.githubLogin || ""));
    });
}

function isMarkdownTextPosition(value: string, position: number) {
  let cursor = 0;
  while (cursor < value.length) {
    const protectedEnd = markdownProtectedEnd(value, cursor);
    if (protectedEnd) {
      if (position >= cursor && position < protectedEnd) return false;
      cursor = protectedEnd;
      continue;
    }
    cursor += 1;
  }
  return true;
}

export function activeMarkdownMention(value: string, selectionStart: number, selectionEnd = selectionStart): ActiveMarkdownMention | null {
  if (selectionStart !== selectionEnd) return null;
  const caret = Math.max(0, Math.min(selectionStart, value.length));
  let tokenStart = caret;
  while (tokenStart > 0 && /[A-Za-z0-9._-]/.test(value[tokenStart - 1] || "")) tokenStart -= 1;
  const at = tokenStart - 1;
  if (at < 0 || value[at] !== "@") return null;
  if (at > 0 && /[A-Za-z0-9]/.test(value[at - 1] || "")) return null;
  if (!isMarkdownTextPosition(value, at)) return null;

  let end = caret;
  while (end < value.length && /[A-Za-z0-9._-]/.test(value[end] || "")) end += 1;
  return { query: value.slice(tokenStart, caret), start: at, end };
}

export function replaceActiveMention(value: string, active: ActiveMarkdownMention | null, profile: MentionProfile): MentionReplacement | null {
  if (!active || !profile.githubLogin?.trim()) return null;
  const login = profile.githubLogin.trim();
  const before = value.slice(0, active.start);
  const after = value.slice(active.end);
  const separator = /^[\s]/u.test(after) ? "" : " ";
  const mention = `@${login}${separator}`;
  return { value: `${before}${mention}${after}`, caret: before.length + mention.length };
}

export function githubMentionContext(comment: string, profiles: MentionProfile[], authorLogin: string) {
  const actorProfileId = exactGitHubProfile(authorLogin, profiles)?.id || "";
  return { actorProfileId, recipientProfileIds: exactMentionedProfileIds(comment, profiles) };
}

function fencedCodeEnd(value: string, index: number) {
  if (index > 0 && value[index - 1] !== "\n") return 0;
  const openingLineEnd = value.indexOf("\n", index);
  const lineEnd = openingLineEnd < 0 ? value.length : openingLineEnd;
  const opening = value.slice(index, lineEnd).match(/^[ \t]{0,3}(`{3,}|~{3,})/u);
  if (!opening) return 0;

  const marker = opening[1];
  const closingPattern = new RegExp(`^[ \\t]{0,3}${marker[0]}{${marker.length},}[ \\t]*$`, "u");
  let cursor = openingLineEnd < 0 ? value.length : openingLineEnd + 1;
  while (cursor < value.length) {
    const nextLineEnd = value.indexOf("\n", cursor);
    const closingLineEnd = nextLineEnd < 0 ? value.length : nextLineEnd;
    if (closingPattern.test(value.slice(cursor, closingLineEnd))) {
      return nextLineEnd < 0 ? closingLineEnd : closingLineEnd + 1;
    }
    cursor = nextLineEnd < 0 ? value.length : nextLineEnd + 1;
  }
  return value.length;
}

function markdownLinkEnd(value: string, index: number) {
  const labelStart = value[index] === "!" ? index + 1 : index;
  if (value[labelStart] !== "[") return 0;

  let bracketDepth = 1;
  let cursor = labelStart + 1;
  for (; cursor < value.length && bracketDepth > 0; cursor += 1) {
    if (value[cursor] === "\\") cursor += 1;
    else if (value[cursor] === "[") bracketDepth += 1;
    else if (value[cursor] === "]") bracketDepth -= 1;
  }
  if (bracketDepth) return 0;
  if (value[cursor] === "[") {
    const referenceEnd = value.indexOf("]", cursor + 1);
    return referenceEnd < 0 ? value.length : referenceEnd + 1;
  }
  if (value[cursor] !== "(") return cursor;

  let parenthesisDepth = 1;
  cursor += 1;
  for (; cursor < value.length && parenthesisDepth > 0; cursor += 1) {
    if (value[cursor] === "\\") cursor += 1;
    else if (value[cursor] === "(") parenthesisDepth += 1;
    else if (value[cursor] === ")") parenthesisDepth -= 1;
  }
  return parenthesisDepth === 0 ? cursor : value.length;
}

function markdownProtectedEnd(value: string, index: number) {
  const fenceEnd = fencedCodeEnd(value, index);
  if (fenceEnd) return fenceEnd;

  if ((index === 0 || value[index - 1] === "\n") && /^[ \t]{0,3}>/u.test(value.slice(index))) {
    const lineEnd = value.indexOf("\n", index);
    return lineEnd < 0 ? value.length : lineEnd + 1;
  }

  if (value[index] === "`") {
    let markerEnd = index + 1;
    while (value[markerEnd] === "`") markerEnd += 1;
    const marker = value.slice(index, markerEnd);
    const closing = value.indexOf(marker, markerEnd);
    if (closing >= 0) return closing + marker.length;
    const lineEnd = value.indexOf("\n", markerEnd);
    return lineEnd < 0 ? value.length : lineEnd;
  }

  if (value[index] === "[" || (value[index] === "!" && value[index + 1] === "[")) {
    const linkEnd = markdownLinkEnd(value, index);
    if (linkEnd) return linkEnd;
  }

  if (value[index] === "<") {
    const closing = value.indexOf(">", index + 1);
    if (closing > index) {
      const content = value.slice(index + 1, closing);
      if (/^(?:https?:\/\/|mailto:)|^[^<>\s]+@[^<>\s]+$/iu.test(content)) return closing + 1;
    }
  }

  const urlPrefix = value.slice(index, index + 8).toLowerCase();
  if (urlPrefix.startsWith("https://") || urlPrefix.startsWith("http://")) {
    let end = index;
    while (end < value.length && !/[\s<>]/u.test(value[end])) end += 1;
    return end;
  }

  return 0;
}

function mapMarkdownText(value: string, transform: (segment: string) => string) {
  let result = "";
  let plainTextStart = 0;
  let cursor = 0;
  while (cursor < value.length) {
    const protectedEnd = markdownProtectedEnd(value, cursor);
    if (!protectedEnd) {
      cursor += 1;
      continue;
    }
    result += transform(value.slice(plainTextStart, cursor));
    result += value.slice(cursor, protectedEnd);
    cursor = protectedEnd;
    plainTextStart = protectedEnd;
  }
  return result + transform(value.slice(plainTextStart));
}

export function canonicalizeProfileMentionsForGitHub(comment: string, profiles: MentionProfile[]) {
  return mapMarkdownText(
    comment,
    (segment) => segment.replace(
      new RegExp(gitHubMentionPatternSource, "g"),
      (mention, prefix: string, token: string) => {
        const profile = exactGitHubProfile(token, profiles);
        const login = profile?.githubLogin?.trim();
        if (!login) return mention;
        return `${prefix}@${login}`;
      },
    ),
  );
}
