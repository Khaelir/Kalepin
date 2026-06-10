import { SetMetadata } from '@nestjs/common';
import type { Permission } from './permissions';

export const REQUIRED_SCOPE_KEY = 'requiredScope';

export const RequiredScope = (permission: Permission) =>
  SetMetadata(REQUIRED_SCOPE_KEY, permission);
