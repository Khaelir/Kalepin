import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { OAuthClient } from '../../entities';

// Pre-register OAuth client_ids that already exist on a remote MCP client (e.g.
// claude.ai) but were not introduced via Dynamic Client Registration. Use case:
// an Owner installed Kalepin as a custom connector before this OAuth feature
// shipped, so claude.ai stored a hand-picked client_id (often an email) that
// our oauth_clients table has never seen. Without pre-registration the
// `/oauth/authorize` request returns `invalid_client / Unknown client_id` and
// only the original Owner can recreate the connector.
//
// Pre-registered rows are public clients (PKCE, no client_secret) locked to
// claude.ai's MCP callback. Pre-registration is no weaker than DCR for public
// clients — DCR also accepts arbitrary new client_ids without prior auth.

export const CLAUDE_AI_MCP_CALLBACK = 'https://claude.ai/api/mcp/auth_callback';

export function parsePreregisteredClientIds(env: NodeJS.ProcessEnv = process.env): string[] {
  const raw = env.OAUTH_PREREGISTERED_CLIENT_IDS || '';
  const ids = raw
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  return [...new Set(ids)];
}

@Injectable()
export class OAuthPreregistrationService implements OnModuleInit {
  private readonly logger = new Logger(OAuthPreregistrationService.name);

  constructor(
    @InjectRepository(OAuthClient)
    private readonly clientRepo: Repository<OAuthClient>,
  ) {}

  async onModuleInit(): Promise<void> {
    const ids = parsePreregisteredClientIds();
    if (ids.length === 0) return;

    let inserted = 0;
    for (const clientId of ids) {
      const existing = await this.clientRepo.findOne({ where: { clientId } });
      if (existing) continue;
      await this.clientRepo.save(
        this.clientRepo.create({
          clientId,
          softwareId: null,
          name: 'Claude.ai (pre-registered)',
          redirectUris: [CLAUDE_AI_MCP_CALLBACK],
          clientUri: null,
          dcrMetadata: null,
          verified: false,
        }),
      );
      inserted += 1;
      this.logger.log(`Pre-registered OAuth client_id: ${clientId}`);
    }
    if (inserted === 0) {
      this.logger.debug(`OAuth pre-registration: ${ids.length} client_id(s) already present`);
    }
  }
}
