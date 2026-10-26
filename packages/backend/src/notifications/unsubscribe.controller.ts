import { Controller, Get, Logger, Post, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { NotificationPreferencesService } from './notification-preferences.service';
import { verifyUnsubscribeToken } from './unsubscribe-token';

export interface UnsubscribeOutcome {
  status: 200 | 400;
  html: string;
}

/**
 * Public (token-authenticated) unsubscribe link carried by every notification
 * email. GET serves the link a person clicks; POST serves RFC 8058 one-click
 * (`List-Unsubscribe-Post`). Both set the preference to `none`.
 */
@Controller('api/notifications')
export class UnsubscribeController {
  private readonly logger = new Logger(UnsubscribeController.name);

  constructor(private readonly preferences: NotificationPreferencesService) {}

  @Get('unsubscribe')
  async unsubscribePage(@Query('token') token: string | undefined, @Res() res: Response): Promise<void> {
    const outcome = await this.unsubscribe(token);
    res.status(outcome.status).type('html').send(outcome.html);
  }

  @Post('unsubscribe')
  async unsubscribeOneClick(@Query('token') token: string | undefined, @Res() res: Response): Promise<void> {
    const outcome = await this.unsubscribe(token);
    res.status(outcome.status).type('html').send(outcome.html);
  }

  async unsubscribe(token: unknown): Promise<UnsubscribeOutcome> {
    const email = verifyUnsubscribeToken(token);
    if (!email) {
      return {
        status: 400,
        html: renderPage(
          'Link not valid',
          'This unsubscribe link is invalid or has expired. You can change your email notifications in Kalepin under Settings.',
        ),
      };
    }
    await this.preferences.set(email, 'none');
    this.logger.log(`Email notifications turned off via unsubscribe link for ${email}`);
    return {
      status: 200,
      html: renderPage(
        'You are unsubscribed',
        `${escapeHtml(email)} will no longer receive notification emails from Kalepin. ` +
          'Mentions, replies and shares still show up in the app. You can turn emails back on in Settings.',
      ),
    };
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** `body` is trusted markup (callers escape interpolated values). */
function renderPage(title: string, body: string): string {
  const appUrl = escapeHtml(process.env.APP_URL || '/');
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${escapeHtml(title)} · Kalepin</title>
<style>
  body { margin: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #faf6ec; color: #1d1d22; }
  main { max-width: 480px; margin: 12vh auto 0; padding: 0 24px; }
  .card { border-top: 3px solid #e94560; background: #fff; border-radius: 6px; padding: 24px; box-shadow: 0 2px 6px rgba(0,0,0,0.08); }
  h1 { font-size: 20px; margin: 0 0 12px; }
  p { line-height: 1.5; color: #4a4a52; margin: 0 0 16px; }
  a { color: #e94560; }
</style>
</head>
<body>
<main>
  <div class="card">
    <h1>${escapeHtml(title)}</h1>
    <p>${body}</p>
    <p><a href="${appUrl}">Open Kalepin</a></p>
  </div>
</main>
</body>
</html>`;
}
