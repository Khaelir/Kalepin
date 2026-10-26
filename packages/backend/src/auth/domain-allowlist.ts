/**
 * Parse the DOMAIN_ALLOWLIST env var into a list of allowed domains.
 * Unset or empty means every domain ('*'). Entries are trimmed and
 * lower-cased, and empty entries are dropped, so a list that is only commas
 * allows nothing.
 */
export function parseDomainAllowlist(raw?: string): string[] {
  const allowlist = raw || '*';
  return allowlist
    .split(',')
    .map((d) => d.trim().toLowerCase())
    .filter((d) => d.length > 0);
}

/**
 * Check whether an email's domain is in the allowlist. The domain is
 * compared lower-cased; '*' anywhere in the list allows every domain.
 * Shared by every login method and by mention notifications.
 */
export function isEmailDomainAllowed(email: string, allowlist: readonly string[]): boolean {
  if (allowlist.includes('*')) return true;
  const at = email.lastIndexOf('@');
  if (at === -1) return false;
  return allowlist.includes(email.slice(at + 1).toLowerCase());
}
