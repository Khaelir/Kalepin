import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import {
  OAuthClient,
  OAuthAuthorizationRequest,
  OAuthAuthorizationCode,
  OAuthGrant,
  OAuthAccessToken,
  OAuthRefreshToken,
  User,
} from '../../entities';
import { AuthModule } from '../auth.module';
import { OAuthService } from './oauth.service';
import { OAuthController } from './oauth.controller';
import { OAuthConsentController } from './oauth-consent.controller';
import { WellKnownController } from './well-known.controller';
import { DocsController } from './docs.controller';
import { GrantLock } from './grant-lock';
import { OAuthEventBus } from './oauth.events';
import { OAuthSweepService } from './oauth-sweep.service';
import { OAuthPreregistrationService } from './oauth-preregistration';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      OAuthClient,
      OAuthAuthorizationRequest,
      OAuthAuthorizationCode,
      OAuthGrant,
      OAuthAccessToken,
      OAuthRefreshToken,
      User,
    ]),
    forwardRef(() => AuthModule),
  ],
  providers: [OAuthService, GrantLock, OAuthEventBus, OAuthSweepService, OAuthPreregistrationService],
  controllers: [OAuthController, OAuthConsentController, WellKnownController, DocsController],
  exports: [OAuthService, GrantLock, OAuthEventBus],
})
export class OAuthModule {}
