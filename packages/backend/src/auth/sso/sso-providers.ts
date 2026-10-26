import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { IdentityProvider } from './identity-provider';
import { MicrosoftProvider } from './providers/microsoft.provider';
import { SsoConfig, ssoEnabledMessage } from './sso-config';

export const SSO_CONFIG = Symbol('SSO_CONFIG');

/** The sign-in providers enabled by configuration, keyed by id. */
@Injectable()
export class SsoProviderRegistry implements OnModuleInit {
  private readonly logger = new Logger('SSO');
  private readonly providers = new Map<string, IdentityProvider>();

  constructor(@Inject(SSO_CONFIG) private readonly config: SsoConfig) {
    if (config.microsoft) this.register(new MicrosoftProvider(config.microsoft));
  }

  /** Boot log, once. Misconfiguration only warns: the magic link must keep working. */
  onModuleInit(): void {
    for (const warning of this.config.warnings) this.logger.warn(warning);
    if (this.config.microsoft) this.logger.log(ssoEnabledMessage(this.config.microsoft));
  }

  register(provider: IdentityProvider): void {
    this.providers.set(provider.id, provider);
  }

  get(id: string): IdentityProvider | undefined {
    return this.providers.get(id);
  }

  list(): { id: string; label: string }[] {
    return [...this.providers.values()].map((p) => ({ id: p.id, label: p.label }));
  }
}
