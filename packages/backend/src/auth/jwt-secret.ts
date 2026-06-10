const DEFAULT_DEV_SECRET = 'dev-secret-change-me';
const MIN_PROD_LENGTH = 32;

export function resolveJwtSecret(): string {
  const value = process.env.JWT_SECRET;
  const isProd = process.env.NODE_ENV === 'production';

  if (!value) {
    if (isProd) {
      throw new Error(
        'FATAL: JWT_SECRET must be set in production. Generate one with `openssl rand -hex 32`.',
      );
    }
    return DEFAULT_DEV_SECRET;
  }

  if (isProd && (value === DEFAULT_DEV_SECRET || value === 'change-me-in-production')) {
    throw new Error(
      'FATAL: JWT_SECRET is set to a documented placeholder value. Refusing to start in production.',
    );
  }

  if (isProd && value.length < MIN_PROD_LENGTH) {
    throw new Error(
      `FATAL: JWT_SECRET must be at least ${MIN_PROD_LENGTH} characters in production (got ${value.length}).`,
    );
  }

  return value;
}
