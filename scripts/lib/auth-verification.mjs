export function parseRequiredAuthLinkedProfileIds(value = "") {
  return Array.from(new Set(
    String(value)
      .split(",")
      .map((profileId) => profileId.trim())
      .filter(Boolean),
  ));
}

export function findMissingRequiredAuthLinkedProfileIds(
  profiles,
  authUserIds,
  requiredProfileIds,
) {
  const linkedProfileIds = new Set(
    profiles
      .filter((profile) => profile.auth_user_id && authUserIds.has(profile.auth_user_id))
      .map((profile) => profile.id),
  );

  return requiredProfileIds.filter((profileId) => !linkedProfileIds.has(profileId));
}
