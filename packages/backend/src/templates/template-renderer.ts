/**
 * Pure renderer for Obsidian-compatible template variables. No I/O: callers
 * resolve the author, the timezone and the clock and pass them in, so every
 * rule here is unit-testable in isolation.
 *
 * Supported: {{title}}, {{date}}, {{time}}, {{date:FORMAT}}, {{time:FORMAT}},
 * {{author}}, {{author_email}}. Anything else is left exactly as written.
 */

export interface TemplateContext {
  /** The new note's file name, without extension. */
  title: string;
  /** Display name, else a prettified email local part (see `prettifyEmailName`). */
  author: string;
  authorEmail: string;
  now: Date;
  /** IANA timezone, already validated (see `resolveTimeZone`). */
  timeZone: string;
  /**
   * `YYYY-MM-DD` override for the calendar day. Daily notes pass their own
   * date so date tokens show that day while time tokens keep the current
   * time of day — the Obsidian Daily notes behaviour.
   */
  date?: string;
}

export interface DateTimeParts {
  year: number;
  /** 1–12 */
  month: number;
  day: number;
  /** 0 = Sunday */
  weekday: number;
  hour: number;
  minute: number;
  second: number;
}

export const DEFAULT_DATE_FORMAT = 'YYYY-MM-DD';
export const DEFAULT_TIME_FORMAT = 'HH:mm';

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

// `{{ name }}` or `{{ name:FORMAT }}`. A format cannot contain `}`.
const VARIABLE_RE = /\{\{\s*([A-Za-z_]+)\s*(?::([^}]*))?\}\}/g;

// Alternation order matters: longest token first at each position.
const FORMAT_TOKEN_RE = /\[([^\]]*)\]|YYYY|YY|MMMM|MMM|MM|M|Do|DD|D|dddd|ddd|HH|H|hh|h|mm|ss|A|a/g;

const DATE_KEY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

const pad2 = (n: number) => String(n).padStart(2, '0');

function ordinal(n: number): string {
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${n}th`;
  switch (n % 10) {
    case 1: return `${n}st`;
    case 2: return `${n}nd`;
    case 3: return `${n}rd`;
    default: return `${n}th`;
  }
}

function weekdayOf(year: number, month: number, day: number): number {
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

export function isValidTimeZone(tz: unknown): tz is string {
  if (typeof tz !== 'string' || tz.trim() === '') return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export function serverTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

/** The client's timezone when Intl accepts it, else the server's. */
export function resolveTimeZone(tz?: string | null): string {
  return isValidTimeZone(tz) ? tz : serverTimeZone();
}

/** True for a real calendar date written `YYYY-MM-DD` (rejects `2026-02-30`). */
export function isValidDateKey(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const m = DATE_KEY_RE.exec(value);
  if (!m) return false;
  const [year, month, day] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const d = new Date(Date.UTC(year, month - 1, day));
  return d.getUTCFullYear() === year && d.getUTCMonth() === month - 1 && d.getUTCDate() === day;
}

/** Wall-clock parts of `now` in `timeZone`. */
export function zonedParts(now: Date, timeZone: string): DateTimeParts {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
  }).formatToParts(now);
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((p) => p.type === type)?.value ?? 0);
  const year = get('year');
  const month = get('month');
  const day = get('day');
  return {
    year,
    month,
    day,
    weekday: weekdayOf(year, month, day),
    // Some ICU builds still print midnight as "24" under h23.
    hour: get('hour') % 24,
    minute: get('minute'),
    second: get('second'),
  };
}

/** `YYYY-MM-DD` for `now` in `timeZone`. */
export function todayIn(timeZone: string, now: Date = new Date()): string {
  const p = zonedParts(now, timeZone);
  return `${p.year}-${pad2(p.month)}-${pad2(p.day)}`;
}

/** Format date/time parts with the moment-style token subset. */
export function formatDateTime(p: DateTimeParts, format: string): string {
  return format.replace(FORMAT_TOKEN_RE, (token, literal: string | undefined) => {
    if (literal !== undefined) return literal;
    const h12 = p.hour % 12 || 12;
    switch (token) {
      case 'YYYY': return String(p.year).padStart(4, '0');
      case 'YY': return pad2(p.year % 100);
      case 'MMMM': return MONTHS[p.month - 1];
      case 'MMM': return MONTHS[p.month - 1].slice(0, 3);
      case 'MM': return pad2(p.month);
      case 'M': return String(p.month);
      case 'Do': return ordinal(p.day);
      case 'DD': return pad2(p.day);
      case 'D': return String(p.day);
      case 'dddd': return WEEKDAYS[p.weekday];
      case 'ddd': return WEEKDAYS[p.weekday].slice(0, 3);
      case 'HH': return pad2(p.hour);
      case 'H': return String(p.hour);
      case 'hh': return pad2(h12);
      case 'h': return String(h12);
      case 'mm': return pad2(p.minute);
      case 'ss': return pad2(p.second);
      case 'A': return p.hour < 12 ? 'AM' : 'PM';
      case 'a': return p.hour < 12 ? 'am' : 'pm';
      default: return token;
    }
  });
}

/** `jane.doe@x.com` → `Jane Doe`. Mirrors the frontend's `editorName` fallback. */
export function prettifyEmailName(email: string): string {
  const local = email.split('@')[0] ?? email;
  const pretty = local
    .split(/[._-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
  return pretty || email;
}

function partsFor(ctx: TemplateContext): DateTimeParts {
  const parts = zonedParts(ctx.now, ctx.timeZone);
  if (ctx.date && isValidDateKey(ctx.date)) {
    const [year, month, day] = ctx.date.split('-').map(Number);
    return { ...parts, year, month, day, weekday: weekdayOf(year, month, day) };
  }
  return parts;
}

/**
 * Replace template variables in one pass. Substituted values are never
 * re-scanned, so a title that itself contains `{{date}}` stays literal.
 */
export function renderTemplate(source: string, ctx: TemplateContext): string {
  const parts = partsFor(ctx);
  return source.replace(VARIABLE_RE, (match, rawName: string, rawFormat: string | undefined) => {
    const name = rawName.toLowerCase();
    const format = rawFormat?.trim();
    switch (name) {
      case 'date':
        return formatDateTime(parts, format || DEFAULT_DATE_FORMAT);
      case 'time':
        return formatDateTime(parts, format || DEFAULT_TIME_FORMAT);
      case 'title':
        return rawFormat === undefined ? ctx.title : match;
      case 'author':
        return rawFormat === undefined ? ctx.author : match;
      case 'author_email':
        return rawFormat === undefined ? ctx.authorEmail : match;
      default:
        return match;
    }
  });
}
