import 'reflect-metadata';
import { describe, it, before, after, beforeEach, afterEach } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { DataSource, Repository } from 'typeorm';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { LocalFSAdapter } from '../storage/local-fs.adapter';
import { RoutingStorageAdapter } from '../storage/routing-fs.adapter';
import { FilesService } from '../files/files.service';
import { VaultController } from '../files/vault.controller';
import { GrantsService } from '../grants/grants.service';
import { GrantAwareVisibility } from '../auth/grant-aware-visibility.service';
import { DocHandlesService } from '../doc-handles/doc-handles.service';
import { PinService, PinLockedException } from '../pin/pin.service';
import { DocumentGrant } from '../entities/document-grant.entity';
import { DocHandle } from '../entities/doc-handle.entity';
import { NoteMeta } from '../entities/note-meta.entity';
import { User } from '../entities/user.entity';
import { TemplatesConfig } from './templates.config';
import {
  DEFAULT_DAILY_TEMPLATE,
  SAMPLE_TEMPLATE,
  TemplateActor,
  TemplatesService,
} from './templates.service';

const ALICE = 'alice@example.com';
const BOB = 'bob@example.com';
const ALICE_ROOT = `_users/${ALICE}`;
// Thursday 2026-03-05 14:07 UTC.
const NOW = new Date('2026-03-05T14:07:00Z');

let tmpRoot: string;
let sharedRoot: string;
let personalRoot: string;
let routing: RoutingStorageAdapter;
let ds: DataSource;
let grants: GrantsService;
let docHandles: DocHandlesService;
let pin: PinService;
let users: Repository<User>;
let files: FilesService;
let createFileCalls: string[];

const alice: TemplateActor = { email: ALICE, userId: 1 };
const bob: TemplateActor = { email: BOB, userId: 2 };

function makeService(config: Partial<TemplatesConfig> = {}): TemplatesService {
  const service = new TemplatesService(routing, files, docHandles, pin, users, {
    templatesFolder: 'Templates',
    dailyNotesFolder: 'Journal',
    personalEnabled: true,
    ...config,
  });
  service.clock = () => NOW;
  return service;
}

/** Write straight to storage, bypassing FilesService (fixtures, not under test). */
async function plant(p: string, content: string): Promise<void> {
  await routing.write(p, content);
}

async function read(p: string): Promise<string> {
  return routing.read(p);
}

before(async () => {
  process.env.JWT_SECRET = 'test-secret';
  tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'kalepin-templates-'));
  sharedRoot = path.join(tmpRoot, 'vault');
  personalRoot = path.join(tmpRoot, 'personal');
});

after(async () => {
  if (tmpRoot) await fs.rm(tmpRoot, { recursive: true, force: true });
});

beforeEach(async () => {
  await fs.rm(sharedRoot, { recursive: true, force: true });
  await fs.rm(personalRoot, { recursive: true, force: true });
  await fs.mkdir(sharedRoot, { recursive: true });
  await fs.mkdir(personalRoot, { recursive: true });
  routing = new RoutingStorageAdapter(new LocalFSAdapter(sharedRoot), new LocalFSAdapter(personalRoot));
  await routing.ensurePersonalFolder(ALICE);
  await routing.ensurePersonalFolder(BOB);

  ds = new DataSource({
    type: 'better-sqlite3',
    database: ':memory:',
    entities: [DocumentGrant, DocHandle, NoteMeta, User],
    synchronize: true,
  });
  await ds.initialize();
  grants = new GrantsService(ds.getRepository(DocumentGrant));
  docHandles = new DocHandlesService(ds.getRepository(DocHandle));
  pin = new PinService(ds.getRepository(NoteMeta));
  users = ds.getRepository(User);
  files = new FilesService(
    routing as any,
    undefined, undefined, undefined, undefined, undefined,
    new GrantAwareVisibility(grants),
    grants,
    undefined,
    docHandles,
  );
  createFileCalls = [];
  const realCreateFile = files.createFile.bind(files);
  files.createFile = async (p: string, ...rest: any[]) => {
    createFileCalls.push(p);
    return (realCreateFile as any)(p, ...rest);
  };
});

afterEach(async () => {
  // Let fire-and-forget handle mints settle before the DB goes away.
  await new Promise((r) => setTimeout(r, 10));
  await ds.destroy();
});

describe('TemplatesService.listTemplates — visibility', () => {
  it('lists shared templates and the caller\'s own personal templates', async () => {
    await plant('Templates/Meeting notes.md', '# {{title}}');
    await plant('Templates/Weekly review.md', '# Week');
    await plant(`${ALICE_ROOT}/Templates/Diary.md`, '# Diary');
    const service = makeService();

    const { folder, templates } = await service.listTemplates(ALICE);
    assert.equal(folder, 'Templates');
    assert.deepEqual(templates, [
      { name: 'Meeting notes', path: 'Templates/Meeting notes.md', scope: 'shared' },
      { name: 'Weekly review', path: 'Templates/Weekly review.md', scope: 'shared' },
      { name: 'Diary', path: `${ALICE_ROOT}/Templates/Diary.md`, scope: 'personal' },
    ]);
  });

  it('never lists another user\'s personal templates', async () => {
    await plant('Templates/Meeting notes.md', 'x');
    await plant(`${ALICE_ROOT}/Templates/Diary.md`, 'secret');
    await plant(`${ALICE_ROOT}/Templates/Sub/Deep.md`, 'secret');

    const { templates } = await makeService().listTemplates(BOB);
    assert.deepEqual(templates.map((t) => t.path), ['Templates/Meeting notes.md']);
    assert.ok(!JSON.stringify(templates).includes(ALICE));
  });

  it('does not list a foreign template even when the caller holds a grant on it', async () => {
    const diary = `${ALICE_ROOT}/Templates/Diary.md`;
    await plant(diary, 'secret');
    await grants.mint({ grantorEmail: ALICE, granteeEmail: BOB, path: diary, permission: 'read' });

    const { templates } = await makeService().listTemplates(BOB);
    assert.deepEqual(templates, []);
  });

  it('includes subfolders and skips non-markdown files and attachments', async () => {
    await plant('Templates/Work/Standup.md', 'x');
    await plant('Templates/logo.png', 'x');
    await plant('Templates/_attachments/a.md', 'x');
    await plant('Templates/.hidden.md', 'x');

    const { templates } = await makeService().listTemplates(BOB);
    assert.deepEqual(templates, [{ name: 'Work/Standup', path: 'Templates/Work/Standup.md', scope: 'shared' }]);
  });

  it('uses the configured folder name', async () => {
    await plant('Blueprints/Retro.md', 'x');
    await plant('Templates/Old.md', 'x');
    await plant(`${ALICE_ROOT}/Blueprints/Mine.md`, 'x');

    const { folder, templates } = await makeService({ templatesFolder: 'Blueprints' }).listTemplates(ALICE);
    assert.equal(folder, 'Blueprints');
    assert.deepEqual(templates.map((t) => t.path), ['Blueprints/Retro.md', `${ALICE_ROOT}/Blueprints/Mine.md`]);
  });

  it('returns an empty list when no templates folder exists', async () => {
    const result = await makeService().listTemplates(ALICE);
    assert.deepEqual(result, { folder: 'Templates', templates: [] });
  });

  it('skips personal templates when personal folders are disabled', async () => {
    await plant(`${ALICE_ROOT}/Templates/Diary.md`, 'x');
    const { templates } = await makeService({ personalEnabled: false }).listTemplates(ALICE);
    assert.deepEqual(templates, []);
  });
});

describe('TemplatesService.createFromTemplate', () => {
  it('creates the note in the folder with the rendered template', async () => {
    await plant('Templates/Meeting.md', '# {{title}}\n{{date:dddd}} {{time}} — {{author}} <{{author_email}}>\n');
    const service = makeService();

    const { path: created } = await service.createFromTemplate(
      { parentPath: 'Projects', name: 'Kickoff', template: 'Templates/Meeting.md', timezone: 'Europe/Paris' },
      alice,
    );
    assert.equal(created, 'Projects/Kickoff.md');
    assert.equal(await read(created), '# Kickoff\nThursday 15:07 — Alice <alice@example.com>\n');
  });

  it('renders {{title}} from the collision-resolved name', async () => {
    await plant('Templates/Meeting.md', '# {{title}}');
    await plant('Projects/Untitled note.md', 'existing');
    const service = makeService();

    const { path: created } = await service.createFromTemplate(
      { parentPath: 'Projects', template: 'Templates/Meeting.md', timezone: 'UTC' },
      alice,
    );
    assert.equal(created, 'Projects/Untitled note 2.md');
    assert.equal(await read(created), '# Untitled note 2');
    assert.equal(await read('Projects/Untitled note.md'), 'existing');
  });

  it('resolves a template by name, preferring the personal one', async () => {
    await plant('Templates/Standup.md', 'shared');
    await plant(`${ALICE_ROOT}/Templates/Standup.md`, 'personal');
    const service = makeService();

    const a = await service.createFromTemplate({ parentPath: '', name: 'A', template: 'standup' }, alice);
    assert.equal(await read(a.path), 'personal');
    const b = await service.createFromTemplate({ parentPath: '', name: 'B', template: 'Standup' }, bob);
    assert.equal(await read(b.path), 'shared');
    const c = await service.createFromTemplate({ parentPath: '', name: 'C', template: 'Templates/Standup' }, alice);
    assert.equal(await read(c.path), 'shared', 'an explicit path wins over a personal name match');
  });

  it('uses the display name for {{author}} when one is set', async () => {
    await users.save(users.create({ email: ALICE, displayName: 'Alice Martin', completedTours: [] }));
    await plant('Templates/Sig.md', '{{author}}');
    const { path: created } = await makeService().createFromTemplate({ parentPath: '', name: 'n', template: 'Sig' }, alice);
    assert.equal(await read(created), 'Alice Martin');
  });

  it('returns 404 for another user\'s personal template and creates nothing', async () => {
    await plant(`${ALICE_ROOT}/Templates/Diary.md`, 'secret');
    const service = makeService();

    await assert.rejects(
      () => service.createFromTemplate({ parentPath: '', name: 'Stolen', template: `${ALICE_ROOT}/Templates/Diary.md` }, bob),
      NotFoundException,
    );
    // A bare name does not resolve to Alice's template either.
    await assert.rejects(
      () => service.createFromTemplate({ parentPath: '', name: 'Stolen', template: 'Diary' }, bob),
      NotFoundException,
    );
    assert.equal(await routing.exists('Stolen.md'), false);
  });

  it('rejects dot-segment template paths', async () => {
    await plant(`${ALICE_ROOT}/Templates/Diary.md`, 'secret');
    await assert.rejects(
      () => makeService().createFromTemplate(
        { parentPath: '', name: 'x', template: `_users/${BOB}/../${ALICE}/Templates/Diary.md` },
        bob,
      ),
      NotFoundException,
    );
  });

  it('allows a grantee to use a note they can read, like any read', async () => {
    const diary = `${ALICE_ROOT}/Templates/Diary.md`;
    await plant(diary, 'shared with bob');
    await grants.mint({ grantorEmail: ALICE, granteeEmail: BOB, path: diary, permission: 'read' });

    const { path: created } = await makeService().createFromTemplate({ parentPath: '', name: 'Mine', template: diary }, bob);
    assert.equal(await read(created), 'shared with bob');
  });

  it('requires the PIN unlock for a locked template', async () => {
    await plant('Templates/Locked.md', 'locked body');
    await pin.setPin('Templates/Locked.md', 'abcd1234', ALICE);
    const service = makeService();

    await assert.rejects(
      () => service.createFromTemplate({ parentPath: '', name: 'x', template: 'Templates/Locked.md' }, bob),
      (err: unknown) => err instanceof PinLockedException && (err as PinLockedException).getStatus() === 423,
    );
    assert.equal(await routing.exists('x.md'), false);

    const token = pin.mintUnlockToken('Templates/Locked.md', BOB, 'one-shot');
    const { path: created } = await service.createFromTemplate(
      { parentPath: '', name: 'x', template: 'Templates/Locked.md' },
      { ...bob, unlock: { headers: { 'x-kalepin-unlock': token } } },
    );
    assert.equal(await read(created), 'locked body');
  });

  it('rejects E2E templates and E2E target folders', async () => {
    await plant('Templates/Meeting.md', 'x');
    const service = makeService();
    await assert.rejects(
      () => service.createFromTemplate({ parentPath: '', template: `${ALICE_ROOT}/_secure/T.md` }, alice),
      BadRequestException,
    );
    await assert.rejects(
      () => service.createFromTemplate({ parentPath: `${ALICE_ROOT}/_secure`, template: 'Templates/Meeting.md' }, alice),
      BadRequestException,
    );
    await assert.rejects(
      () => service.createFromTemplate({ parentPath: `${ALICE_ROOT}/_secure/sub`, template: 'Templates/Meeting.md' }, alice),
      BadRequestException,
    );
  });

  it('rejects a non-markdown template and an empty reference', async () => {
    await plant('Templates/logo.png', 'x');
    const service = makeService();
    // A reference without `.md` is read as a note name, so it never reaches the png.
    await assert.rejects(
      () => service.createFromTemplate({ parentPath: '', template: 'Templates/logo.png' }, alice),
      NotFoundException,
    );
    await assert.rejects(() => service.readTemplate('Templates/logo.png', alice), BadRequestException);
    await assert.rejects(() => service.createFromTemplate({ parentPath: '', template: '  ' }, alice), BadRequestException);
  });

  it('refuses to create inside another user\'s personal folder', async () => {
    await plant('Templates/Meeting.md', 'x');
    await assert.rejects(
      () => makeService().createFromTemplate({ parentPath: ALICE_ROOT, name: 'x', template: 'Templates/Meeting.md' }, bob),
      NotFoundException,
    );
  });
});

describe('TemplatesService.renderTemplateRef (MCP create_note)', () => {
  it('renders a named template for an explicit title', async () => {
    await plant('Templates/Meeting notes.md', '# {{title}} ({{date}})');
    const text = await makeService().renderTemplateRef('Meeting notes', { title: 'Sync', timezone: 'UTC' }, alice);
    assert.equal(text, '# Sync (2026-03-05)');
  });
});

describe('TemplatesService.dailyNote', () => {
  it('creates the note in the personal Journal with the default content', async () => {
    const service = makeService();
    const result = await service.dailyNote({ date: '2026-03-05', timezone: 'Europe/Paris' }, alice);

    assert.equal(result.path, `${ALICE_ROOT}/Journal/2026-03-05.md`);
    assert.equal(result.created, true);
    assert.match(result.id ?? '', /^[A-Z2-7]{16}$/);
    assert.equal(DEFAULT_DAILY_TEMPLATE, '# {{date:dddd, MMMM D, YYYY}}\n\n');
    assert.equal(await read(result.path), '# Thursday, March 5, 2026\n\n');
  });

  it('uses the shared Journal folder when personal folders are disabled', async () => {
    const result = await makeService({ personalEnabled: false }).dailyNote({ date: '2026-03-05' }, bob);
    assert.equal(result.path, 'Journal/2026-03-05.md');
  });

  it('uses the configured daily notes folder', async () => {
    const result = await makeService({ dailyNotesFolder: 'Daily' }).dailyNote({ date: '2026-03-05' }, alice);
    assert.equal(result.path, `${ALICE_ROOT}/Daily/2026-03-05.md`);
  });

  it('keeps each user\'s daily note separate', async () => {
    const service = makeService();
    const a = await service.dailyNote({ date: '2026-03-05' }, alice);
    const b = await service.dailyNote({ date: '2026-03-05' }, bob);
    assert.notEqual(a.path, b.path);
    assert.equal(b.path, `_users/${BOB}/Journal/2026-03-05.md`);
    assert.equal(b.created, true);
  });

  it('renders the shared Daily.md with the requested day', async () => {
    await plant('Templates/Daily.md', '{{title}} {{date:ddd}} {{time}}');
    const result = await makeService().dailyNote({ date: '2026-12-25', timezone: 'UTC' }, bob);
    assert.equal(await read(result.path), '2026-12-25 Fri 14:07');
  });

  it('prefers the personal Daily.md over the shared one', async () => {
    await plant('Templates/Daily.md', 'shared daily');
    await plant(`${ALICE_ROOT}/Templates/Daily.md`, 'personal daily {{title}}');
    const service = makeService();

    const a = await service.dailyNote({ date: '2026-03-05' }, alice);
    assert.equal(await read(a.path), 'personal daily 2026-03-05');
    const b = await service.dailyNote({ date: '2026-03-05' }, bob);
    assert.equal(await read(b.path), 'shared daily');
  });

  it('returns an existing note unchanged', async () => {
    const service = makeService();
    const first = await service.dailyNote({ date: '2026-03-05' }, alice);
    await routing.write(first.path, 'my edits');

    const second = await service.dailyNote({ date: '2026-03-05' }, alice);
    assert.equal(second.created, false);
    assert.equal(second.path, first.path);
    assert.equal(second.id, first.id);
    assert.equal(await read(first.path), 'my edits');
  });

  it('creates the note exactly once under concurrent requests', async () => {
    await plant('Templates/Daily.md', '# {{title}}');
    const service = makeService();

    const results = await Promise.all(
      Array.from({ length: 5 }, () => service.dailyNote({ date: '2026-03-05' }, alice)),
    );
    assert.equal(results.filter((r) => r.created).length, 1);
    assert.equal(new Set(results.map((r) => r.path)).size, 1);
    assert.equal(new Set(results.map((r) => r.id)).size, 1);
    assert.deepEqual(createFileCalls, [`${ALICE_ROOT}/Journal/2026-03-05.md`]);
    assert.equal(await read(results[0].path), '# 2026-03-05');
  });

  it('keeps serving requests after a failed create', async () => {
    await plant('Templates/Daily.md', 'locked daily');
    await pin.setPin('Templates/Daily.md', 'abcd1234', ALICE);
    const service = makeService();

    await assert.rejects(() => service.dailyNote({ date: '2026-03-05' }, bob), PinLockedException);
    assert.equal(await routing.exists(`_users/${BOB}/Journal/2026-03-05.md`), false);
    await pin.removePin('Templates/Daily.md');
    const ok = await service.dailyNote({ date: '2026-03-05' }, bob);
    assert.equal(ok.created, true);
  });

  it('rejects invalid dates', async () => {
    const service = makeService();
    for (const date of ['2026-02-30', '05/03/2026', '', '2026-03-05/../../x']) {
      await assert.rejects(() => service.dailyNote({ date }, alice), BadRequestException, date);
    }
    assert.deepEqual(createFileCalls, []);
  });
});

describe('TemplatesService.createSampleTemplate', () => {
  it('creates the sample once and never overwrites it', async () => {
    const service = makeService();
    const first = await service.createSampleTemplate(alice);
    assert.equal(first.path, 'Templates/Meeting notes.md');
    assert.equal(first.created, true);
    assert.equal(await read(first.path), SAMPLE_TEMPLATE);
    for (const variable of ['{{title}}', '{{date:', '{{time}}', '{{author}}']) {
      assert.ok(SAMPLE_TEMPLATE.includes(variable), variable);
    }

    await routing.write(first.path, 'custom');
    const second = await service.createSampleTemplate(bob);
    assert.equal(second.created, false);
    assert.equal(await read(first.path), 'custom');

    const { templates } = await service.listTemplates(BOB);
    assert.deepEqual(templates.map((t) => t.name), ['Meeting notes']);
  });

  it('honours the configured folder', async () => {
    const result = await makeService({ templatesFolder: 'Blueprints' }).createSampleTemplate(alice);
    assert.equal(result.path, 'Blueprints/Meeting notes.md');
  });
});

describe('POST /api/vault/items with a template', () => {
  function controller(service: TemplatesService): VaultController {
    return new VaultController(files, { get: () => service } as any);
  }
  const req = (email: string, sub: number) => ({ user: { sub, email }, headers: {} }) as any;

  it('creates from a template and ignores the template field when empty', async () => {
    await plant('Templates/Meeting.md', '# {{title}}');
    const c = controller(makeService());

    const made = await c.createItem(
      { kind: 'note', parent_path: 'Notes', name: 'Sync', template: 'Templates/Meeting.md', timezone: 'UTC' },
      req(ALICE, 1),
    );
    assert.deepEqual(made, { path: 'Notes/Sync.md' });
    assert.equal(await read('Notes/Sync.md'), '# Sync');

    const plain = await c.createItem({ kind: 'note', parent_path: 'Notes', template: '' }, req(ALICE, 1));
    assert.equal(await read(plain.path), '');
  });

  it('rejects a template on a folder', async () => {
    await assert.rejects(
      () => controller(makeService()).createItem(
        { kind: 'folder', parent_path: '', template: 'Templates/Meeting.md' },
        req(ALICE, 1),
      ),
      BadRequestException,
    );
  });
});
