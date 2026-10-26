import { BadRequestException, Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type { FileEntry } from '@kalepin/shared';
import { STORAGE_ADAPTER, StorageAdapter } from '../storage';
import { FilesService } from '../files/files.service';
import { DocHandlesService } from '../doc-handles/doc-handles.service';
import { PinService } from '../pin/pin.service';
import { User } from '../entities/user.entity';
import { isVisibleTo, personalRootFor } from '../auth/visibility';
import { isE2EPath } from '../crypto/encryption-predicates';
import {
  TEMPLATES_CONFIG,
  TemplatesConfig,
  readTemplatesConfig,
} from './templates.config';
import {
  TemplateContext,
  isValidDateKey,
  prettifyEmailName,
  renderTemplate,
  resolveTimeZone,
} from './template-renderer';

export type TemplateScope = 'shared' | 'personal';

export interface TemplateInfo {
  /** Path relative to the templates folder, without `.md` (`Work/Standup`). */
  name: string;
  path: string;
  scope: TemplateScope;
}

export interface TemplateList {
  folder: string;
  templates: TemplateInfo[];
}

/** Request-shaped carrier for the PIN unlock cookie and one-shot header. */
export interface PinUnlockCarrier {
  headers: { cookie?: string; 'x-kalepin-unlock'?: string | string[] };
}

/** Who is creating: the canonical email drives every visibility check. */
export interface TemplateActor {
  email: string;
  userId?: number;
  unlock?: PinUnlockCarrier;
}

export interface CreatedNote {
  path: string;
  id: string | null;
  created: boolean;
}

export const DAILY_TEMPLATE_NAME = 'Daily.md';
export const DEFAULT_DAILY_TEMPLATE = '# {{date:dddd, MMMM D, YYYY}}\n\n';
export const SAMPLE_TEMPLATE_NAME = 'Meeting notes.md';
export const SAMPLE_TEMPLATE = [
  '# {{title}}',
  '',
  '**Date:** {{date:dddd, MMMM D, YYYY}} at {{time}}',
  '**Organizer:** {{author}}',
  '',
  '## Attendees',
  '',
  '- ',
  '',
  '## Agenda',
  '',
  '1. ',
  '',
  '## Notes',
  '',
  '## Action items',
  '',
  '- [ ] ',
  '',
].join('\n');

const NO_UNLOCK: PinUnlockCarrier = { headers: {} };

@Injectable()
export class TemplatesService {
  private readonly logger = new Logger(TemplatesService.name);
  readonly config: TemplatesConfig;
  /** Per-path promise chains: serialize check-then-create on one path. */
  private readonly locks = new Map<string, Promise<unknown>>();
  /** Overridable in tests. */
  clock: () => Date = () => new Date();

  constructor(
    @Inject(STORAGE_ADAPTER) private readonly storage: StorageAdapter,
    private readonly files: FilesService,
    @Optional() private readonly docHandles?: DocHandlesService,
    @Optional() private readonly pin?: PinService,
    @Optional() @InjectRepository(User) private readonly users?: Repository<User>,
    @Optional() @Inject(TEMPLATES_CONFIG) config?: TemplatesConfig,
  ) {
    this.config = config ?? readTemplatesConfig();
    if (!config) this.warnOnIgnoredSettings();
  }

  private warnOnIgnoredSettings(): void {
    const settings: [string, string][] = [
      ['TEMPLATES_FOLDER', this.config.templatesFolder],
      ['DAILY_NOTES_FOLDER', this.config.dailyNotesFolder],
    ];
    for (const [name, used] of settings) {
      const raw = process.env[name]?.trim().replace(/^\/+|\/+$/g, '');
      if (raw && raw !== used) this.logger.warn(`${name}="${process.env[name]}" is not a valid folder; using "${used}"`);
    }
  }

  /**
   * Shared templates plus the caller's own personal ones. The personal folder
   * is derived from the caller's email, so another user's templates are never
   * enumerated — grants included.
   */
  async listTemplates(email: string): Promise<TemplateList> {
    const folder = this.config.templatesFolder;
    const shared = await this.collect(folder, 'shared', email);
    const personal = this.config.personalEnabled
      ? await this.collect(`${personalRootFor(email)}/${folder}`, 'personal', email)
      : [];
    return { folder, templates: [...shared, ...personal] };
  }

  private async collect(root: string, scope: TemplateScope, email: string): Promise<TemplateInfo[]> {
    let entries: FileEntry[];
    try {
      entries = await this.storage.list(root);
    } catch {
      return []; // folder does not exist
    }
    const out: TemplateInfo[] = [];
    const walk = (list: FileEntry[]) => {
      for (const e of list) {
        if (e.type === 'directory') {
          if (e.name !== '_attachments') walk(e.children ?? []);
          continue;
        }
        if (!e.path.toLowerCase().endsWith('.md')) continue;
        if (!isVisibleTo(e.path, email) || isE2EPath(e.path)) continue;
        out.push({
          name: e.path.slice(root.length + 1).replace(/\.md$/i, ''),
          path: e.path,
          scope,
        });
      }
    };
    walk(entries);
    return out.sort((a, b) => a.name.localeCompare(b.name));
  }

  /**
   * Map a template argument to a path: a listed template's path, then a
   * listed name (personal wins), else the argument itself as a vault path.
   * Read checks happen in `readTemplate`, not here.
   */
  async resolveTemplateRef(ref: string, email: string): Promise<string> {
    const raw = (ref ?? '').trim().replace(/^\/+/, '');
    if (!raw) throw new BadRequestException('template is required');
    const key = raw.toLowerCase().replace(/\.md$/, '');
    const { templates } = await this.listTemplates(email);
    const byPath = templates.find((t) => t.path.toLowerCase().replace(/\.md$/, '') === key);
    if (byPath) return byPath.path;
    const byName = templates.filter((t) => t.name.toLowerCase() === key);
    const named = byName.find((t) => t.scope === 'personal') ?? byName[0];
    if (named) return named.path;
    return raw.toLowerCase().endsWith('.md') ? raw : `${raw}.md`;
  }

  /**
   * Read a template with the same gates as reading any note. Visibility runs
   * before the PIN check so a lock never reveals an invisible note.
   */
  async readTemplate(templatePath: string, actor: TemplateActor): Promise<string> {
    if (isE2EPath(templatePath)) {
      throw new BadRequestException('Templates in the Encrypted Folder are not supported');
    }
    if (!templatePath.toLowerCase().endsWith('.md')) {
      throw new BadRequestException('A template must be a markdown note');
    }
    await this.files.assertReadable(templatePath, actor.email);
    await this.pin?.assertUnlockedForRequest(actor.unlock ?? NO_UNLOCK, templatePath, actor.email);
    return this.files.readFile(templatePath, actor.email);
  }

  /** Resolve, read and render a template for a note named `title`. */
  async renderTemplateRef(
    ref: string,
    opts: { title: string; timezone?: string },
    actor: TemplateActor,
  ): Promise<string> {
    const source = await this.readTemplate(await this.resolveTemplateRef(ref, actor.email), actor);
    return renderTemplate(source, { ...(await this.baseContext(actor.email, opts.timezone)), title: opts.title });
  }

  /**
   * Create a note in `parentPath` from a template, reusing `createItem`'s
   * naming and collision rules; `{{title}}` is the resolved leaf name.
   */
  async createFromTemplate(
    input: { parentPath: string; name?: string; template: string; timezone?: string },
    actor: TemplateActor,
  ): Promise<{ path: string }> {
    const parent = (input.parentPath || '').replace(/^\/+|\/+$/g, '');
    // The server cannot write E2E envelopes; rendering here would leave plaintext.
    if (isE2EPath(parent)) {
      throw new BadRequestException('Templates cannot be used in the Encrypted Folder');
    }
    const source = await this.readTemplate(await this.resolveTemplateRef(input.template, actor.email), actor);
    const ctx = await this.baseContext(actor.email, input.timezone);
    return this.files.createItem(
      'note',
      parent,
      input.name,
      actor.userId,
      actor.email,
      (leaf) => renderTemplate(source, { ...ctx, title: leaf }),
    );
  }

  dailyNotePath(date: string, email: string): string {
    const folder = this.config.dailyNotesFolder;
    const base = this.config.personalEnabled ? `${personalRootFor(email)}/${folder}` : folder;
    return `${base}/${date}.md`;
  }

  /**
   * Return the caller's note for `date`, creating it from `Daily.md` (or the
   * built-in heading) when missing. An existing note is returned untouched;
   * concurrent calls create it once.
   */
  async dailyNote(input: { date: string; timezone?: string }, actor: TemplateActor): Promise<CreatedNote> {
    if (!isValidDateKey(input.date)) {
      throw new BadRequestException('date must be a valid YYYY-MM-DD date');
    }
    const path = this.dailyNotePath(input.date, actor.email);
    await this.files.assertWritable(path, actor.email);
    const created = await this.withPathLock(path, async () => {
      if (await this.storage.exists(path)) return false;
      const content = await this.renderDailyContent(input.date, input.timezone, actor);
      await this.files.createFile(path, content, actor.userId, undefined, actor.email);
      return true;
    });
    return { path, id: await this.handleFor(path), created };
  }

  private async renderDailyContent(date: string, timezone: string | undefined, actor: TemplateActor): Promise<string> {
    const templatePath = await this.findDailyTemplate(actor.email);
    const source = templatePath ? await this.readTemplate(templatePath, actor) : DEFAULT_DAILY_TEMPLATE;
    const ctx = await this.baseContext(actor.email, timezone);
    return renderTemplate(source, { ...ctx, title: date, date });
  }

  /** `Daily.md` in the personal templates folder, else the shared one. */
  private async findDailyTemplate(email: string): Promise<string | null> {
    const folder = this.config.templatesFolder;
    const candidates = [
      ...(this.config.personalEnabled ? [`${personalRootFor(email)}/${folder}/${DAILY_TEMPLATE_NAME}`] : []),
      `${folder}/${DAILY_TEMPLATE_NAME}`,
    ];
    for (const candidate of candidates) {
      if (await this.storage.exists(candidate)) return candidate;
    }
    return null;
  }

  /** Create the shared sample template unless it already exists. */
  async createSampleTemplate(actor: TemplateActor): Promise<CreatedNote> {
    const path = `${this.config.templatesFolder}/${SAMPLE_TEMPLATE_NAME}`;
    await this.files.assertWritable(path, actor.email);
    const created = await this.withPathLock(path, async () => {
      if (await this.storage.exists(path)) return false;
      await this.files.createFile(path, SAMPLE_TEMPLATE, actor.userId, undefined, actor.email);
      return true;
    });
    return { path, id: await this.handleFor(path), created };
  }

  private async handleFor(path: string): Promise<string | null> {
    return this.docHandles ? this.docHandles.findOrCreateForPath(path) : null;
  }

  private async baseContext(email: string, timezone?: string): Promise<Omit<TemplateContext, 'title'>> {
    return {
      author: await this.authorName(email),
      authorEmail: email,
      now: this.clock(),
      timeZone: resolveTimeZone(timezone),
    };
  }

  /** Display name when set, else the prettified email local part. */
  private async authorName(email: string): Promise<string> {
    try {
      const user = await this.users?.findOne({ where: { email } });
      const displayName = user?.displayName?.trim();
      if (displayName) return displayName;
    } catch (err) {
      this.logger.warn(`author lookup failed for ${email}: ${(err as Error).message}`);
    }
    return prettifyEmailName(email);
  }

  private async withPathLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const previous = this.locks.get(key) ?? Promise.resolve();
    const run = previous.catch(() => undefined).then(fn);
    const tail = run.catch(() => undefined);
    this.locks.set(key, tail);
    try {
      return await run;
    } finally {
      if (this.locks.get(key) === tail) this.locks.delete(key);
    }
  }
}
