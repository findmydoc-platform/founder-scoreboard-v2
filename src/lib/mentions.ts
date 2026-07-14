type MentionProfile = {
  id: string;
  name?: string | null;
  githubLogin?: string | null;
};

function mentionKey(value: string) {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function githubLoginKey(value: string) {
  return value.trim().toLowerCase();
}

function resolveMentionProfile(token: string, profiles: MentionProfile[]) {
  const tokenKey = mentionKey(token);
  const tokenGitHubLoginKey = githubLoginKey(token);
  const exactGitHubLoginMatches = profiles.filter((profile) => (
    profile.id
    && profile.githubLogin
    && githubLoginKey(profile.githubLogin) === tokenGitHubLoginKey
  ));
  if (exactGitHubLoginMatches.length === 1) return exactGitHubLoginMatches[0];
  if (exactGitHubLoginMatches.length > 1) return null;

  const profileMatches = profiles.filter((profile) => {
    if (!profile.id) return false;
    return [
      profile.id,
      profile.name || "",
      ...(profile.name || "").split(/\s+/u),
    ].map(mentionKey).filter(Boolean).includes(tokenKey);
  });
  return profileMatches.length === 1 ? profileMatches[0] : null;
}

export function mentionedProfileIds(comment: string, profiles: MentionProfile[], actorProfileId = "") {
  const tokens = new Set<string>();
  mapMarkdownText(comment, (segment) => {
    for (const match of segment.matchAll(/@([\p{L}\p{N}._-]{2,40})/gu)) {
      const token = githubLoginKey(match[1] || "");
      if (token) tokens.add(token);
    }
    return segment;
  });
  if (!tokens.size) return [];

  const matches = new Set<string>();
  for (const token of tokens) {
    const profile = resolveMentionProfile(token, profiles);
    if (profile?.id && profile.id !== actorProfileId) matches.add(profile.id);
  }
  return [...matches];
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
      /(^|[^\p{L}\p{N}_])@([\p{L}\p{N}_-][\p{L}\p{N}._-]{0,38}[\p{L}\p{N}_-])/gu,
      (mention, prefix: string, token: string) => {
        const profile = resolveMentionProfile(token, profiles);
        if (!profile) return mention;
        if (!profile.githubLogin) return `${prefix}${profile.name?.trim() || token}`;
        return `${prefix}@${profile.githubLogin.trim()}`;
      },
    ),
  );
}
