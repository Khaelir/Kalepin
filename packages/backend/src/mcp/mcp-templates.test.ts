import 'reflect-metadata';
import { describe, it, before, after, beforeEach, afterEach } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { DataSource } from 'typeorm';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { LocalFSAdapter } from '../storage/local-fs.adapter';
import { RoutingStorageAdapter } from '../storage/routing-fs.adapter';
import { FilesService } from '../files/files.service';
import { GrantsService } from '../grants/grants.service';
import { GrantAwareVisibility } from '../auth/grant-aware-visibility.service';
import { DocHandlesService } from '../doc-handles/doc-handles.service';
import { PinService } from '../pin/pin.service';
import { DocumentGrant } from '../entities/document-grant.entity';
import { DocHandle } from '../entities/doc-handle.entity';
import { NoteMeta } from '../entities/note-meta.entity';
import { User } from '../entities/user.entity';
import { isE2EPath } from '../crypto/encryption-predicates';
import { TemplatesService } from '../templates/templates.service';
import { todayIn } from '../templates/template-renderer';
import type { ApiKeyScope } from '../auth/permissions';
import { McpService } from './mcp.service';

const ALICE = 'alice@example.com';
const BOB = 'bob@example.com';
const ID_RE = /^[A-Z2-7]{16}$/;

let tmpRoot: string;
let routing: RoutingStorageAdapter;
let ds: DataSource;
let docHandles: DocHandlesService;
let pin: PinService;
let service: McpService;
let clients: Client[];

before(async () => {
  process.env.JWT_SECRET = 'test-secret';
  tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'kalepin-mcp-templates-'));
});

after(async () => {
  if (tmpRoot) await fs.rm(tmpRoot, { recursive: true, force: true });
});

beforeEach(async () => {
  const shared = path.join(tmpRoot, 'vault');
  const personal = path.join(tmpRoot, 'personal');
  await fs.rm(shared, { recursive: true, force: true });
  await fs.rm(personal, { recursive: true, force: true });
  await fs.mkdir(shared, { recursive: true });
  await fs.mkdir(personal, { recursive: true });
  routing = new RoutingStorageAdapter(new LocalFSAdapter(shared), new LocalFSAdapter(personal));

  ds = new DataSource({
    type: 'better-sqlite3',
    database: ':memory:',
    entities: [DocumentGrant, DocHandle, NoteMeta, User],
    synchronize: true,
  });
  await ds.initialize();
  const grants = new GrantsService(ds.getRepository(DocumentGrant));
  const visibility = new GrantAwareVisibility(grants);
  docHandles = new DocHandlesService(ds.getRepository(DocHandle));
  pin = new PinService(ds.getRepository(NoteMeta));
  const files = new FilesService(
    routing as any,
    undefined, undefined, undefined, undefined, undefined,
    visibility,
    grants,
    undefined,
    docHandles,
  );
  const templates = new TemplatesService(routing, files, docHandles, pin, ds.getRepository(User), {
    templatesFolder: 'Templates',
    dailyNotesFolder: 'Journal',
    personalEnabled: true,
  });

  service = new McpService(
    files,
    { search: async () => [] } as any,
    { getComments: async () => [] } as any,
    null as any,
    { logToolCall: async () => {} } as any,
    null as any,
    null as any,
    { isE2EEncrypted: isE2EPath } as any,
    pin,
    visibility,
    docHandles,
    undefined,
    undefined,
    templates,
  );
  clients = [];
});

afterEach(async () => {
  for (const c of clients) await c.close();
  service.onModuleDestroy();
  await new Promise((r) => setTimeout(r, 10));
  await ds.destroy();
});

async function connect(email: string, scope?: ApiKeyScope, pinUnlockHeader?: string): Promise<Client> {
  const server = (service as any).createMcpServer({ sub: 1, email, scope, pinUnlockHeader });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: 'templates-test', version: '0' });
  await client.connect(clientTransport);
  clients.push(client);
  return client;
}

async function call(client: Client, name: string, args: Record<string, unknown>): Promise<{ text: string; isError: boolean }> {
  const res = await client.callTool({ name, arguments: args });
  const text = (res.content as { text: string }[]).map((c) => c.text).join('\n');
  return { text, isError: !!res.isError };
}

describe('MCP create_note with a template', () => {
  it('renders a template by name and appends content', async () => {
    await routing.write('Templates/Meeting notes.md', '# {{title}}\n\nBy {{author}}\n');
    const client = await connect(BOB);

    const { text, isError } = await call(client, 'create_note', {
      path: 'Notes/Sync',
      template: 'Meeting notes',
      content: '- decided X',
      timezone: 'Europe/Paris',
    });
    assert.equal(isError, false, text);
    assert.match(text, /^Created note: Notes\/Sync\.md \(id: [A-Z2-7]{16}\)$/);
    assert.equal(await routing.read('Notes/Sync.md'), '# Sync\n\nBy Bob\n\n- decided X');
  });

  it('still creates a plain note from content alone', async () => {
    const client = await connect(BOB);
    const { isError } = await call(client, 'create_note', { path: 'Notes/plain.md', content: 'hello' });
    assert.equal(isError, false);
    assert.equal(await routing.read('Notes/plain.md'), 'hello');
  });

  it('refuses another user\'s personal template and creates nothing', async () => {
    await routing.write(`_users/${ALICE}/Templates/Diary.md`, 'secret');
    const client = await connect(BOB);

    for (const template of [`_users/${ALICE}/Templates/Diary.md`, 'Diary']) {
      const { text, isError } = await call(client, 'create_note', { path: 'Notes/stolen.md', template });
      assert.equal(isError, true, template);
      assert.ok(!text.includes('secret'));
    }
    assert.equal(await routing.exists('Notes/stolen.md'), false);
  });

  it('reports a PIN-locked template as pin-protected unless unlocked', async () => {
    await routing.write('Templates/Locked.md', 'locked body');
    await pin.setPin('Templates/Locked.md', 'abcd1234', ALICE);

    const locked = await call(await connect(BOB), 'create_note', { path: 'Notes/a.md', template: 'Templates/Locked.md' });
    assert.equal(locked.isError, true);
    assert.match(locked.text, /pin-protected: Templates\/Locked\.md/);
    assert.equal(await routing.exists('Notes/a.md'), false);

    const token = pin.mintUnlockToken('Templates/Locked.md', BOB, 'one-shot');
    const unlocked = await call(await connect(BOB, undefined, token), 'create_note', { path: 'Notes/a.md', template: 'Locked' });
    assert.equal(unlocked.isError, false, unlocked.text);
    assert.equal(await routing.read('Notes/a.md'), 'locked body');
  });

  it('refuses templates into an end-to-end encrypted folder', async () => {
    await routing.write('Templates/Meeting notes.md', 'x');
    const { isError } = await call(await connect(ALICE), 'create_note', {
      path: `_users/${ALICE}/_secure/n.md`,
      template: 'Meeting notes',
    });
    assert.equal(isError, true);
  });
});

describe('MCP daily_note', () => {
  it('creates the note once and returns path, id and content', async () => {
    await routing.write('Templates/Daily.md', '# {{title}}\n');
    const client = await connect(ALICE);

    const first = JSON.parse((await call(client, 'daily_note', { date: '2026-03-05' })).text);
    assert.equal(first.path, `_users/${ALICE}/Journal/2026-03-05.md`);
    assert.match(first.id, ID_RE);
    assert.equal(first.created, true);
    assert.equal(first.content, '# 2026-03-05\n');

    await routing.write(first.path, 'edited');
    const second = JSON.parse((await call(client, 'daily_note', { date: '2026-03-05' })).text);
    assert.deepEqual(second, { path: first.path, id: first.id, created: false, content: 'edited' });
  });

  it('defaults to today in the given timezone', async () => {
    const tz = 'Pacific/Kiritimati';
    const result = JSON.parse((await call(await connect(ALICE), 'daily_note', { timezone: tz })).text);
    assert.equal(result.path, `_users/${ALICE}/Journal/${todayIn(tz)}.md`);
  });

  it('rejects an invalid date', async () => {
    const { isError } = await call(await connect(ALICE), 'daily_note', { date: '2026-02-30' });
    assert.equal(isError, true);
  });

  it('withholds the content of a PIN-locked daily note', async () => {
    const notePath = `_users/${ALICE}/Journal/2026-03-05.md`;
    await routing.write(notePath, 'private thoughts');
    await pin.setPin(notePath, 'abcd1234', ALICE);

    const { text } = await call(await connect(ALICE), 'daily_note', { date: '2026-03-05' });
    const result = JSON.parse(text);
    assert.equal(result.kind, 'pin-protected');
    assert.equal(result.content, undefined);
    assert.ok(!text.includes('private thoughts'));
  });

  it('is registered for write scopes only', async () => {
    const names = async (scope?: ApiKeyScope) =>
      (await (await connect(ALICE, scope)).listTools()).tools.map((t) => t.name);
    assert.ok((await names(undefined)).includes('daily_note'));
    assert.ok((await names('rw')).includes('daily_note'));
    assert.ok(!(await names('ro')).includes('daily_note'));
    assert.ok(!(await names('rc')).includes('daily_note'));
  });
});
