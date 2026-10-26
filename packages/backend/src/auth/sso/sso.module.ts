import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SsoLoginRequest, User, UserIdentity } from '../../entities';
import { AuthModule } from '../auth.module';
import { parseSsoConfig } from './sso-config';
import { SSO_CONFIG, SsoProviderRegistry } from './sso-providers';
import { SsoService } from './sso.service';
import { SsoSweepService } from './sso-sweep.service';
import { SsoController } from './sso.controller';

/** Sign-in through external identity providers (Microsoft Entra ID). Inert until configured. */
@Module({
  imports: [TypeOrmModule.forFeature([SsoLoginRequest, UserIdentity, User]), AuthModule],
  providers: [
    { provide: SSO_CONFIG, useFactory: () => parseSsoConfig(process.env) },
    SsoProviderRegistry,
    SsoService,
    SsoSweepService,
  ],
  controllers: [SsoController],
})
export class SsoModule {}
