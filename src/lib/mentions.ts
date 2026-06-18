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

export function mentionedProfileIds(comment: string, profiles: MentionProfile[], actorProfileId = "") {
  const tokens = new Set([...comment.matchAll(/@([\p{L}\p{N}._-]{2,40})/gu)].map((match) => mentionKey(match[1] || "")));
  if (!tokens.size) return [];

  const matches = new Set<string>();
  for (const profile of profiles) {
    if (!profile.id || profile.id === actorProfileId) continue;
    const candidates = [
      profile.id,
      profile.name || "",
      profile.githubLogin || "",
      ...(profile.name || "").split(/\s+/u),
    ].map(mentionKey).filter(Boolean);
    if (candidates.some((candidate) => tokens.has(candidate))) matches.add(profile.id);
  }
  return [...matches];
}
