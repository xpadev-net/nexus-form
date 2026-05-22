/** User FK columns must not store share-link / anon synthetic principals. */
export function resolveAuditUserId(userId: string): string | null {
  if (userId.startsWith("share-link:") || userId.startsWith("anon:")) {
    return null;
  }
  return userId;
}
