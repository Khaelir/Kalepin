import { Logger } from '@nestjs/common';
import * as oidc from 'openid-client';
import { ExternalIdentity, IdentityProvider, SsoError } from '../identity-provider';
import { MicrosoftSsoConfig, isInsecureLocalAuthority } from '../sso-config';

const DISCOVERY_TIMEOUT_SEC = 10;

function claimString(claims: Record<string, unknown>, name: string): string | undefined {
  const value = claims[name];
  return typeof value === 'string' && value.trim() ? value : undefined;
}

/**
 * Map validated ID token claims to an identity, enforcing the tenant pin:
 * `iss` is already checked by openid-client against the tenant's metadata,
 * and `tid` must equal the configured tenant as well (design D3).
 */
export function identityFromMicrosoftClaims(
  claims: Record<string, unknown>,
  tenantId: string,
): ExternalIdentity {
  const tid = claimString(claims, 'tid');
  if (!tid || tid.toLowerCase() !== tenantId.toLowerCase()) {
    throw new SsoError('wrong_tenant', `ID token tid ${tid ?? '(missing)'} is not the configured tenant ${tenantId}`);
  }
  const issuer = claimString(claims, 'iss');
  const subject = claimString(claims, 'oid');
  if (!issuer || !subject) {
    throw new SsoError('provider_error', `ID token has no ${issuer ? 'oid' : 'iss'} claim`);
  }
  const emails = [claimString(claims, 'email'), claimString(claims, 'preferred_username')].filter(
    (e): e is string => e !== undefined,
  );
  return { issuer, subject, emails, displayName: claimString(claims, 'name') };
}

/** Microsoft Entra ID, single tenant, authorization-code flow with PKCE. */
export class MicrosoftProvider implements IdentityProvider {
  readonly id = 'microsoft';
  readonly label = 'Microsoft';
  readonly redirectUri: string;
  private readonly logger = new Logger('SsoMicrosoft');
  private readonly issuerUrl: URL;
  private configuration?: Promise<oidc.Configuration>;

  constructor(private readonly config: MicrosoftSsoConfig) {
    this.redirectUri = config.redirectUri;
    this.issuerUrl = new URL(`${config.authorityHost}/${config.tenantId}/v2.0`);
  }

  /**
   * Discovery runs on first use and is cached. A failure isn't cached, so the
   * next sign-in retries, and a Microsoft outage never touches boot.
   */
  private discover(): Promise<oidc.Configuration> {
    if (!this.configuration) {
      const execute = isInsecureLocalAuthority(this.config.authorityHost) ? [oidc.allowInsecureRequests] : [];
      const pending = oidc.discovery(
        this.issuerUrl,
        this.config.clientId,
        undefined,
        oidc.ClientSecretPost(this.config.clientSecret),
        { execute, timeout: DISCOVERY_TIMEOUT_SEC },
      );
      this.configuration = pending;
      pending.catch(() => {
        if (this.configuration === pending) this.configuration = undefined;
      });
    }
    return this.configuration.catch((err: Error) => {
      this.logger.warn(`OIDC discovery from ${this.issuerUrl.href} failed: ${err.message}`);
      throw new SsoError('unavailable', 'OIDC discovery failed');
    });
  }

  async authorizationUrl(params: { state: string; nonce: string; codeChallenge: string }): Promise<URL> {
    const configuration = await this.discover();
    return oidc.buildAuthorizationUrl(configuration, {
      response_type: 'code',
      redirect_uri: this.redirectUri,
      scope: 'openid email profile',
      code_challenge: params.codeChallenge,
      code_challenge_method: 'S256',
      state: params.state,
      nonce: params.nonce,
      prompt: 'select_account',
    });
  }

  async exchange(params: {
    query: URLSearchParams;
    state: string;
    nonce: string;
    codeVerifier: string;
  }): Promise<ExternalIdentity> {
    const configuration = await this.discover();
    // openid-client sends this URL minus its query as the token request's
    // redirect_uri, so it must be the registered callback, never one rebuilt
    // from the request's host (design D6).
    const callbackUrl = new URL(this.redirectUri);
    callbackUrl.search = params.query.toString();

    let claims: oidc.IDToken | undefined;
    try {
      const tokens = await oidc.authorizationCodeGrant(configuration, callbackUrl, {
        pkceCodeVerifier: params.codeVerifier,
        expectedState: params.state,
        expectedNonce: params.nonce,
        idTokenExpected: true,
      });
      claims = tokens.claims();
    } catch (err) {
      throw this.exchangeError(err);
    }
    if (!claims) throw new SsoError('provider_error', 'no ID token in the token response');
    return identityFromMicrosoftClaims(claims, this.config.tenantId);
  }

  private exchangeError(err: unknown): SsoError {
    if (err instanceof oidc.AuthorizationResponseError) {
      if (err.error === 'access_denied') return new SsoError('cancelled', 'cancelled at Microsoft');
      this.logger.warn(`Microsoft sign-in returned ${err.error}: ${err.error_description ?? '(no description)'}`);
      return new SsoError('provider_error', err.error);
    }
    if (err instanceof oidc.ResponseBodyError) {
      // Microsoft puts the AADSTS code (e.g. AADSTS7000215, invalid secret)
      // at the start of error_description.
      this.logger.warn(
        `Microsoft token exchange failed (HTTP ${err.status}) ${err.error}: ${err.error_description ?? '(no description)'}`,
      );
      return new SsoError('provider_error', err.error);
    }
    // openid-client wraps the specific check (`unexpected ID Token "nonce"
    // claim value`) in `cause`. Only its message is logged: the cause object
    // also holds the token's claims.
    const e = err as Error & { code?: string; cause?: unknown };
    const detail = e.cause instanceof Error ? ` (${e.cause.message})` : '';
    this.logger.warn(`Microsoft sign-in failed: ${e.code ? `${e.code}: ` : ''}${e.message}${detail}`);
    return new SsoError('provider_error', e.message);
  }
}
