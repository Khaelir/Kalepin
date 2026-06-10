export type ApiKeyScope = 'ro' | 'rc' | 'rw' | 'admin';

export const PERMISSIONS = [
  'notes:read',
  'notes:search',
  'notes:create',
  'notes:edit',
  'notes:delete',
  'comments:read',
  'comments:write',
  'links:read',
  'stars:read',
  'stars:write',
  'updates:read',
  'attachments:read',
  'attachments:write',
  'admin:backup',
  'admin:stats',
  'users:read',
] as const;

export type Permission = (typeof PERMISSIONS)[number];

const RO_PERMISSIONS: readonly Permission[] = [
  'notes:read',
  'notes:search',
  'comments:read',
  'links:read',
  'stars:read',
  'updates:read',
  'attachments:read',
  'users:read',
];

const RC_PERMISSIONS: readonly Permission[] = [
  ...RO_PERMISSIONS,
  'comments:write',
];

export const SCOPE_PERMISSIONS: Record<ApiKeyScope, readonly Permission[]> = {
  ro: RO_PERMISSIONS,
  rc: RC_PERMISSIONS,
  rw: PERMISSIONS.filter((p) => !p.startsWith('admin:')),
  admin: [...PERMISSIONS],
};
