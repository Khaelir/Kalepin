/**
 * Parse the DOMAIN_ALLOWLIST env var into a list of allowed domains.
 * '*' means all domains are allowed.
 */
export function parseDomainAllowlist(raw?: string): string[] {
  const allowlist = raw || '*';
  return allowlist === '*' ? ['*'] : allowlist.split(',').map((d) => d.trim());
}

/**
 * Check whether an email's domain is in the allowlist.
 */
export function isEmailDomainAllowed(email: string, allowlist: string[]): boolean {
  if (allowlist.includes('*')) return true;
  const domain = email.split('@')[1];
  return allowlist.includes(domain);
}
