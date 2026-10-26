import * as fs from 'fs';

export interface MicrosoftSsoConfig {
  /** Lower-cased GUID; also the expected `tid` claim. */
  tenantId: string;
  clientId: string;
  clientSecret: string;
  /** Origin (and optional path prefix) of the authority, no trailing slash. */
  authorityHost: string;
  /** `APP_URL` + `/api/auth/sso/microsoft/callback`, registered in Entra. */
  redirectUri: string;
}

export interface SsoConfig {
  microsoft?: MicrosoftSsoConfig;
  /** Boot warnings, logged once. Never contains a secret. */
  warnings: string[];
}

export const DEFAULT_MICROSOFT_AUTHORITY_HOST = 'https://login.microsoftonline.com';

const GUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LOCAL_HOSTNAMES = new Set(['localhost', '127.0.0.1']);

const TENANT = 'SSO_MICROSOFT_TENANT_ID';
const CLIENT = 'SSO_MICROSOFT_CLIENT_ID';
const SECRET = 'SSO_MICROSOFT_CLIENT_SECRET';
const SECRET_FILE = 'SSO_MICROSOFT_CLIENT_SECRET_FILE';
const AUTHORITY = 'SSO_MICROSOFT_AUTHORITY_HOST';
const ALL_VARS = [TENANT, CLIENT, SECRET, SECRET_FILE, AUTHORITY];

export const SSO_WARNINGS = {
  missing: (vars: string[]) => `SSO_MICROSOFT: missing ${vars.join(', ')}`,
  tenantNotGuid:
    `SSO_MICROSOFT: ${TENANT} must be your tenant's GUID; ` +
    'multi-tenant values (common, organizations, consumers) are not supported',
  clientNotGuid: `SSO_MICROSOFT: ${CLIENT} must be the application (client) ID, a GUID`,
  secretFileUnreadable: (path: string, reason: string) =>
    `SSO_MICROSOFT: cannot read ${SECRET_FILE} (${path}): ${reason}`,
  secretFileEmpty: (path: string) => `SSO_MICROSOFT: ${SECRET_FILE} (${path}) is empty`,
  bothSecrets: `SSO_MICROSOFT: both ${SECRET_FILE} and ${SECRET} are set; the file takes precedence`,
  badAuthorityHost:
    `SSO_MICROSOFT: ${AUTHORITY} must be an https:// URL ` +
    '(http:// is accepted only for localhost and 127.0.0.1)',
  badAppUrl: (appUrl: string) => `SSO_MICROSOFT: APP_URL "${appUrl}" is not a valid URL`,
};

export function ssoEnabledMessage(config: MicrosoftSsoConfig): string {
  return `SSO: Microsoft sign-in enabled for tenant ${config.tenantId}`;
}

/** True when `authorityHost` is the plain-HTTP localhost exception (tests). */
export function isInsecureLocalAuthority(authorityHost: string): boolean {
  const url = new URL(authorityHost);
  return url.protocol === 'http:' && LOCAL_HOSTNAMES.has(url.hostname);
}

function parseAuthorityHost(raw: string): string | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.search || url.hash || url.username || url.password) return null;
  const secure = url.protocol === 'https:';
  const local = url.protocol === 'http:' && LOCAL_HOSTNAMES.has(url.hostname);
  if (!secure && !local) return null;
  return `${url.origin}${url.pathname}`.replace(/\/+$/, '');
}

/**
 * Read the `SSO_MICROSOFT_*` configuration (design D3). Pure apart from
 * `readFile`: never throws, and leaves the provider off with a warning when
 * anything is missing or invalid, so a typo can't block the magic link.
 */
export function parseSsoConfig(
  env: Record<string, string | undefined>,
  readFile: (path: string) => string = (p) => fs.readFileSync(p, 'utf8'),
): SsoConfig {
  const value = (name: string) => env[name]?.trim() || undefined;
  const warnings: string[] = [];

  if (!ALL_VARS.some((name) => value(name))) return { warnings };

  const tenantId = value(TENANT);
  const clientId = value(CLIENT);
  const secretFile = value(SECRET_FILE);
  const secretValue = value(SECRET);
  let valid = true;

  const missing: string[] = [];
  if (!tenantId) missing.push(TENANT);
  if (!clientId) missing.push(CLIENT);
  if (!secretFile && !secretValue) missing.push(`${SECRET} (or ${SECRET_FILE})`);
  if (missing.length > 0) {
    warnings.push(SSO_WARNINGS.missing(missing));
    valid = false;
  }

  if (tenantId && !GUID_RE.test(tenantId)) {
    warnings.push(SSO_WARNINGS.tenantNotGuid);
    valid = false;
  }
  if (clientId && !GUID_RE.test(clientId)) {
    warnings.push(SSO_WARNINGS.clientNotGuid);
    valid = false;
  }

  let clientSecret = secretValue;
  if (secretFile) {
    if (secretValue) warnings.push(SSO_WARNINGS.bothSecrets);
    try {
      clientSecret = readFile(secretFile).trim();
      if (!clientSecret) {
        warnings.push(SSO_WARNINGS.secretFileEmpty(secretFile));
        valid = false;
      }
    } catch (err) {
      const reason = (err as NodeJS.ErrnoException).code ?? (err as Error).message;
      warnings.push(SSO_WARNINGS.secretFileUnreadable(secretFile, reason));
      valid = false;
    }
  }

  const rawAuthority = value(AUTHORITY);
  const authorityHost = rawAuthority ? parseAuthorityHost(rawAuthority) : DEFAULT_MICROSOFT_AUTHORITY_HOST;
  if (!authorityHost) {
    warnings.push(SSO_WARNINGS.badAuthorityHost);
    valid = false;
  }

  const appUrl = (env.APP_URL || 'http://localhost:3000').replace(/\/+$/, '');
  const redirectUri = `${appUrl}/api/auth/sso/microsoft/callback`;
  try {
    new URL(redirectUri);
  } catch {
    warnings.push(SSO_WARNINGS.badAppUrl(appUrl));
    valid = false;
  }

  if (!valid || !tenantId || !clientId || !clientSecret || !authorityHost) return { warnings };
  return {
    microsoft: { tenantId: tenantId.toLowerCase(), clientId, clientSecret, authorityHost, redirectUri },
    warnings,
  };
}
