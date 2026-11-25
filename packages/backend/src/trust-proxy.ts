/**
 * Proxies whose `X-Forwarded-*` headers Express believes, as the docker-compose
 * deploy needs them: a reverse proxy on the Docker network or the host
 * (private, link-local or loopback address) is trusted, while a client that
 * reaches the published port directly from a public address is not, so it
 * cannot pick its own `req.ip` (the key of every per-IP rate limit).
 */
export const DEFAULT_TRUST_PROXY = 'loopback, linklocal, uniquelocal';

/**
 * Express `trust proxy` value from `TRUST_PROXY`: `true`/`false`, a hop
 * count, or a comma-separated list of addresses, CIDR subnets and the names
 * `loopback`, `linklocal` and `uniquelocal`. Unset or blank gives
 * {@link DEFAULT_TRUST_PROXY}.
 */
export function resolveTrustProxy(raw: string | undefined = process.env.TRUST_PROXY): boolean | number | string {
  const value = raw?.trim();
  if (!value) return DEFAULT_TRUST_PROXY;
  if (value.toLowerCase() === 'true') return true;
  if (value.toLowerCase() === 'false') return false;
  if (/^\d+$/.test(value)) return Number(value);
  return value;
}
