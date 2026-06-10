import {
  Controller,
  Get,
  Put,
  Post,
  Body,
  Query,
  Req,
  Res,
  UseGuards,
  BadRequestException,
} from '@nestjs/common';
import type { Response } from 'express';
import { JwtAuthGuard } from './jwt-auth.guard';
import { SecureVaultService, VaultMetaUpdate } from './secure-vault.service';

@Controller('api/users/me')
export class SecureVaultController {
  constructor(private readonly secureVault: SecureVaultService) {}

  @Get('vault-meta')
  @UseGuards(JwtAuthGuard)
  async getVaultMeta(@Req() req: any) {
    return this.secureVault.getVaultMeta(req.user.sub);
  }

  @Put('vault-meta')
  @UseGuards(JwtAuthGuard)
  async putVaultMeta(@Body() body: VaultMetaUpdate, @Req() req: any) {
    return this.secureVault.putVaultMeta(req.user.sub, body);
  }

  @Post('secure-vault/reset')
  @UseGuards(JwtAuthGuard)
  async resetVault(@Body() body: { confirm_email: string }, @Req() req: any) {
    if (!body || typeof body.confirm_email !== 'string') {
      throw new BadRequestException('confirm_email is required');
    }
    return this.secureVault.resetVault(req.user.sub, body.confirm_email);
  }

  /**
   * Public undo endpoint — token is HMAC-signed, so no session is required.
   * Returns a small HTML page so the link in the email is one-click usable.
   */
  @Get('secure-vault/reset/undo')
  async undoReset(@Query('token') token: string, @Res() res: Response) {
    if (!token) throw new BadRequestException('token is required');
    try {
      const result = await this.secureVault.undoReset(token);
      res.status(200).send(undoSuccessPage(result.vault_setup_at));
    } catch (err: any) {
      const message = err?.message || 'Undo failed';
      res.status(400).send(undoErrorPage(message));
    }
  }
}

function undoSuccessPage(vaultSetupAt: number | null): string {
  return `
    <!doctype html>
    <html>
      <body style="font-family: system-ui, sans-serif; max-width: 560px; margin: 48px auto; color: #1a1a1a; text-align: center;">
        <h2 style="color: #007e33;">Vault reset undone</h2>
        <p>Your <code>_secure/</code> vault has been restored. You can sign in to Kalepin and unlock it with your existing passphrase or recovery phrase.</p>
        <p style="color: #555; font-size: 12px;">Vault originally set up at: ${vaultSetupAt ? new Date(vaultSetupAt).toISOString() : 'unknown'}.</p>
      </body>
    </html>
  `;
}

function undoErrorPage(reason: string): string {
  return `
    <!doctype html>
    <html>
      <body style="font-family: system-ui, sans-serif; max-width: 560px; margin: 48px auto; color: #1a1a1a; text-align: center;">
        <h2 style="color: #b00020;">Could not undo the reset</h2>
        <p>${reason}</p>
        <p style="color: #555; font-size: 12px;">If you believe this was sent in error, contact your Kalepin administrator.</p>
      </body>
    </html>
  `;
}
