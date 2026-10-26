import { Injectable, Logger, Optional } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as nodemailer from 'nodemailer';
import { User } from '../entities/user.entity';
import { DocHandlesService } from '../doc-handles/doc-handles.service';
import { PERSONAL_PREFIX } from '../auth/visibility';
import { parseDomainAllowlist, isEmailDomainAllowed } from '../auth/domain-allowlist';

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

@Injectable()
export class NotificationService {
  private readonly logger = new Logger(NotificationService.name);
  private readonly transporter: nodemailer.Transporter;
  private readonly appUrl: string;
  private readonly domainAllowlist: string[];

  // Phase 4 leak-token harness counters. Only mutated when EXPOSE_TEST_ENDPOINTS=1
  // (gated by the test-debug controller below). They count outbound notification
  // attempts and cross-personal suppressions per recipient email.
  private readonly testEmittedTo = new Map<string, number>();
  private readonly testSuppressedTo = new Map<string, number>();

  constructor(
    @InjectRepository(User) private readonly userRepo: Repository<User>,
    @Optional() private readonly docHandles?: DocHandlesService,
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

    const noteTitle = notePath.replace(/\.[^.]+$/, '').split('/').pop() || notePath;
    const threadLink = await this.buildDocLink(notePath, `?thread=${threadId}`);

    if (!process.env.SMTP_USER) {
      this.logger.log(
        `[Mention notification] ${authorEmail} mentioned ${mentionedEmail} in "${noteTitle}": "${commentText}"`,
      );
      return;
    }

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
        }),
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

    const noteTitle = docPath.replace(/\.[^.]+$/, '').split('/').pop() || docPath;
    const anchor = headingSlug ? `#${headingSlug}` : '';
    const docLink = await this.buildDocLink(docPath, anchor);

    if (!process.env.SMTP_USER) {
      this.logger.log(
        `[Doc mention notification] ${authorEmail} mentioned ${mentionedEmail} in "${noteTitle}"`,
      );
      return;
    }

    try {
      await this.transporter.sendMail({
        from: process.env.SMTP_FROM || 'noreply@kalepin.app',
        to: mentionedEmail,
        subject: `[Kalepin] ${authorEmail} mentioned you in "${noteTitle}"`,
        html: this.buildEmailHtml({
          heading: `<strong>${authorEmail}</strong> mentioned you in <strong>&ldquo;${noteTitle}&rdquo;</strong>.`,
          ctaLabel: 'View document',
          ctaUrl: docLink,
        }),
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
        }),
      });
    } catch (err) {
      this.logger.error(`Failed to send thread reply notification to ${mentionedEmail}`, (err as Error).stack);
    }
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
  }): string {
    const { heading, quotedText, ctaLabel, ctaUrl } = params;
    const quoteBlock = quotedText
      ? `<blockquote style="margin: 0 0 24px; padding: 12px 16px; background: #f5f5f5; border-left: 3px solid #e94560; border-radius: 4px; color: #555;">${quotedText}</blockquote>`
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
            You received this because you were mentioned in Kalepin.
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
