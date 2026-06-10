import type { ApiKeyScope } from '../permissions';

// OAuth scope strings exposed to clients. `notes.admin` is intentionally *not*
// exposed — admin operations are never brokered through a third-party client
// (see design.md Decision 5 and the "Admin scope is not OAuth-grantable" spec
// requirement). Any value outside this set MUST be rejected with `invalid_scope`.
export const OAUTH_SCOPES = ['notes.read', 'notes.comment', 'notes.write'] as const;
export type OAuthScope = (typeof OAUTH_SCOPES)[number];

const OAUTH_TO_API_KEY_SCOPE: Record<OAuthScope, ApiKeyScope> = {
  'notes.read': 'ro',
  'notes.comment': 'rc',
  'notes.write': 'rw',
};

const API_KEY_TO_OAUTH_SCOPES: Record<Exclude<ApiKeyScope, 'admin'>, OAuthScope[]> = {
  ro: ['notes.read'],
  rc: ['notes.read', 'notes.comment'],
  rw: ['notes.read', 'notes.comment', 'notes.write'],
};

const SCOPE_RANK: Record<OAuthScope, number> = {
  'notes.read': 1,
  'notes.comment': 2,
  'notes.write': 3,
};

export function isOAuthScope(value: string): value is OAuthScope {
  return (OAUTH_SCOPES as readonly string[]).includes(value);
}

export function parseScopeString(scopeStr: string | undefined | null): OAuthScope[] {
  if (!scopeStr) return [];
  const tokens = scopeStr.split(/\s+/).filter((s) => s.length > 0);
  const out: OAuthScope[] = [];
  for (const tok of tokens) {
    if (!isOAuthScope(tok)) {
      throw new Error(`Unsupported scope: ${tok}`);
    }
    if (!out.includes(tok)) out.push(tok);
  }
  return out;
}

export function formatScopeString(scopes: readonly OAuthScope[]): string {
  return scopes.join(' ');
}

// Map a set of OAuth scopes to the highest-equivalent ApiKeyScope so the rest
// of the authorisation system (CombinedAuthGuard, scope-permission tables) can
// keep its existing single-axis representation. Rule: pick the smallest
// ApiKeyScope whose permissions are a superset of every requested OAuth scope.
export function oauthScopesToApiKeyScope(scopes: readonly OAuthScope[]): Exclude<ApiKeyScope, 'admin'> {
  let max = 0;
  for (const s of scopes) max = Math.max(max, SCOPE_RANK[s]);
  if (max <= 1) return 'ro';
  if (max === 2) return 'rc';
  return 'rw';
}

export function apiKeyScopeToOAuthScopes(scope: ApiKeyScope): OAuthScope[] {
  if (scope === 'admin') return [...API_KEY_TO_OAUTH_SCOPES.rw];
  return [...API_KEY_TO_OAUTH_SCOPES[scope]];
}

// True iff every scope in `granted` is also present in `requested`. Used at
// consent-time to enforce that the user can only downgrade, never expand, the
// scope the client asked for.
export function isScopeSubset(granted: readonly OAuthScope[], requested: readonly OAuthScope[]): boolean {
  return granted.every((s) => requested.includes(s));
}
