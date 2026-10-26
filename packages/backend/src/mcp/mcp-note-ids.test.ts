import 'reflect-metadata';
import { describe, it, beforeEach, afterEach } from 'node:test';
import * as assert from 'node:assert/strict';
import { NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { DocHandle } from '../entities/doc-handle.entity';
import { DocHandlesService } from '../doc-handles';
import type { UpdatesResponse } from '../changes/change-tracking.service';
import { McpService } from './mcp.service';

const BOB = 'bob@example.com';
const ALICE_NOTE = '_users/alice@example.com/diary.md';
const ID_RE = /^[A-Z2-7]{16}$/;

let ds: DataSource;
let docHandles: DocHandlesService;
let service: McpService;
let files: Map<string, string>;
let pinned: Set<string>;
let hidden: Set<string>;
let updates: UpdatesResponse;
let client: Client;

/** Personal folders are owner-only; everything else is shared unless hidden. */
function visibleTo(path: string, email: string): boolean {
  if (hidden.has(path)) return false;
  return !path.startsWith('_users/') || path.startsWith(`_users/${email}/`);
}

async function setup() {
  ds = new DataSource({ type: 'better-sqlite3', database: ':memory:', entities: [DocHandle], synchronize: true });
  await ds.initialize();
  docHandles = new DocHandlesService(ds.getRepository(DocHandle));
  files = new Map();
  pinned = new Set();
  hidden = new Set();
  updates = { period: { since: null, until: '' }, stats: { created: 0, modified: 0, deleted: 0 }, starred: [], other: [] };

  const assertReadableBy = async (path: string, email: string) => {
    if (!visibleTo(path, email)) throw new NotFoundException();
  };
  const filesService = {
    async readFile(path: string, email?: string) {
      if (email) await assertReadableBy(path, email);
      if (!files.has(path)) throw new NotFoundException('File not found');
      return files.get(path)!;
    },
    async listTree(dir: string, email: string) {
      return [...files.keys()]
        .filter((p) => visibleTo(p, email) && p.startsWith(dir))
        .map((p) => ({ name: p.split('/').pop()!, path: p, type: 'file' as const }));
    },
    computeContentHash: (content: string) => String(content.length),
    async createFile(path: string, content: string) {
      files.set(path, content);
    },
    async patchFile(path: string, oldText: string, newText: string, _baseHash: unknown, email: string) {
      await assertReadableBy(path, email);
      files.set(path, files.get(path)!.replace(oldText, newText));
    },
  };
  const searchService = {
    async search(query: string, _source: string, email: string) {
      return [...files.entries()]
        .filter(([p, content]) => visibleTo(p, email) && content.includes(query))
        .map(([path]) => ({ path, snippet: query, score: 1, type: 'note' as const }));
    },
  };

  service = new McpService(
    filesService as any,
    searchService as any,
    { getComments: async () => [] } as any,
    { getChangesSince: async () => updates } as any,
    { logToolCall: async () => {} } as any,
    null as any,
    null as any,
    { isE2EEncrypted: () => false } as any,
    { hasPin: async (p: string) => pinned.has(p), validateUnlockToken: () => null } as any,
    { assertReadableBy, assertCommentableBy: assertReadableBy } as any,
    docHandles,
  );

  const server = (service as any).createMcpServer({ sub: 2, email: BOB });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  client = new Client({ name: 'note-ids-test', version: '0' });
  await client.connect(clientTransport);
}

async function teardown() {
  await client?.close();
  service?.onModuleDestroy();
  if (ds?.isInitialized) await ds.destroy();
}

async function call(name: string, args: Record<string, unknown>): Promise<{ text: string; isError: boolean }> {
  const res = await client.callTool({ name, arguments: args });
  const text = (res.content as { text: string }[]).map((c) => c.text).join('\n');
  return { text, isError: !!res.isError };
}

describe('MCP note ids', () => {
  beforeEach(setup);
  afterEach(teardown);

  it('search_notes returns an id that read_note accepts', async () => {
    files.set('Notes/plan.md', 'quarterly roadmap');
    const results = JSON.parse((await call('search_notes', { query: 'roadmap' })).text);
    assert.equal(results.length, 1);
    assert.match(results[0].id, ID_RE);

    const { text } = await call('read_note', { id: results[0].id });
    assert.match(text, /^path: Notes\/plan\.md$/m);
    assert.match(text, new RegExp(`^id: ${results[0].id}$`, 'm'));
    assert.ok(text.includes(`/doc/${results[0].id})`), 'Open in Kalepin link should use the id');
    assert.ok(text.includes('quarterly roadmap'));
  });

  it('read_note by id follows a rename', async () => {
    files.set('Notes/plan.md', 'v1');
    const id = await docHandles.findOrCreateForPath('Notes/plan.md');
    files.delete('Notes/plan.md');
    files.set('Archive/plan.md', 'v1');
    await docHandles.updatePathByPath('Notes/plan.md', 'Archive/plan.md');

    const { text } = await call('read_note', { id });
    assert.match(text, /^path: Archive\/plan\.md$/m);
  });

  it('patch_note by id edits the note the id points at, ignoring path', async () => {
    files.set('Notes/a.md', 'hello');
    files.set('Notes/b.md', 'hello');
    const id = await docHandles.findOrCreateForPath('Notes/b.md');

    const { text } = await call('patch_note', { id, path: 'Notes/a.md', old_text: 'hello', new_text: 'bye' });
    assert.equal(text, 'Patched note: Notes/b.md');
    assert.equal(files.get('Notes/a.md'), 'hello');
    assert.equal(files.get('Notes/b.md'), 'bye');
  });

  it('a foreign personal note id reads and writes as not found, without echoing its path', async () => {
    files.set(ALICE_NOTE, 'secret');
    const aliceId = await docHandles.findOrCreateForPath(ALICE_NOTE);

    for (const [tool, args] of [
      ['read_note', { id: aliceId }],
      ['patch_note', { id: aliceId, old_text: 'secret', new_text: 'pwned' }],
      ['list_comments', { id: aliceId }],
      ['add_comment', { id: aliceId, content: 'hi' }],
    ] as const) {
      const { text, isError } = await call(tool, args);
      assert.equal(isError, false, `${tool}: ${text}`);
      assert.equal(text, `No notes found matching "${aliceId}".`, tool);
    }
    assert.equal(files.get(ALICE_NOTE), 'secret');

    // A deleted foreign note must look the same as a live one.
    await docHandles.tombstoneByPath(ALICE_NOTE);
    assert.equal((await call('read_note', { id: aliceId })).text, `No notes found matching "${aliceId}".`);
  });

  it('a deleted note id errors as deleted', async () => {
    files.set('Notes/gone.md', 'x');
    const id = await docHandles.findOrCreateForPath('Notes/gone.md');
    files.delete('Notes/gone.md');
    await docHandles.tombstoneByPath('Notes/gone.md');

    const { text, isError } = await call('read_note', { id });
    assert.equal(isError, true);
    assert.ok(text.includes(`Note ${id} has been deleted.`), text);
  });

  it('an unknown id reads as not found', async () => {
    assert.equal((await call('read_note', { id: 'AAAAAAAAAAAAAAAA' })).text, 'No notes found matching "AAAAAAAAAAAAAAAA".');
  });

  it('errors when neither path nor id is given', async () => {
    const { text, isError } = await call('read_note', {});
    assert.equal(isError, true);
    assert.ok(text.includes('Provide either a note path or an id.'), text);
  });

  it('create_note returns the written path and an id read_note accepts', async () => {
    const { text } = await call('create_note', { path: 'Notes/new', content: 'fresh' });
    const m = text.match(/^Created note: Notes\/new\.md \(id: ([A-Z2-7]{16})\)$/);
    assert.ok(m, text);
    assert.ok((await call('read_note', { id: m[1] })).text.includes('fresh'));
  });

  it('create_note checks the PIN of the .md path it writes', async () => {
    files.set('Notes/locked.md', 'keep');
    pinned.add('Notes/locked.md');

    const { text, isError } = await call('create_note', { path: 'Notes/locked', content: 'overwritten' });
    assert.equal(isError, true);
    assert.ok(text.includes('pin-protected'), text);
    assert.equal(files.get('Notes/locked.md'), 'keep');
  });

  it('list_files appends ids only when asked', async () => {
    files.set('Notes/a.md', '');
    files.set('Notes/b.md', '');
    assert.equal((await call('list_files', {})).text, 'Notes/a.md\nNotes/b.md');

    const lines = (await call('list_files', { include_ids: true })).text.split('\n');
    assert.deepEqual(lines, [
      `Notes/a.md\t${await docHandles.forPath('Notes/a.md')}`,
      `Notes/b.md\t${await docHandles.forPath('Notes/b.md')}`,
    ]);
    for (const line of lines) assert.match(line.split('\t')[1], ID_RE);
  });

  it('get_updates carries ids for live and deleted notes, without minting', async () => {
    const liveId = await docHandles.findOrCreateForPath('Notes/live.md');
    const goneId = await docHandles.findOrCreateForPath('Notes/gone.md');
    await docHandles.tombstoneByPath('Notes/gone.md');
    const change = (path: string, action: 'modified' | 'deleted') =>
      ({ path, action, changes: 1, lastChangedAt: '', user: null, diffs: [], metadataOnly: false });
    updates.other = [{
      folder: 'Notes',
      files: [change('Notes/live.md', 'modified'), change('Notes/gone.md', 'deleted'), change('Notes/renamed-since.md', 'modified')],
    }];

    const { other } = JSON.parse((await call('get_updates', {})).text);
    const idByPath = Object.fromEntries(other[0].files.map((f: { path: string; id?: string }) => [f.path, f.id]));
    assert.deepEqual(idByPath, { 'Notes/live.md': liveId, 'Notes/gone.md': goneId, 'Notes/renamed-since.md': undefined });
    assert.equal(await docHandles.forPath('Notes/renamed-since.md'), null);
  });
});

describe('MCP note:// resource', () => {
  beforeEach(setup);
  afterEach(teardown);

  it('reads a note', async () => {
    files.set('plan.md', 'roadmap');
    const res = await client.readResource({ uri: 'note://plan.md' });
    assert.equal((res.contents[0] as { text: string }).text, 'roadmap');
  });

  it('refuses a PIN-locked note without leaking its content', async () => {
    files.set('secret.md', 'the code is 1234');
    pinned.add('secret.md');
    await assert.rejects(
      () => client.readResource({ uri: 'note://secret.md' }),
      (err: Error) => err.message.includes('pin-protected') && !err.message.includes('1234'),
    );
  });

  it('checks visibility before the PIN, so a hidden lock is not revealed', async () => {
    files.set('secret.md', 'x');
    pinned.add('secret.md');
    hidden.add('secret.md');
    await assert.rejects(
      () => client.readResource({ uri: 'note://secret.md' }),
      (err: Error) => !err.message.includes('pin-protected'),
    );
  });
});
