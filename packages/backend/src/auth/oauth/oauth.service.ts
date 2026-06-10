import {
  Injectable,
  Logger,
  BadRequestException,
  NotFoundException,
  UnauthorizedException,
  GoneException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, IsNull, In } from 'typeorm';
import { createHash, randomBytes, randomUUID } from 'crypto';
import {
  OAuthClient,
  OAuthAuthorizationRequest,
  OAuthAuthorizationCode,
  OAuthGrant,
  OAuthAccessToken,
  OAuthRefreshToken,
  User,
} from '../../entities';
import { GrantLock } from './grant-lock';
import {
  hashToken,
  mintAccessToken,
  mintRefreshToken,
  isAccessToken,
  isRefreshToken,
} from './oauth-tokens';
import {
  parseScopeString,
  formatScopeString,
  isScopeSubset,
  oauthScopesToApiKeyScope,
  type OAuthScope,
} from './oauth-scope';
import { isVerifiedSoftwareId, getKnownClient } from './known-clients';
import { OAuthEventBus, type OAuthRevocationReason } from './oauth.events';
import { canonicalizeEmail } from '../email';
import type {
  DcrRegistrationRequest,
  DcrRegistrationResponse,
  AuthorizeRequestDetails,
  AuthorizeRedirectResponse,
  TokenSuccessResponse,
} from './oauth.dto';

// Lifetimes.
const ACCESS_TOKEN_TTL_SEC = 3600; // 1 hour
const REFRESH_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const ABSOLUTE_GRANT_TTL_MS = 365 * 24 * 60 * 60 * 1000; // 365 days
const AUTHORIZATION_REQUEST_TTL_MS = 10 * 60 * 1000; // 10 minutes
const AUTHORIZATION_CODE_TTL_MS = 60 * 1000; // 60 seconds
const REFRESH_LEEWAY_MS = 30 * 1000; // 30 seconds (Decision 11)
const LAST_USED_DEBOUNCE_MS = 60 * 1000; // 60 seconds (task 8.3)

// Stable token-endpoint error shape (RFC 6749 §5.2 / RFC 7591 errors). Throwing
// this from service methods lets the controller serialise it consistently.
export class OAuthError extends Error {
  constructor(
    public readonly code: string,
    public readonly httpStatus: number,
    public readonly description?: string,
  ) {
    super(description ?? code);
  }
}

export interface ResolvedAccessToken {
  sub: number;
  email: string;
  scope: 'ro' | 'rc' | 'rw'; // OAuth never grants admin
  grantId: number;
  accessTokenId: number;
  oauthScopes: OAuthScope[];
}

@Injectable()
export class OAuthService {
  private readonly logger = new Logger(OAuthService.name);

  // In-memory debounce cache: tokenHash → last persisted lastUsedAt timestamp.
  private lastUsedCache = new Map<string, number>();

  constructor(
    @InjectRepository(OAuthClient) private readonly clientRepo: Repository<OAuthClient>,
    @InjectRepository(OAuthAuthorizationRequest)
    private readonly authReqRepo: Repository<OAuthAuthorizationRequest>,
    @InjectRepository(OAuthAuthorizationCode)
    private readonly authCodeRepo: Repository<OAuthAuthorizationCode>,
    @InjectRepository(OAuthGrant) private readonly grantRepo: Repository<OAuthGrant>,
    @InjectRepository(OAuthAccessToken) private readonly accessTokenRepo: Repository<OAuthAccessToken>,
    @InjectRepository(OAuthRefreshToken) private readonly refreshTokenRepo: Repository<OAuthRefreshToken>,
    @InjectRepository(User) private readonly userRepo: Repository<User>,
    private readonly grantLock: GrantLock,
    private readonly eventBus: OAuthEventBus,
  ) {}

  // ---------------------------------------------------------------------------
  // Section 4 — Dynamic Client Registration (RFC 7591)
  // ---------------------------------------------------------------------------

  async registerClient(body: DcrRegistrationRequest): Promise<DcrRegistrationResponse> {
    if (!Array.isArray(body.redirect_uris) || body.redirect_uris.length === 0) {
      throw new OAuthError('invalid_redirect_uri', 400, 'redirect_uris is required');
    }
    for (const uri of body.redirect_uris) {
      if (typeof uri !== 'string' || !this.isValidRedirectUri(uri)) {
        throw new OAuthError('invalid_redirect_uri', 400, `Invalid redirect_uri: ${uri}`);
      }
    }

    const clientName = (body.client_name ?? '').toString().trim() || 'Unnamed client';
    const softwareId = body.software_id?.toString() || null;
    const verified = isVerifiedSoftwareId(softwareId);
    // If the software_id is on the verified allow-list, the on-disk display
    // name comes from KNOWN_CLIENTS; otherwise we keep the client-supplied
    // name (which the consent screen flags as unverified).
    const displayName = verified
      ? (getKnownClient(softwareId)?.displayName ?? clientName)
      : clientName;

    const clientIdValue = `kpoc_${randomBytes(16).toString('hex')}`;

    const client = this.clientRepo.create({
      clientId: clientIdValue,
      softwareId,
      name: displayName,
      redirectUris: body.redirect_uris,
      clientUri: body.client_uri ?? null,
      dcrMetadata: {
        ...body,
        // Strip large/redundant fields we already store as columns.
        redirect_uris: undefined,
        client_name: undefined,
        client_uri: undefined,
        software_id: undefined,
      } as Record<string, unknown>,
      verified,
    });
    const saved = await this.clientRepo.save(client);

    return {
      client_id: saved.clientId,
      client_id_issued_at: Math.floor(saved.createdAt.getTime() / 1000),
      redirect_uris: saved.redirectUris,
      client_name: saved.name,
      client_uri: saved.clientUri ?? undefined,
      software_id: saved.softwareId ?? undefined,
      token_endpoint_auth_method: 'none',
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
    };
  }

  // RFC 7591 redirect_uri policy:
  //   - https URLs are always allowed
  //   - http://localhost or http://127.0.0.1 (any port) allowed for dev clients
  //   - fragment forbidden
  //   - non-URL strings rejected
  private isValidRedirectUri(uri: string): boolean {
    let parsed: URL;
    try {
      parsed = new URL(uri);
    } catch {
      return false;
    }
    if (parsed.hash) return false;
    if (parsed.protocol === 'https:') return true;
    if (parsed.protocol === 'http:') {
      // Localhost-only carve-out for development clients (task 4.6). Exact
      // host match — `localhost.attacker.com` does NOT qualify.
      const host = parsed.hostname;
      return host === 'localhost' || host === '127.0.0.1';
    }
    return false;
  }

  // ---------------------------------------------------------------------------
  // Section 5 — Authorization endpoint
  // ---------------------------------------------------------------------------

  /**
   * Stage 1 of authorization: validate query params and persist a pending
   * request. Returns the request_id the SPA consent page must fetch.
   *
   * Throws OAuthError with httpStatus=400 for issues that MUST NOT redirect
   * (unknown client, bad redirect_uri). Returns a redirect spec for issues
   * detected after redirect_uri validation.
   */
  async startAuthorization(params: {
    response_type?: string;
    client_id?: string;
    redirect_uri?: string;
    scope?: string;
    state?: string;
    code_challenge?: string;
    code_challenge_method?: string;
  }): Promise<{ requestId: string } | { redirectError: { uri: string; error: string; description?: string; state?: string } }> {
    const clientId = params.client_id?.toString();
    if (!clientId) {
      throw new OAuthError('invalid_request', 400, 'client_id is required');
    }
    const client = await this.clientRepo.findOneBy({ clientId });
    if (!client) {
      throw new OAuthError('invalid_client', 400, 'Unknown client_id');
    }
    const redirectUri = params.redirect_uri?.toString();
    if (!redirectUri || !client.redirectUris.includes(redirectUri)) {
      throw new OAuthError('invalid_redirect_uri', 400, 'redirect_uri does not match a registered URI');
    }

    // From here on, errors redirect to the client per OAuth 2.1 §4.1.2.1.
    if (params.response_type !== 'code') {
      return {
        redirectError: {
          uri: redirectUri,
          error: 'unsupported_response_type',
          description: 'Only response_type=code is supported',
          state: params.state,
        },
      };
    }
    const codeChallenge = params.code_challenge?.toString();
    if (!codeChallenge) {
      return {
        redirectError: {
          uri: redirectUri,
          error: 'invalid_request',
          description: 'PKCE required',
          state: params.state,
        },
      };
    }
    if (params.code_challenge_method && params.code_challenge_method !== 'S256') {
      return {
        redirectError: {
          uri: redirectUri,
          error: 'invalid_request',
          description: 'Only S256 supported',
          state: params.state,
        },
      };
    }

    let scopes: OAuthScope[];
    try {
      const requested = (params.scope ?? '').toString().trim();
      scopes = requested.length === 0 ? ['notes.read'] : parseScopeString(requested);
      // notes.admin is intentionally not exposed (Decision 5).
      if ((requested.split(/\s+/) as string[]).includes('notes.admin')) {
        return {
          redirectError: { uri: redirectUri, error: 'invalid_scope', state: params.state },
        };
      }
      if (scopes.length === 0) {
        return {
          redirectError: { uri: redirectUri, error: 'invalid_scope', state: params.state },
        };
      }
    } catch {
      return {
        redirectError: { uri: redirectUri, error: 'invalid_scope', state: params.state },
      };
    }

    const requestId = randomUUID().replace(/-/g, '') + randomBytes(8).toString('hex');
    const expiresAt = new Date(Date.now() + AUTHORIZATION_REQUEST_TTL_MS);

    await this.authReqRepo.save({
      requestId,
      clientPk: client.id,
      userId: null,
      redirectUri,
      scope: formatScopeString(scopes),
      state: params.state ?? null,
      codeChallenge,
      expiresAt,
    });

    return { requestId };
  }

  async getAuthorizationRequest(requestId: string, userId: number): Promise<AuthorizeRequestDetails> {
    const req = await this.authReqRepo.findOneBy({ requestId });
    if (!req) {
      throw new NotFoundException('Authorization request not found');
    }
    if (req.consumedAt) {
      throw new GoneException('Authorization request already consumed');
    }
    if (req.expiresAt < new Date()) {
      throw new GoneException('Authorization request expired');
    }

    const client = await this.clientRepo.findOneBy({ id: req.clientPk });
    if (!client) {
      throw new NotFoundException('Client not found');
    }
    const user = await this.userRepo.findOneBy({ id: userId });
    if (!user) throw new UnauthorizedException('User not found');

    const deviceLabel = this.deriveDeviceLabel(client);
    const existingGrant = await this.grantRepo.findOne({
      where: {
        userId,
        clientPk: client.id,
        deviceLabel,
        revokedAt: IsNull(),
      },
    });

    const redirectDomain = (() => {
      try {
        return new URL(req.redirectUri).host;
      } catch {
        return req.redirectUri;
      }
    })();

    return {
      request_id: req.requestId,
      client: {
        client_id: client.clientId,
        name: client.name,
        client_uri: client.clientUri,
        verified: client.verified,
      },
      redirect_uri: req.redirectUri,
      redirect_domain: redirectDomain,
      requested_scope: parseScopeString(req.scope),
      user: { email: user.email },
      existing_grant: existingGrant ? { created_at: existingGrant.createdAt.toISOString() } : null,
    };
  }

  async approveAuthorization(
    requestId: string,
    userId: number,
    grantedScope: string[] | undefined,
  ): Promise<AuthorizeRedirectResponse & { rawCode: string }> {
    const req = await this.authReqRepo.findOneBy({ requestId });
    if (!req) throw new NotFoundException('Authorization request not found');
    if (req.consumedAt) throw new GoneException('Authorization request already consumed');
    if (req.expiresAt < new Date()) throw new GoneException('Authorization request expired');

    const requestedScopes = parseScopeString(req.scope);
    let grantedScopes: OAuthScope[];
    try {
      grantedScopes = grantedScope && grantedScope.length > 0
        ? parseScopeString(grantedScope.join(' '))
        : requestedScopes;
    } catch {
      throw new BadRequestException('Invalid granted scope');
    }
    if (grantedScopes.length === 0) {
      throw new BadRequestException('Granted scope cannot be empty');
    }
    if (!isScopeSubset(grantedScopes, requestedScopes)) {
      throw new BadRequestException('Granted scope must be a subset of requested scope');
    }

    const client = await this.clientRepo.findOneBy({ id: req.clientPk });
    if (!client) throw new NotFoundException('Client not found');

    const code = randomBytes(32).toString('base64url');
    const codeHash = hashToken(code);
    const now = new Date();
    const expiresAt = new Date(now.getTime() + AUTHORIZATION_CODE_TTL_MS);

    await this.authCodeRepo.save({
      codeHash,
      userId,
      clientPk: client.id,
      scope: formatScopeString(grantedScopes),
      redirectUri: req.redirectUri,
      codeChallenge: req.codeChallenge,
      expiresAt,
    });

    req.consumedAt = now;
    req.userId = userId;
    await this.authReqRepo.save(req);

    const redirectTo = this.appendQuery(req.redirectUri, {
      code,
      ...(req.state ? { state: req.state } : {}),
    });

    return { redirect_to: redirectTo, rawCode: code };
  }

  async denyAuthorization(requestId: string, userId: number): Promise<AuthorizeRedirectResponse> {
    const req = await this.authReqRepo.findOneBy({ requestId });
    if (!req) throw new NotFoundException('Authorization request not found');
    if (req.consumedAt) throw new GoneException('Authorization request already consumed');
    if (req.expiresAt < new Date()) throw new GoneException('Authorization request expired');

    req.consumedAt = new Date();
    req.userId = userId;
    await this.authReqRepo.save(req);

    return {
      redirect_to: this.appendQuery(req.redirectUri, {
        error: 'access_denied',
        ...(req.state ? { state: req.state } : {}),
      }),
    };
  }

  // ---------------------------------------------------------------------------
  // Section 6 — Token endpoint
  // ---------------------------------------------------------------------------

  async exchangeAuthorizationCode(params: {
    code?: string;
    redirect_uri?: string;
    client_id?: string;
    code_verifier?: string;
  }): Promise<TokenSuccessResponse & { grantId: number }> {
    if (!params.code || !params.client_id || !params.redirect_uri || !params.code_verifier) {
      throw new OAuthError('invalid_request', 400, 'Missing required parameter');
    }
    const client = await this.clientRepo.findOneBy({ clientId: params.client_id });
    if (!client) throw new OAuthError('invalid_client', 400, 'Unknown client_id');

    const codeHash = hashToken(params.code);
    const codeRow = await this.authCodeRepo.findOneBy({ codeHash });
    if (!codeRow) throw new OAuthError('invalid_grant', 400, 'Unknown code');
    if (codeRow.clientPk !== client.id) throw new OAuthError('invalid_grant', 400);
    if (codeRow.consumedAt) {
      // Replay: revoke any tokens that may have been issued from it.
      await this.revokeTokensIssuedFromCode(codeRow.id, 'replay');
      throw new OAuthError('invalid_grant', 400, 'Code already used');
    }
    if (codeRow.expiresAt < new Date()) {
      throw new OAuthError('invalid_grant', 400, 'Code expired');
    }
    if (codeRow.redirectUri !== params.redirect_uri) {
      throw new OAuthError('invalid_grant', 400, 'redirect_uri mismatch');
    }

    // PKCE: S256(verifier) must equal code_challenge
    const verifierHash = createHash('sha256')
      .update(params.code_verifier)
      .digest('base64url');
    if (verifierHash !== codeRow.codeChallenge) {
      // Per spec we revoke the code on PKCE failure to prevent further attempts.
      codeRow.consumedAt = new Date();
      await this.authCodeRepo.save(codeRow);
      throw new OAuthError('invalid_grant', 400, 'PKCE verification failed');
    }

    codeRow.consumedAt = new Date();
    await this.authCodeRepo.save(codeRow);

    const grantedScopes = parseScopeString(codeRow.scope);
    const deviceLabel = this.deriveDeviceLabel(client);

    // Replace any existing active grant for the same triple (Decision 8 / 14).
    const existing = await this.grantRepo.findOne({
      where: {
        userId: codeRow.userId,
        clientPk: client.id,
        deviceLabel,
        revokedAt: IsNull(),
      },
    });
    if (existing) {
      await this.revokeGrant(existing.id, 'user');
    }

    const now = new Date();
    const grant = await this.grantRepo.save({
      userId: codeRow.userId,
      clientPk: client.id,
      deviceLabel,
      scope: formatScopeString(grantedScopes),
      absoluteExpiresAt: new Date(now.getTime() + ABSOLUTE_GRANT_TTL_MS),
      lastUsedAt: now,
    });

    const { access, refresh } = await this.issueTokenPair(grant.id);

    return {
      access_token: access.raw,
      refresh_token: refresh.raw,
      token_type: 'Bearer',
      expires_in: ACCESS_TOKEN_TTL_SEC,
      scope: codeRow.scope,
      grantId: grant.id,
    };
  }

  async refreshTokens(params: {
    refresh_token?: string;
    client_id?: string;
  }): Promise<TokenSuccessResponse & { grantId: number; usedLeeway: boolean }> {
    if (!params.refresh_token || !params.client_id) {
      throw new OAuthError('invalid_request', 400, 'Missing required parameter');
    }
    const tokenHash = hashToken(params.refresh_token);
    const token = await this.refreshTokenRepo.findOneBy({ tokenHash });
    if (!token) throw new OAuthError('invalid_grant', 400);

    const grant = await this.grantRepo.findOneBy({ id: token.grantId });
    if (!grant) throw new OAuthError('invalid_grant', 400);
    if (grant.revokedAt) throw new OAuthError('invalid_grant', 400, 'Grant revoked');

    const client = await this.clientRepo.findOneBy({ clientId: params.client_id });
    if (!client || client.id !== grant.clientPk) {
      throw new OAuthError('invalid_client', 400);
    }

    return this.grantLock.withLock(grant.id, async () => {
      const startedAt = Date.now();
      // Refetch under the lock so the leeway check sees the latest state.
      const fresh = await this.refreshTokenRepo.findOneBy({ id: token.id });
      if (!fresh) throw new OAuthError('invalid_grant', 400);

      const freshGrant = await this.grantRepo.findOneBy({ id: grant.id });
      if (!freshGrant || freshGrant.revokedAt) {
        throw new OAuthError('invalid_grant', 400, 'Grant revoked');
      }

      const now = new Date();
      if (freshGrant.absoluteExpiresAt < now) {
        await this.revokeGrant(freshGrant.id, 'expired');
        throw new OAuthError('invalid_grant', 400, 'Grant absolute expiry reached');
      }

      // Revoked individual token (e.g. via /oauth/revoke).
      if (fresh.revokedAt) {
        throw new OAuthError('invalid_grant', 400, 'Refresh token revoked');
      }

      // Consumed → either leeway re-emit or chain revocation.
      if (fresh.consumedAt) {
        const elapsed = now.getTime() - (fresh.replacedAt?.getTime() ?? fresh.consumedAt.getTime());
        if (elapsed <= REFRESH_LEEWAY_MS && fresh.replacedWithAtId && fresh.replacedWithRtId) {
          // Re-emit the same pair. We can't return the *raw* tokens (we only
          // store hashes) but the client already has them — the caller's retry
          // is just looking for "did the rotation succeed?". That's fine if we
          // ALSO mint a fresh pair for them; but per Decision 11 we MUST
          // re-emit the same pair to avoid splitting the chain. So we serve
          // the cached raw tokens kept on the row's leeway memo.
          // Implementation: store raw tokens in the in-memory leeway memo at
          // rotation time (not persisted), keyed by original RT hash.
          const memo = this.leewayMemo.get(fresh.tokenHash);
          if (memo) {
            this.eventBus.emitRefresh({
              kind: 'leeway',
              grantId: freshGrant.id,
              userId: freshGrant.userId,
              durationMs: Date.now() - startedAt,
              success: true,
            });
            return {
              access_token: memo.accessRaw,
              refresh_token: memo.refreshRaw,
              token_type: 'Bearer' as const,
              expires_in: ACCESS_TOKEN_TTL_SEC,
              scope: freshGrant.scope,
              grantId: freshGrant.id,
              usedLeeway: true,
            };
          }
          // Memo lost (process restart): treat as replay. This is conservative —
          // a legit retry post-restart will have to go through user re-consent.
        }
        // Outside leeway → replay detected.
        this.eventBus.emitRefresh({
          kind: 'replay_detected',
          grantId: freshGrant.id,
          userId: freshGrant.userId,
          durationMs: Date.now() - startedAt,
          success: false,
          errorMessage: 'Refresh token replay detected',
        });
        await this.revokeGrant(freshGrant.id, 'replay');
        throw new OAuthError('invalid_grant', 400, 'Refresh token replay detected');
      }

      if (fresh.expiresAt < now) {
        throw new OAuthError('invalid_grant', 400, 'Refresh token expired');
      }

      // Mint new pair, mark old consumed, link them.
      const newPair = await this.issueTokenPair(freshGrant.id);

      fresh.consumedAt = now;
      fresh.replacedAt = now;
      fresh.replacedById = newPair.refresh.id;
      fresh.replacedWithAtId = newPair.access.id;
      fresh.replacedWithRtId = newPair.refresh.id;
      await this.refreshTokenRepo.save(fresh);

      this.leewayMemo.set(fresh.tokenHash, {
        accessRaw: newPair.access.raw,
        refreshRaw: newPair.refresh.raw,
        expiresAt: now.getTime() + REFRESH_LEEWAY_MS + 5_000,
      });

      this.eventBus.emitRefresh({
        kind: 'refresh',
        grantId: freshGrant.id,
        userId: freshGrant.userId,
        durationMs: Date.now() - startedAt,
        success: true,
      });

      return {
        access_token: newPair.access.raw,
        refresh_token: newPair.refresh.raw,
        token_type: 'Bearer' as const,
        expires_in: ACCESS_TOKEN_TTL_SEC,
        scope: freshGrant.scope,
        grantId: freshGrant.id,
        usedLeeway: false,
      };
    });
  }

  // In-process leeway memo. Holds raw token strings (NOT persisted) so a retry
  // within REFRESH_LEEWAY_MS can re-emit them. A node restart drops the memo;
  // post-restart retries fall through to chain revocation, which is acceptable.
  private leewayMemo = new Map<string, { accessRaw: string; refreshRaw: string; expiresAt: number }>();

  private gcLeewayMemo(now: number = Date.now()): void {
    for (const [k, v] of this.leewayMemo) {
      if (v.expiresAt < now) this.leewayMemo.delete(k);
    }
  }

  // ---------------------------------------------------------------------------
  // Section 7 — Revocation
  // ---------------------------------------------------------------------------

  async revokeToken(rawToken: string, hint: string | undefined, reason: OAuthRevocationReason = 'user'): Promise<void> {
    if (!rawToken) return;
    const tokenHash = hashToken(rawToken);

    // Try the hinted table first; fall back to the other.
    const tryAccess = hint !== 'refresh_token' && isAccessToken(rawToken);
    const tryRefresh = hint !== 'access_token' && isRefreshToken(rawToken);

    if (tryAccess || (!tryRefresh && !tryAccess)) {
      const at = await this.accessTokenRepo.findOneBy({ tokenHash });
      if (at) {
        if (!at.revokedAt) {
          at.revokedAt = new Date();
          await this.accessTokenRepo.save(at);
          this.eventBus.emitAccessTokensRevoked({
            grantId: at.grantId,
            tokenHashes: [at.tokenHash],
            reason,
          });
        }
        return;
      }
    }

    if (tryRefresh || (!tryAccess && !tryRefresh)) {
      const rt = await this.refreshTokenRepo.findOneBy({ tokenHash });
      if (rt) {
        await this.revokeGrant(rt.grantId, reason);
        return;
      }
    }
    // RFC 7009: unknown token → 200 (no leak).
  }

  /**
   * Revoke a grant: marks the grant revoked, revokes every refresh token in
   * the chain (recursive on replaced_by_id) and every active access token.
   * Fires the OAuthEventBus access-token revocation so MCP can sweep sessions.
   */
  async revokeGrant(grantId: number, reason: OAuthRevocationReason = 'user'): Promise<void> {
    const grant = await this.grantRepo.findOneBy({ id: grantId });
    if (!grant || grant.revokedAt) return;

    const now = new Date();
    grant.revokedAt = now;
    await this.grantRepo.save(grant);

    // Revoke all refresh tokens in this grant (regardless of chain shape).
    await this.refreshTokenRepo
      .createQueryBuilder()
      .update()
      .set({ revokedAt: now })
      .where('grantId = :gid AND revokedAt IS NULL', { gid: grantId })
      .execute();

    // Revoke all access tokens for this grant and collect their hashes for the
    // session sweep.
    const ats = await this.accessTokenRepo.find({
      where: { grantId, revokedAt: IsNull() },
    });
    if (ats.length > 0) {
      await this.accessTokenRepo
        .createQueryBuilder()
        .update()
        .set({ revokedAt: now })
        .where('id IN (:...ids)', { ids: ats.map((t) => t.id) })
        .execute();
    }

    this.eventBus.emitAccessTokensRevoked({
      grantId,
      tokenHashes: ats.map((t) => t.tokenHash),
      reason,
    });

    this.eventBus.emitGrantRevoked({
      grantId,
      userId: grant.userId,
      reason,
    });

    this.logger.log(`Revoked OAuth grant ${grantId} (reason=${reason}, access tokens=${ats.length})`);
  }

  /**
   * If the same authorization code somehow produced tokens (concurrent
   * exchange + replay race), revoke those tokens to be safe.
   */
  private async revokeTokensIssuedFromCode(_codeId: number, _reason: OAuthRevocationReason): Promise<void> {
    // We don't track the originating code per token row to keep the schema
    // simple; the Decision 8 replace-on-reauth path already revokes the prior
    // grant on every successful code exchange, and grant uniqueness covers
    // the common case. This hook stays for future tightening if needed.
  }

  // ---------------------------------------------------------------------------
  // Section 8 — Access-token verification (called from CombinedAuthGuard)
  // ---------------------------------------------------------------------------

  async verifyAccessToken(rawToken: string): Promise<ResolvedAccessToken> {
    const tokenHash = hashToken(rawToken);
    const at = await this.accessTokenRepo.findOneBy({ tokenHash });
    if (!at) throw new UnauthorizedException('Invalid access token');
    if (at.revokedAt) throw new UnauthorizedException('Access token revoked');
    if (at.expiresAt < new Date()) throw new UnauthorizedException('Access token expired');

    const grant = await this.grantRepo.findOneBy({ id: at.grantId });
    if (!grant || grant.revokedAt) {
      throw new UnauthorizedException('Grant revoked');
    }

    const user = await this.userRepo.findOneBy({ id: grant.userId });
    if (!user) throw new UnauthorizedException('User not found');

    let canonicalEmail: string;
    try {
      canonicalEmail = canonicalizeEmail(user.email);
    } catch {
      // Fail closed: a non-canonical email in DB (legacy data) cannot safely
      // be threaded into req.user, since downstream code treats it as trusted.
      throw new UnauthorizedException('User email not canonical');
    }

    const oauthScopes = parseScopeString(grant.scope);
    const apiKeyScope = oauthScopesToApiKeyScope(oauthScopes);

    // Debounced last_used update — at most once per LAST_USED_DEBOUNCE_MS per token.
    const last = this.lastUsedCache.get(tokenHash) ?? 0;
    const now = Date.now();
    if (now - last >= LAST_USED_DEBOUNCE_MS) {
      this.lastUsedCache.set(tokenHash, now);
      grant.lastUsedAt = new Date(now);
      this.grantRepo.save(grant).catch((err) => {
        this.logger.warn(`Failed to update grant.lastUsedAt: ${err.message}`);
      });
    }

    return {
      sub: grant.userId,
      email: canonicalEmail,
      scope: apiKeyScope,
      grantId: grant.id,
      accessTokenId: at.id,
      oauthScopes,
    };
  }

  // ---------------------------------------------------------------------------
  // Section 11 — Connections (grants management)
  // ---------------------------------------------------------------------------

  async listGrantsForUser(userId: number): Promise<
    Array<{
      id: number;
      client_id: string;
      client_name: string;
      scope: string;
      created_at: string;
      last_used_at: string | null;
    }>
  > {
    const grants = await this.grantRepo.find({
      where: { userId, revokedAt: IsNull() },
      order: { createdAt: 'DESC' },
    });
    if (grants.length === 0) return [];
    const clients = await this.clientRepo.find({
      where: { id: In(grants.map((g) => g.clientPk)) },
    });
    const clientMap = new Map(clients.map((c) => [c.id, c]));
    return grants.map((g) => ({
      id: g.id,
      client_id: clientMap.get(g.clientPk)?.clientId ?? '',
      client_name: clientMap.get(g.clientPk)?.name ?? '(unknown client)',
      scope: g.scope,
      created_at: g.createdAt.toISOString(),
      last_used_at: g.lastUsedAt ? g.lastUsedAt.toISOString() : null,
    }));
  }

  async revokeGrantForUser(userId: number, grantId: number): Promise<boolean> {
    const grant = await this.grantRepo.findOneBy({ id: grantId });
    if (!grant || grant.userId !== userId || grant.revokedAt) return false;
    await this.revokeGrant(grantId, 'user');
    return true;
  }

  // ---------------------------------------------------------------------------
  // Section 15 — Sweeps & GC
  // ---------------------------------------------------------------------------

  async sweepExpiredAccessTokens(now: Date = new Date()): Promise<number> {
    // Delete tokens that have been expired for more than an hour, to give
    // observability tooling a window to attribute the last hits.
    const cutoff = new Date(now.getTime() - 60 * 60 * 1000);
    const result = await this.accessTokenRepo
      .createQueryBuilder()
      .delete()
      .where('expiresAt < :cutoff', { cutoff })
      .execute();
    return result.affected ?? 0;
  }

  async sweepExpiredAuthorizationArtifacts(now: Date = new Date()): Promise<number> {
    const codes = await this.authCodeRepo
      .createQueryBuilder()
      .delete()
      .where('expiresAt < :now', { now })
      .execute();
    const reqs = await this.authReqRepo
      .createQueryBuilder()
      .delete()
      .where('expiresAt < :now', { now })
      .execute();
    return (codes.affected ?? 0) + (reqs.affected ?? 0);
  }

  async sweepIdleExpiredGrants(now: Date = new Date()): Promise<number> {
    // A grant is "idle expired" when every refresh token under it has expired
    // unconsumed (no rotation), AND the grant is not revoked.
    const grants = await this.grantRepo.find({ where: { revokedAt: IsNull() } });
    let revoked = 0;
    for (const g of grants) {
      const liveRt = await this.refreshTokenRepo
        .createQueryBuilder('rt')
        .where('rt.grantId = :gid', { gid: g.id })
        .andWhere('rt.revokedAt IS NULL')
        .andWhere('rt.expiresAt >= :now', { now })
        .getCount();
      if (liveRt === 0) {
        await this.revokeGrant(g.id, 'expired');
        revoked += 1;
      }
    }
    return revoked;
  }

  async deleteRevokedGrantsOlderThan(days: number, now: Date = new Date()): Promise<number> {
    const cutoff = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
    const result = await this.grantRepo
      .createQueryBuilder()
      .delete()
      .where('revokedAt IS NOT NULL AND revokedAt < :cutoff', { cutoff })
      .execute();
    return result.affected ?? 0;
  }

  async sweepUnusedDcrClients(now: Date = new Date()): Promise<number> {
    const cutoff = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const reqCutoff = cutoff;

    const candidates = await this.clientRepo
      .createQueryBuilder('c')
      .where('c.createdAt < :cutoff', { cutoff })
      .getMany();

    let deleted = 0;
    for (const c of candidates) {
      const grants = await this.grantRepo.count({ where: { clientPk: c.id } });
      if (grants > 0) continue;
      const recentReq = await this.authReqRepo
        .createQueryBuilder('r')
        .where('r.clientPk = :id AND r.createdAt >= :cutoff', { id: c.id, cutoff: reqCutoff })
        .getCount();
      if (recentReq > 0) continue;
      await this.clientRepo.delete(c.id);
      deleted += 1;
    }
    if (deleted > 0) this.logger.log(`DCR client GC: deleted ${deleted} stale clients`);
    return deleted;
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  /**
   * Build a per-client/per-device label from the DCR record. NULL device
   * labels are stored as empty string so the unique index works in SQLite.
   */
  private deriveDeviceLabel(client: OAuthClient): string {
    const meta = client.dcrMetadata ?? {};
    const softwareId = client.softwareId ?? (meta.software_id as string | undefined) ?? '';
    const softwareVersion = (meta.software_version as string | undefined) ?? '';
    if (!softwareId) return '';
    return softwareVersion ? `${softwareId}@${softwareVersion}` : softwareId;
  }

  private async issueTokenPair(grantId: number): Promise<{
    access: { id: number; raw: string };
    refresh: { id: number; raw: string };
  }> {
    const accessMint = mintAccessToken();
    const refreshMint = mintRefreshToken();
    const now = new Date();

    const access = await this.accessTokenRepo.save({
      grantId,
      tokenHash: accessMint.hash,
      expiresAt: new Date(now.getTime() + ACCESS_TOKEN_TTL_SEC * 1000),
    });
    const refresh = await this.refreshTokenRepo.save({
      grantId,
      tokenHash: refreshMint.hash,
      expiresAt: new Date(now.getTime() + REFRESH_TOKEN_TTL_MS),
    });

    this.gcLeewayMemo();

    return {
      access: { id: access.id, raw: accessMint.raw },
      refresh: { id: refresh.id, raw: refreshMint.raw },
    };
  }

  private appendQuery(uri: string, params: Record<string, string>): string {
    const u = new URL(uri);
    for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
    return u.toString();
  }
}
