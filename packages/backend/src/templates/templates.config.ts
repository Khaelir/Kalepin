import { isCanonicalPath } from '../auth/visibility';

export const DEFAULT_TEMPLATES_FOLDER = 'Templates';
export const DEFAULT_DAILY_NOTES_FOLDER = 'Journal';

/** DI token for overriding the env-derived config (tests). */
export const TEMPLATES_CONFIG = 'TEMPLATES_CONFIG';

export interface TemplatesConfig {
  /** Folder name at the vault root and inside each personal folder. */
  templatesFolder: string;
  /** Daily-note folder: in the personal folder when enabled, else at the vault root. */
  dailyNotesFolder: string;
  /** Personal folders are routed (`PERSONAL_PATH` set). */
  personalEnabled: boolean;
}

/**
 * Normalize a folder setting to a canonical relative path. Values that could
 * escape their namespace or that the storage listing would skip (`_users`,
 * `_secure`, dot segments, hidden folders) fall back to the default.
 */
export function normalizeFolderSetting(raw: string | undefined, fallback: string): string {
  const value = (raw ?? '').trim().replace(/^\/+|\/+$/g, '');
  if (!value) return fallback;
  if (!isCanonicalPath(value)) return fallback;
  const segments = value.split('/');
  if (segments[0] === '_users' || segments[0] === '_secure') return fallback;
  if (segments.some((s) => s.startsWith('.'))) return fallback;
  return value;
}

export function readTemplatesConfig(env: NodeJS.ProcessEnv = process.env): TemplatesConfig {
  return {
    templatesFolder: normalizeFolderSetting(env.TEMPLATES_FOLDER, DEFAULT_TEMPLATES_FOLDER),
    dailyNotesFolder: normalizeFolderSetting(env.DAILY_NOTES_FOLDER, DEFAULT_DAILY_NOTES_FOLDER),
    personalEnabled: !!env.PERSONAL_PATH,
  };
}
