import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User, MagicLinkToken, ApiKey, NoteChange } from '../entities';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { JwtAuthGuard } from './jwt-auth.guard';
import { CombinedAuthGuard } from './combined-auth.guard';
import { OAuthModule } from './oauth/oauth.module';
import { GrantAwareVisibility } from './grant-aware-visibility.service';
import { SecureVaultService } from './secure-vault.service';
import { SecureVaultController } from './secure-vault.controller';
import { SecureVaultSweepService } from './secure-vault-sweep.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([User, MagicLinkToken, ApiKey, NoteChange]),
    forwardRef(() => OAuthModule),
  ],
  providers: [
    AuthService,
    JwtAuthGuard,
    CombinedAuthGuard,
    GrantAwareVisibility,
    SecureVaultService,
    SecureVaultSweepService,
  ],
  controllers: [AuthController, SecureVaultController],
  exports: [
    AuthService,
    JwtAuthGuard,
    CombinedAuthGuard,
    GrantAwareVisibility,
    SecureVaultService,
  ],
})
export class AuthModule {}
