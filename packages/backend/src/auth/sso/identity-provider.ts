/**
 * The codes the SPA receives as `?sso_error=` (design D12). The login page
 * maps each to a message; the provider's raw error text is only logged.
 */
export type SsoErrorCode =
  | 'domain_not_allowed'
  | 'wrong_tenant'
  | 'ambiguous_account'
  | 'expired'
  | 'cancelled'
  | 'provider_error'
  | 'unavailable';

export class SsoError extends Error {
  constructor(
    readonly code: SsoErrorCode,
    message: string = code,
  ) {
    super(message);
    this.name = 'SsoError';
  }
}

/** Who the provider says signed in, after its own trust checks. */
export interface ExternalIdentity {
  /** Validated `iss`. */
  issuer: string;
  /** Stable per-person id at the provider (Microsoft: `oid`). */
  subject: string;
  /** Raw email candidates, in preference order; not yet canonicalised. */
  emails: string[];
  displayName?: string;
}

/**
 * One external sign-in provider. It owns the protocol and its own trust
 * checks only; deciding which Kalepin user a person becomes (allowlist,
 * linking, creation, session) is the shared pipeline's job, so a new
 * provider can't skip the allowlist.
 */
export interface IdentityProvider {
  /** Used in URLs and `user_identities.provider`. */
  readonly id: string;
  readonly label: string;
  /** The callback registered with the provider, from `APP_URL`. */
  readonly redirectUri: string;

  /** Throws `SsoError('unavailable')` when the provider's metadata can't be fetched. */
  authorizationUrl(params: { state: string; nonce: string; codeChallenge: string }): Promise<URL>;

  /**
   * Turn the callback's query into a validated identity. Throws `SsoError`
   * (`cancelled`, `provider_error`, or a provider-specific trust failure).
   * Tokens are used here and dropped.
   */
  exchange(params: {
    query: URLSearchParams;
    state: string;
    nonce: string;
    codeVerifier: string;
  }): Promise<ExternalIdentity>;
}
