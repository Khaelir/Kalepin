// Static allow-list of OAuth clients we have out-of-band confidence in. Keyed by
// the DCR-supplied `software_id`. When a registration matches, the resulting
// row is flagged `verified=true` and the consent screen renders a green badge.
//
// Per design.md Decision 15, this map starts empty: entries are added only
// after we cross-check the software_id a vendor actually uses in their DCR
// registration. DCR is intentionally open and the consent screen is the trust
// boundary — see the unverified disclosure in the consent UI for the user-side
// signal.
export interface KnownClient {
  displayName: string;
  verified: true;
}

export const KNOWN_CLIENTS: Readonly<Record<string, KnownClient>> = Object.freeze({});

export function isVerifiedSoftwareId(softwareId: string | null | undefined): boolean {
  if (!softwareId) return false;
  return Object.prototype.hasOwnProperty.call(KNOWN_CLIENTS, softwareId);
}

export function getKnownClient(softwareId: string | null | undefined): KnownClient | null {
  if (!softwareId) return null;
  return KNOWN_CLIENTS[softwareId] ?? null;
}
