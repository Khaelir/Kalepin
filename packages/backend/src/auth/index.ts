export { AuthModule } from './auth.module';
export { AuthService, JwtPayload } from './auth.service';
export { JwtAuthGuard } from './jwt-auth.guard';
export { CombinedAuthGuard } from './combined-auth.guard';
export { WsAuthGuard } from './ws-auth.guard';
export { RequiredScope } from './required-scope.decorator';
export { SCOPE_PERMISSIONS, PERMISSIONS } from './permissions';
export type { ApiKeyScope, Permission } from './permissions';
export { isAdmin } from './admin.util';
export { canonicalizeEmail } from './email';
export { escapeLike } from './like-escape';
export {
  PERSONAL_PREFIX,
  personalRootFor,
  isUnderPersonalRoot,
  isCanonicalPath,
  isVisibleTo,
  assertReadableBy,
  assertWritableBy,
  isPersonalRootSegment,
  visibilityForSync,
} from './visibility';
export type { Visibility } from './visibility';
export { GrantAwareVisibility } from './grant-aware-visibility.service';
export { OAuthModule } from './oauth/oauth.module';
export { SsoModule } from './sso/sso.module';
export { OAuthService } from './oauth/oauth.service';
export { GrantLock } from './oauth/grant-lock';
export { OAuthEventBus } from './oauth/oauth.events';
export type { AccessTokenRevocation, ApiKeyRevocation, OAuthRevocationReason } from './oauth/oauth.events';
