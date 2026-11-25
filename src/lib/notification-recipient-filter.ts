export function quoteNotificationFilterValue(value: string) {
  return `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
}

export function notificationLeadRecipientFilter(profileId: string) {
  return `recipient_profile_id.eq.${quoteNotificationFilterValue(profileId)},recipient_profile_id.is.null`;
}
