import { Injectable, Logger, UnauthorizedException, BadRequestException, OnModuleInit, Optional, Inject, forwardRef } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as jwt from 'jsonwebtoken';
import * as nodemailer from 'nodemailer';
import { randomUUID, createHash, randomBytes } from 'crypto';
import { User } from '../entities/user.entity';
import { MagicLinkToken } from '../entities/magic-link-token.entity';
import { ApiKey } from '../entities/api-key.entity';
import { OAuthEventBus } from './oauth/oauth.events';
import { canonicalizeEmail } from './email';
import { resolveJwtSecret } from './jwt-secret';
import { STORAGE_ADAPTER } from '../storage/storage-adapter.interface';
import { RoutingStorageAdapter } from '../storage/routing-fs.adapter';

import type { ApiKeyScope } from './permissions';

export interface JwtPayload {
  sub: number;
  email: string;
  scope?: ApiKeyScope;
  apiKeyId?: number;
}

@Injectable()
export class AuthService implements OnModuleInit {
  private readonly logger = new Logger(AuthService.name);
  private readonly jwtSecret: string;
  private readonly jwtExpiry: string;
  private readonly domainAllowlist: string[];
  private readonly transporter: nodemailer.Transporter;
  private readonly appUrl: string;

  constructor(
    @InjectRepository(User) private readonly userRepo: Repository<User>,
    @InjectRepository(MagicLinkToken) private readonly tokenRepo: Repository<MagicLinkToken>,
    @InjectRepository(ApiKey) private readonly apiKeyRepo: Repository<ApiKey>,
    @Optional() @Inject(forwardRef(() => OAuthEventBus)) private readonly oauthEvents?: OAuthEventBus,
    @Optional() @Inject(STORAGE_ADAPTER) private readonly storage?: unknown,
  ) {
    this.jwtSecret = resolveJwtSecret();
    this.jwtExpiry = process.env.JWT_EXPIRY || '7d';
    this.appUrl = process.env.APP_URL || 'http://localhost:3000';

    const allowlist = process.env.DOMAIN_ALLOWLIST || '*';
    this.domainAllowlist = allowlist === '*' ? ['*'] : allowlist.split(',').map((d) => d.trim());

    this.transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST || 'in-v3.mailjet.com',
      port: parseInt(process.env.SMTP_PORT || '587', 10),
      auth: {
        user: process.env.SMTP_USER || '',
        pass: process.env.SMTP_PASS || '',
      },
    });
  }

  onModuleInit() {
    if (!process.env.ADMIN_EMAILS) {
      this.logger.warn(
        'ADMIN_EMAILS is not set — no users can create admin-scoped API keys. Backup REST endpoints and MCP tools will be inaccessible.',
      );
    }
  }

  private isEmailAllowed(email: string): boolean {
    if (this.domainAllowlist.includes('*')) return true;
    const domain = email.split('@')[1];
    return this.domainAllowlist.includes(domain);
  }

  async requestMagicLink(email: string, returnTo?: string): Promise<void> {
    const canonical = canonicalizeEmail(email);
    if (!this.isEmailAllowed(canonical)) {
      throw new BadRequestException('Email domain not allowed');
    }

    const token = randomUUID();
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000); // 15 minutes

    await this.tokenRepo.save({ email: canonical, token, expiresAt, returnTo: returnTo || undefined });

    const link = `${this.appUrl}/api/auth/verify?token=${token}`;

    if (!process.env.SMTP_USER) {
      this.logger.log(`Magic link for ${canonical}: ${link}`);
      return;
    }

    await this.transporter.sendMail({
      from: process.env.SMTP_FROM || 'noreply@kalepin.app',
      to: canonical,
      subject: 'Sign in to Kalepin',
      html: `<p>Click to sign in:</p><p><a href="${link}">${link}</a></p><p>This link expires in 15 minutes.</p>`,
    });
  }

  async verifyMagicLink(token: string): Promise<{ sessionToken: string; returnTo?: string }> {
    const record = await this.tokenRepo.findOne({ where: { token, used: false } });
    if (!record || record.expiresAt < new Date()) {
      throw new UnauthorizedException('Invalid or expired magic link');
    }

    record.used = true;
    await this.tokenRepo.save(record);

    // record.email was canonicalized at requestMagicLink; canonicalize again
    // defensively in case a caller bypassed the request route.
    const canonical = canonicalizeEmail(record.email);

    let user = await this.userRepo.findOne({ where: { email: canonical } });
    if (!user) {
      user = await this.userRepo.save({ email: canonical });
    }

    await this.ensurePersonalFolderSafe(canonical);

    return { sessionToken: this.signSessionToken(user), returnTo: record.returnTo };
  }

  /** Idempotent: creates the per-user personal folder if a routing storage adapter is wired. */
  private async ensurePersonalFolderSafe(email: string): Promise<void> {
    const adapter = this.storage as RoutingStorageAdapter | undefined;
    if (adapter && typeof adapter.ensurePersonalFolder === 'function') {
      try {
        await adapter.ensurePersonalFolder(email);
      } catch (err) {
        this.logger.warn(`ensurePersonalFolder(${email}) failed: ${(err as Error).message}`);
      }
    }
  }

  private signSessionToken(user: User): string {
    const payload: JwtPayload = { sub: user.id, email: user.email };
    return jwt.sign(payload as object, this.jwtSecret, { expiresIn: this.jwtExpiry } as jwt.SignOptions);
  }

  verifyToken(token: string): JwtPayload {
    let decoded: JwtPayload;
    try {
      decoded = jwt.verify(token, this.jwtSecret) as unknown as JwtPayload;
    } catch {
      throw new UnauthorizedException('Invalid token');
    }
    // Fail closed if the JWT email is not canonical — never silently coerce, since
    // downstream code (visibility predicate, RoutingStorageAdapter, FTS LIKE binding)
    // treats req.user.email as already-canonical.
    try {
      decoded.email = canonicalizeEmail(decoded.email);
    } catch {
      throw new UnauthorizedException('Invalid token');
    }
    return decoded;
  }

  /**
   * Ensure a user record exists for the given JWT payload (auto-provision on
   * first use). Returns the persisted user.id — callers should prefer this
   * over the raw JWT `sub` claim, since the claim is opaque and there is no
   * guarantee it matches the database id (e.g. e2e tokens forged with an
   * arbitrary counter).
   */
  async ensureUser(payload: JwtPayload): Promise<number> {
    let existing = await this.userRepo.findOneBy({ email: payload.email });
    if (!existing) {
      existing = await this.userRepo.save({ email: payload.email });
    }
    await this.ensurePersonalFolderSafe(payload.email);
    return existing.id;
  }

  // API Key methods

  async createApiKey(userId: number, name: string, scope: ApiKeyScope = 'rw'): Promise<{ id: number; name: string; scope: ApiKeyScope; key: string; createdAt: Date }> {
    const rawKey = `kp_${randomBytes(32).toString('hex')}`;
    const keyHash = createHash('sha256').update(rawKey).digest('hex');

    const apiKey = await this.apiKeyRepo.save({ name, keyHash, userId, scope });
    return { id: apiKey.id, name: apiKey.name, scope, key: rawKey, createdAt: apiKey.createdAt };
  }

  async listApiKeys(userId: number): Promise<{ id: number; name: string; scope: ApiKeyScope; createdAt: Date }[]> {
    const keys = await this.apiKeyRepo.find({ where: { userId }, order: { createdAt: 'DESC' } });
    return keys.map((k) => ({ id: k.id, name: k.name, scope: k.scope ?? 'rw', createdAt: k.createdAt }));
  }

  async revokeApiKey(userId: number, keyId: number): Promise<boolean> {
    const result = await this.apiKeyRepo.delete({ id: keyId, userId });
    const deleted = (result.affected ?? 0) > 0;
    if (deleted) this.oauthEvents?.emitApiKeyRevoked({ apiKeyId: keyId });
    return deleted;
  }

  async verifyApiKey(rawKey: string): Promise<JwtPayload> {
    const keyHash = createHash('sha256').update(rawKey).digest('hex');
    const apiKey = await this.apiKeyRepo.findOne({ where: { keyHash }, relations: ['user'] });
    if (!apiKey) {
      throw new UnauthorizedException('Invalid API key');
    }
    let email: string;
    try {
      email = canonicalizeEmail(apiKey.user.email);
    } catch {
      // A non-canonical user.email in DB indicates pre-canon legacy data; reject.
      throw new UnauthorizedException('Invalid API key');
    }
    return { sub: apiKey.userId, email, scope: apiKey.scope ?? 'rw', apiKeyId: apiKey.id };
  }
}
