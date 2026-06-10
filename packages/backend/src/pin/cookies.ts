/**
 * Minimal cookie parser. Avoids adding cookie-parser middleware just for the
 * PIN feature; we only need to read named cookies as raw strings.
 */
export function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    const name = part.slice(0, eq).trim();
    const value = part.slice(eq + 1).trim();
    if (!name) continue;
    try {
      out[name] = decodeURIComponent(value);
    } catch {
      out[name] = value;
    }
  }
  return out;
}

export function readCookie(req: { headers: { cookie?: string } }, name: string): string | null {
  return parseCookies(req.headers.cookie)[name] ?? null;
}
