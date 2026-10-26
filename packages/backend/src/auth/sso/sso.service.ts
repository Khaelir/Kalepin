import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, LessThan, Not, Repository } from 'typeorm';
import { createHash, randomBytes, timingSafeEqual } from 'crypto';
import { SsoLoginRequest } from '../../entities/sso-login-request.entity';
import { UserIdentity } from '../../entities/user-identity.entity';
import { User } from '../../entities/user.entity';
import { AuthService } from '../auth.service';
import { safeReturnPath } from '../return-to';
import { SsoError, SsoErrorCode } from './identity-provider';
import { SsoProviderRegistry } from './sso-providers';
import { displayNameToFill, emailCandidates, resolveAccount } from './account-linking';
import { recordIdentity } from './user-identities';

export const SSO_REQUEST_TTL_MS = 10 * 60 * 1000;
/** Expired requests are kept this long before the sweep deletes them. */
const SWEEP_EXPIRED_AFTER_MS = 60 * 60 * 1000;

export type SsoCompletion =
  | { ok: true; returnTo: string; sessionToken: string; userId: number }
  | { ok: false; returnTo: string; code: SsoErrorCode };

function random(): string {
  return randomBytes(32).toString('base64url');
}

function sha256(value: string): Buffer {
  return createHash('sha256').update(value).digest();
}

/**
 * The shared SSO pipeline (design D1): the login request, then the
 * provider's exchange, then account resolution, identity recording and the
 * session. Providers never decide which user someone becomes.
 */
@Injectable()
export class SsoService {
  private readonly logger = new Logger('SSO');

  constructor(
    private readonly providers: SsoProviderRegistry,
    private readonly auth: AuthService,
    @InjectRepository(SsoLoginRequest) private readonly requests: Repository<SsoLoginRequest>,
    @InjectRepository(UserIdentity) private readonly identities: Repository<UserIdentity>,
    @InjectRepository(User) private readonly users: Repository<User>,
  ) {}

  /**
   * Begin a sign-in. Returns the provider URL and the browser-binding value
   * for the `kp_sso` cookie. Throws `SsoError('unavailable')` before storing
   * anything when the provider's metadata can't be fetched.
   */
  async start(providerId: string, returnTo: unknown, now = new Date()): Promise<{ authorizationUrl: URL; binding: string }> {
    const provider = this.providers.get(providerId);
    if (!provider) throw new SsoError('unavailable', `unknown provider ${providerId}`);

    const state = random();
    const nonce = random();
    const codeVerifier = random();
    const binding = random();
    const codeChallenge = sha256(codeVerifier).toString('base64url');

    const authorizationUrl = await provider.authorizationUrl({ state, nonce, codeChallenge });
    await this.requests.save(
      this.requests.create({
        state,
        provider: providerId,
        nonce,
        codeVerifier,
        bindingHash: sha256(binding).toString('hex'),
        returnTo: safeReturnPath(returnTo),
        expiresAt: new Date(now.getTime() + SSO_REQUEST_TTL_MS),
        usedAt: null,
      }),
    );
    return { authorizationUrl, binding };
  }

  /** Finish a sign-in from the provider's callback. Never throws. */
  async complete(providerId: string, query: URLSearchParams, cookie: string | undefined, now = new Date()): Promise<SsoCompletion> {
    let returnTo = '/';
    try {
      const request = await this.findRequest(query.get('state'));
      // Known from here on, so even a refused callback returns to where the
      // sign-in started (e.g. the OAuth consent screen).
      returnTo = request.returnTo;
      await this.consume(request, providerId, cookie, now);
      const provider = this.providers.get(providerId);
      if (!provider) throw new SsoError('unavailable', `provider ${providerId} is not enabled`);

      const identity = await provider.exchange({
        query,
        state: request.state,
        nonce: request.nonce,
        codeVerifier: request.codeVerifier,
      });

      const allowlist = this.auth.getDomainAllowlist();
      const existing = await this.auth.findUsersByEmails(emailCandidates(identity.emails, allowlist));
      const resolution = resolveAccount(identity.emails, allowlist, existing);
      let user: User;
      switch (resolution.outcome) {
        case 'domain_not_allowed':
          throw new SsoError('domain_not_allowed', `no allowlisted email for ${providerId} subject ${identity.subject}`);
        case 'ambiguous':
          this.logger.warn(
            `SSO ${providerId} subject ${identity.subject} matches several users (${resolution.userIds.join(', ')}); sign-in refused`,
          );
          throw new SsoError('ambiguous_account');
        case 'create':
          user = await this.auth.createUser(resolution.email);
          break;
        case 'existing':
          user = resolution.user;
          break;
      }

      await this.auth.ensurePersonalFolderSafe(user.email);
      await this.recordSignIn(providerId, identity, user, now);
      const sessionToken = this.auth.issueSession(user);
      this.logger.log(`SSO sign-in: provider=${providerId} user=${user.id}`);
      return { ok: true, returnTo, sessionToken, userId: user.id };
    } catch (err) {
      const code = err instanceof SsoError ? err.code : 'provider_error';
      if (err instanceof SsoError) {
        if (code !== 'cancelled' && code !== 'ambiguous_account') {
          this.logger.log(`SSO ${providerId} sign-in refused: ${code}: ${err.message}`);
        }
      } else {
        this.logger.error(`SSO ${providerId} sign-in failed: ${(err as Error).message}`);
      }
      return { ok: false, returnTo, code };
    }
  }

  private async findRequest(state: string | null): Promise<SsoLoginRequest> {
    if (!state) throw new SsoError('expired', 'callback without state');
    const request = await this.requests.findOne({ where: { state } });
    if (!request) throw new SsoError('expired', 'unknown state');
    return request;
  }

  /**
   * Validate and consume the login request (design D4). It is marked used
   * before any other check fails or the code is exchanged, so a state can
   * never be replayed, even after an error. Every failure is `expired`.
   */
  private async consume(request: SsoLoginRequest, providerId: string, cookie: string | undefined, now: Date): Promise<void> {
    const claimed = await this.requests.update({ id: request.id, usedAt: IsNull() }, { usedAt: now });
    if (claimed.affected !== 1) throw new SsoError('expired', 'state already used');

    if (request.provider !== providerId) throw new SsoError('expired', `state belongs to provider ${request.provider}`);
    if (request.expiresAt.getTime() <= now.getTime()) throw new SsoError('expired', 'request expired');
    const expected = Buffer.from(request.bindingHash, 'hex');
    const actual = sha256(cookie ?? '');
    if (!cookie || expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
      throw new SsoError('expired', cookie ? 'browser binding mismatch' : 'browser binding cookie missing');
    }
  }

  /** Identity row and display name. Observational: a failure here never blocks the sign-in. */
  private async recordSignIn(
    providerId: string,
    identity: { issuer: string; subject: string; emails: string[]; displayName?: string },
    user: User,
    now: Date,
  ): Promise<void> {
    try {
      await recordIdentity(this.identities, { provider: providerId, identity, userId: user.id, email: user.email, now }, this.logger);
    } catch (err) {
      this.logger.warn(`SSO identity record for user ${user.id} failed: ${(err as Error).message}`);
    }
    const displayName = displayNameToFill(user.displayName, identity.displayName);
    if (displayName) {
      try {
        await this.users.update({ id: user.id }, { displayName });
        user.displayName = displayName;
      } catch (err) {
        this.logger.warn(`SSO display name for user ${user.id} failed: ${(err as Error).message}`);
      }
    }
  }

  /** Delete used requests and requests expired more than an hour ago. */
  async sweep(now = new Date()): Promise<number> {
    const used = await this.requests.delete({ usedAt: Not(IsNull()) });
    const expired = await this.requests.delete({ expiresAt: LessThan(new Date(now.getTime() - SWEEP_EXPIRED_AFTER_MS)) });
    return (used.affected ?? 0) + (expired.affected ?? 0);
  }
}
