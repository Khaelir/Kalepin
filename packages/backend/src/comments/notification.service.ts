import { Injectable, Logger, Optional } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as nodemailer from 'nodemailer';
import { User } from '../entities/user.entity';
import { DocHandlesService } from '../doc-handles/doc-handles.service';
import { PERSONAL_PREFIX } from '../auth/visibility';
import { parseDomainAllowlist, isEmailDomainAllowed } from '../auth/domain-allowlist';
import {
  NotificationPreferencesService,
  EmailKind,
} from '../notifications/notification-preferences.service';
import { mintUnsubscribeToken } from '../notifications/unsubscribe-token';

export function isCrossPersonalMention(notePath: string, recipientEmail: string): boolean {
  if (!notePath.startsWith(PERSONAL_PREFIX)) return false;
  const tail = notePath.slice(PERSONAL_PREFIX.length);
  const slash = tail.indexOf('/');
  const ownerEmail = slash === -1 ? tail : tail.slice(0, slash);
  return ownerEmail.toLowerCase() !== recipientEmail.toLowerCase();
}

export interface MentionNotification {
  mentionedEmail: string;
  authorEmail: string;
  commentText: string;
  notePath: string;
  threadId: string;
}

/** A folder share mints one grant per file; one email per pair per window. */
export const SHARE_EMAIL_WINDOW_MS = 60_000;

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// Provided by the global NotificationsModule (not CommentsModule) so that
// GrantsController can send share emails without a module cycle.
@Injectable()
export class NotificationService {
  private readonly logger = new Logger(NotificationService.name);
  private readonly transporter: nodemailer.Transporter;
  private readonly appUrl: string;
  private readonly domainAllowlist: string[];
  /** `${grantor}\n${grantee}` → last share email time (unix ms). */
  private readonly lastShareEmailAt = new Map<string, number>();

  // Phase 4 leak-token harness counters. Only mutated when EXPOSE_TEST_ENDPOINTS=1
  // (gated by the test-debug controller below). They count outbound notification
  // attempts and cross-personal suppressions per recipient email.
  private readonly testEmittedTo = new Map<string, number>();
  private readonly testSuppressedTo = new Map<string, number>();

  constructor(
    @InjectRepository(User) private readonly userRepo: Repository<User>,
    @Optional() private readonly docHandles?: DocHandlesService,
    @Optional() private readonly preferences?: NotificationPreferencesService,
  ) {
    this.appUrl = process.env.APP_URL || 'http://localhost:3000';

    this.domainAllowlist = parseDomainAllowlist(process.env.DOMAIN_ALLOWLIST);

    this.transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST || 'in-v3.mailjet.com',
      port: parseInt(process.env.SMTP_PORT || '587', 10),
      auth: {
        user: process.env.SMTP_USER || '',
        pass: process.env.SMTP_PASS || '',
      },
    });
  }

  async resolveUserId(email: string): Promise<number | null> {
    const user = await this.userRepo.findOne({ where: { email } });
    return user?.id ?? null;
  }

  async resolveUserEmail(userId: number): Promise<string | null> {
    const user = await this.userRepo.findOne({ where: { id: userId } });
    return user?.email ?? null;
  }

  async notifyMention(notification: MentionNotification): Promise<void> {
    const { mentionedEmail, authorEmail, commentText, notePath, threadId } = notification;

    if (isCrossPersonalMention(notePath, mentionedEmail)) {
      this.bumpSuppressed(mentionedEmail);
      this.logger.log(`Suppressed cross-personal mention to ${mentionedEmail} from personal note`);
      return;
    }
    this.bumpEmitted(mentionedEmail);

    if (!isEmailDomainAllowed(mentionedEmail, this.domainAllowlist)) {
      this.logger.warn(`Blocked mention notification to ${mentionedEmail}: domain not in DOMAIN_ALLOWLIST`);
      return;
    }
    if (!(await this.allowsEmail(mentionedEmail, 'mention'))) return;

    const noteTitle = notePath.replace(/\.[^.]+$/, '').split('/').pop() || notePath;
    const threadLink = await this.buildDocLink(notePath, `?thread=${threadId}`);

    if (!process.env.SMTP_USER) {
      this.logger.log(
        `[Mention notification] ${authorEmail} mentioned ${mentionedEmail} in "${noteTitle}": "${commentText}"`,
      );
      return;
    }

    const unsubscribeUrl = this.unsubscribeUrl(mentionedEmail);
    try {
      await this.transporter.sendMail({
        from: process.env.SMTP_FROM || 'noreply@kalepin.app',
        to: mentionedEmail,
        subject: `[Kalepin] ${authorEmail} mentioned you in a comment on "${noteTitle}"`,
        html: this.buildEmailHtml({
          heading: `<strong>${authorEmail}</strong> mentioned you in a comment on <strong>&ldquo;${noteTitle}&rdquo;</strong>:`,
          quotedText: commentText,
          ctaLabel: 'View the thread',
          ctaUrl: threadLink,
          unsubscribeUrl,
        }),
        ...this.unsubscribeHeaders(unsubscribeUrl),
      });
    } catch (err) {
      this.logger.error(`Failed to send mention notification to ${mentionedEmail}`, (err as Error).stack);
    }
  }

  async notifyDocMention(
    mentionedEmail: string,
    authorEmail: string,
    docPath: string,
    headingSlug?: string,
  ): Promise<void> {
    if (isCrossPersonalMention(docPath, mentionedEmail)) {
      this.bumpSuppressed(mentionedEmail);
      this.logger.log(`Suppressed cross-personal doc-mention to ${mentionedEmail} from personal note`);
      return;
    }
    this.bumpEmitted(mentionedEmail);

    if (!isEmailDomainAllowed(mentionedEmail, this.domainAllowlist)) {
      this.logger.warn(`Blocked doc mention notification to ${mentionedEmail}: domain not in DOMAIN_ALLOWLIST`);
      return;
    }
    if (!(await this.allowsEmail(mentionedEmail, 'mention'))) return;

    const noteTitle = docPath.replace(/\.[^.]+$/, '').split('/').pop() || docPath;
    const anchor = headingSlug ? `#${headingSlug}` : '';
    const docLink = await this.buildDocLink(docPath, anchor);

    if (!process.env.SMTP_USER) {
      this.logger.log(
        `[Doc mention notification] ${authorEmail} mentioned ${mentionedEmail} in "${noteTitle}"`,
      );
      return;
    }

    const unsubscribeUrl = this.unsubscribeUrl(mentionedEmail);
    try {
      await this.transporter.sendMail({
        from: process.env.SMTP_FROM || 'noreply@kalepin.app',
        to: mentionedEmail,
        subject: `[Kalepin] ${authorEmail} mentioned you in "${noteTitle}"`,
        html: this.buildEmailHtml({
          heading: `<strong>${authorEmail}</strong> mentioned you in <strong>&ldquo;${noteTitle}&rdquo;</strong>.`,
          ctaLabel: 'View document',
          ctaUrl: docLink,
          unsubscribeUrl,
        }),
        ...this.unsubscribeHeaders(unsubscribeUrl),
      });
    } catch (err) {
      this.logger.error(`Failed to send doc mention notification to ${mentionedEmail}`, (err as Error).stack);
    }
  }

  async notifyThreadReply(
    mentionedEmail: string,
    authorEmail: string,
    replyText: string,
    notePath: string,
    threadId: string,
    isDirectMention: boolean,
  ): Promise<void> {
    if (isCrossPersonalMention(notePath, mentionedEmail)) {
      this.bumpSuppressed(mentionedEmail);
      this.logger.log(`Suppressed cross-personal thread reply to ${mentionedEmail} from personal note`);
      return;
    }
    this.bumpEmitted(mentionedEmail);

    if (!isEmailDomainAllowed(mentionedEmail, this.domainAllowlist)) {
      this.logger.warn(`Blocked thread reply notification to ${mentionedEmail}: domain not in DOMAIN_ALLOWLIST`);
      return;
    }
    if (!(await this.allowsEmail(mentionedEmail, isDirectMention ? 'mention' : 'reply'))) return;

    const noteTitle = notePath.replace(/\.[^.]+$/, '').split('/').pop() || notePath;
    const threadLink = await this.buildDocLink(notePath, `?thread=${threadId}`);

    const subject = isDirectMention
      ? `[Kalepin] ${authorEmail} mentioned you in a comment on "${noteTitle}"`
      : `[Kalepin] ${authorEmail} replied in a thread where you were mentioned in "${noteTitle}"`;

    if (!process.env.SMTP_USER) {
      this.logger.log(`[Thread reply notification] ${subject} -> ${mentionedEmail}`);
      return;
    }

    const heading = isDirectMention
      ? `<strong>${authorEmail}</strong> mentioned you in a comment on <strong>&ldquo;${noteTitle}&rdquo;</strong>:`
      : `<strong>${authorEmail}</strong> replied in a thread where you were mentioned in <strong>&ldquo;${noteTitle}&rdquo;</strong>:`;

    const unsubscribeUrl = this.unsubscribeUrl(mentionedEmail);
    try {
      await this.transporter.sendMail({
        from: process.env.SMTP_FROM || 'noreply@kalepin.app',
        to: mentionedEmail,
        subject,
        html: this.buildEmailHtml({
          heading,
          quotedText: replyText,
          ctaLabel: 'View the thread',
          ctaUrl: threadLink,
          unsubscribeUrl,
        }),
        ...this.unsubscribeHeaders(unsubscribeUrl),
      });
    } catch (err) {
      this.logger.error(`Failed to send thread reply notification to ${mentionedEmail}`, (err as Error).stack);
    }
  }

  /**
   * "X shared a note with you". Registered users only (as for mentions),
   * gated by the domain allowlist and the recipient's preference, and
   * throttled to one email per grantor → grantee per SHARE_EMAIL_WINDOW_MS so a
   * folder share (one grant per file) sends a single email.
   */
  async notifyShare(
    granteeEmail: string,
    grantorEmail: string,
    notePath: string,
    now: number = Date.now(),
  ): Promise<void> {
    if (!(await this.resolveUserId(granteeEmail))) return;
    if (!isEmailDomainAllowed(granteeEmail, this.domainAllowlist)) {
      this.logger.warn(`Blocked share notification to ${granteeEmail}: domain not in DOMAIN_ALLOWLIST`);
      return;
    }
    if (!(await this.allowsEmail(granteeEmail, 'share'))) return;
    if (!this.takeShareSlot(grantorEmail, granteeEmail, now)) return;

    const noteTitle = notePath.replace(/\.[^.]+$/, '').split('/').pop() || notePath;
    const docLink = await this.buildDocLink(notePath);

    if (!process.env.SMTP_USER) {
      this.logger.log(`[Share notification] ${grantorEmail} shared "${noteTitle}" with ${granteeEmail}`);
      return;
    }

    const unsubscribeUrl = this.unsubscribeUrl(granteeEmail);
    try {
      await this.transporter.sendMail({
        from: process.env.SMTP_FROM || 'noreply@kalepin.app',
        to: granteeEmail,
        subject: `[Kalepin] ${grantorEmail} shared "${noteTitle}" with you`,
        html: this.buildEmailHtml({
          heading: `<strong>${escapeHtml(grantorEmail)}</strong> shared <strong>&ldquo;${escapeHtml(noteTitle)}&rdquo;</strong> with you.`,
          ctaLabel: 'Open note',
          ctaUrl: docLink,
          reason: 'You received this because a note was shared with you in Kalepin.',
          unsubscribeUrl,
        }),
        ...this.unsubscribeHeaders(unsubscribeUrl),
      });
    } catch (err) {
      this.logger.error(`Failed to send share notification to ${granteeEmail}`, (err as Error).stack);
    }
  }

  private takeShareSlot(grantorEmail: string, granteeEmail: string, now: number): boolean {
    const key = `${grantorEmail.toLowerCase()}\n${granteeEmail.toLowerCase()}`;
    const last = this.lastShareEmailAt.get(key);
    if (last !== undefined && now - last < SHARE_EMAIL_WINDOW_MS) return false;
    if (this.lastShareEmailAt.size > 1000) {
      for (const [k, t] of this.lastShareEmailAt) {
        if (now - t >= SHARE_EMAIL_WINDOW_MS) this.lastShareEmailAt.delete(k);
      }
    }
    this.lastShareEmailAt.set(key, now);
    return true;
  }

  private async allowsEmail(email: string, kind: EmailKind): Promise<boolean> {
    if (!this.preferences) return true;
    const allowed = await this.preferences.allowsEmail(email, kind);
    if (!allowed) this.logger.log(`Skipped ${kind} email to ${email}: email preference`);
    return allowed;
  }

  private unsubscribeUrl(recipientEmail: string): string {
    const token = mintUnsubscribeToken(recipientEmail);
    return `${this.appUrl}/api/notifications/unsubscribe?token=${encodeURIComponent(token)}`;
  }

  /** `List-Unsubscribe` (via nodemailer's `list`) + RFC 8058 one-click. */
  private unsubscribeHeaders(unsubscribeUrl: string): Pick<nodemailer.SendMailOptions, 'list' | 'headers'> {
    return {
      list: { unsubscribe: { url: unsubscribeUrl, comment: 'Unsubscribe' } },
      headers: { 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' },
    };
  }

  private async buildDocLink(notePath: string, extra?: string): Promise<string> {
    if (this.docHandles) {
      try {
        const handleId = await this.docHandles.findOrCreateForPath(notePath);
        return `${this.appUrl}/doc/${handleId}${extra || ''}`;
      } catch { /* fall through to legacy path form (parser still recognises) */ }
    }
    return `${this.appUrl}/doc/${encodeURIComponent(notePath)}${extra || ''}`;
  }

  private buildEmailHtml(params: {
    heading: string;
    quotedText?: string;
    ctaLabel: string;
    ctaUrl: string;
    reason?: string;
    unsubscribeUrl?: string;
  }): string {
    const { heading, quotedText, ctaLabel, ctaUrl, reason, unsubscribeUrl } = params;
    const quoteBlock = quotedText
      ? `<blockquote style="margin: 0 0 24px; padding: 12px 16px; background: #f5f5f5; border-left: 3px solid #e94560; border-radius: 4px; color: #555;">${quotedText}</blockquote>`
      : '';
    const unsubscribe = unsubscribeUrl
      ? ` <a href="${unsubscribeUrl}" style="color: #999;">Unsubscribe from these emails</a>.`
      : '';
    return `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 560px; margin: 0 auto;">
        <div style="border-top: 3px solid #e94560; padding: 24px 0 0;">
          <p style="margin: 0 0 16px; color: #333;">
            ${heading}
          </p>
          ${quoteBlock}
          <p style="margin: 0 0 24px;">
            <a href="${ctaUrl}" style="display: inline-block; padding: 10px 20px; background: #e94560; color: #fff; text-decoration: none; border-radius: 4px; font-weight: 500;">${ctaLabel}</a>
          </p>
          <p style="margin: 0; font-size: 12px; color: #999;">
            ${reason ?? 'You received this because you were mentioned in Kalepin.'}${unsubscribe}
          </p>
        </div>
      </div>
    `;
  }

  private bumpEmitted(email: string): void {
    if (process.env.EXPOSE_TEST_ENDPOINTS !== '1') return;
    const k = email.toLowerCase();
    this.testEmittedTo.set(k, (this.testEmittedTo.get(k) ?? 0) + 1);
  }

  private bumpSuppressed(email: string): void {
    if (process.env.EXPOSE_TEST_ENDPOINTS !== '1') return;
    const k = email.toLowerCase();
    this.testSuppressedTo.set(k, (this.testSuppressedTo.get(k) ?? 0) + 1);
  }

  __getTestCounters(): { emittedTo: Record<string, number>; suppressedTo: Record<string, number> } {
    return {
      emittedTo: Object.fromEntries(this.testEmittedTo),
      suppressedTo: Object.fromEntries(this.testSuppressedTo),
    };
  }

  __resetTestCounters(): void {
    this.testEmittedTo.clear();
    this.testSuppressedTo.clear();
  }
}
