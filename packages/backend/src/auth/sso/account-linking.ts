import { canonicalizeEmail } from '../email';
import { isEmailDomainAllowed } from '../domain-allowlist';

export const MAX_DISPLAY_NAME_LENGTH = 200;

export interface LinkableUser {
  id: number;
  email: string;
}

export type AccountResolution<U extends LinkableUser = LinkableUser> =
  | { outcome: 'existing'; user: U }
  | { outcome: 'create'; email: string }
  | { outcome: 'ambiguous'; userIds: number[] }
  | { outcome: 'domain_not_allowed' };

/**
 * The provider's email candidates, canonicalised (values that aren't valid
 * emails, such as some UPNs, are dropped), filtered through the allowlist
 * and deduplicated, in the provider's preference order.
 */
export function emailCandidates(emails: string[], allowlist: readonly string[]): string[] {
  const out: string[] = [];
  for (const raw of emails) {
    let email: string;
    try {
      email = canonicalizeEmail(raw);
    } catch {
      continue;
    }
    if (isEmailDomainAllowed(email, allowlist) && !out.includes(email)) out.push(email);
  }
  return out;
}

/**
 * Decide which Kalepin user an external identity becomes (design D7). Email
 * is authoritative: one matching user signs in, none creates one with the
 * first candidate, several distinct users refuse. `existingUsers` is the
 * lookup of the candidates; users outside them are ignored.
 */
export function resolveAccount<U extends LinkableUser>(
  emails: string[],
  allowlist: readonly string[],
  existingUsers: U[],
): AccountResolution<U> {
  const candidates = emailCandidates(emails, allowlist);
  if (candidates.length === 0) return { outcome: 'domain_not_allowed' };

  const matched = new Map<number, U>();
  for (const user of existingUsers) {
    if (candidates.includes(user.email)) matched.set(user.id, user);
  }
  const users = [...matched.values()];
  if (users.length === 1) return { outcome: 'existing', user: users[0] };
  if (users.length === 0) return { outcome: 'create', email: candidates[0] };
  return { outcome: 'ambiguous', userIds: users.map((u) => u.id).sort((a, b) => a - b) };
}

/**
 * The display name to set from the provider's `name` (design D9), or null
 * when nothing should change: an existing name is never overwritten.
 */
export function displayNameToFill(current: string | null | undefined, providerName: string | undefined): string | null {
  if (current?.trim()) return null;
  const trimmed = providerName?.trim();
  if (!trimmed) return null;
  // By code point, so a name is never cut inside a surrogate pair.
  return [...trimmed].slice(0, MAX_DISPLAY_NAME_LENGTH).join('').trim();
}
