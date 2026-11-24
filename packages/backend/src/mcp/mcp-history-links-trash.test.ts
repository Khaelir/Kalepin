import 'reflect-metadata';
import { describe, it, beforeEach, afterEach } from 'node:test';
import * as assert from 'node:assert/strict';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { DocHandle } from '../entities/doc-handle.entity';
import { DocHandlesService } from '../doc-handles';
import { McpService } from './mcp.service';

// get_links, note_history / read_version / restore_version, list_trash /
// restore_from_trash, and the section options of read_note / append_to_note.

const BOB = 'bob@example.com';
const PLAN = 'Projects/plan.md';
const LOCKED = 'Private/payroll.md';
const SECRET = 'salary-SECRET';

let ds: DataSource;
let docHandles: DocHandlesService;
let service: McpService;
let files: Map<string, string>;
let writes: { path: string; content: string; baseHash?: string }[];
let snapshots: { path: string; content: string }[];
let versions: Map<number, { content: string; partial: boolean }>;
let restoredTrash: string[];
let clients: Client[];

const hash = (s: string) => `h${s.length}:${s.slice(0, 8)}`;

async function setup() {
  ds = new DataSource({ type: 'better-sqlite3', database: ':memory:', entities: [DocHandle], synchronize: true });
  await ds.initialize();
  docHandles = new DocHandlesService(ds.getRepository(DocHandle));
  files = new Map([
    [PLAN, '# Plan\n\n## TODO\n- a\n\n## Notes\nSee [[Spec]].\n'],
    ['Projects/spec.md', '# Spec\nPart of [[plan]].'],
    [LOCKED, `# Payroll\n${SECRET} [[plan]]`],
  ]);
  writes = [];
  snapshots = [];
  restoredTrash = [];
  clients = [];
  versions = new Map([
    [3, { content: '# Plan\n\nOld text.\n', partial: false }],
    [2, { content: '# Plan', partial: true }],
  ]);

  const validateBaseHash = (current: string, baseHash?: string) => {
    if (baseHash && hash(current) !== baseHash) throw new ConflictException('Content has changed');
  };
  const filesService = {
    async readFile(path: string) {
      if (!files.has(path)) throw new NotFoundException('File not found');
      return files.get(path)!;
    },
    async listTree() {
      return [...files.keys()].map((p) => ({ name: p.split('/').pop()!, path: p, type: 'file' as const }));
    },
    computeContentHash: hash,
    validateBaseHash,
    async assertWritable() {},
    async createFile(path: string, content: string, _userId: number, baseHash?: string) {
      validateBaseHash(files.get(path) ?? '', baseHash);
      writes.push({ path, content, baseHash });
      files.set(path, content);
    },
    async deleteFile() {
      return { trashItemId: 'trash-1' };
    },
  };
  const linkIndex = {
    async getBacklinks(target: string) {
      return target === PLAN
        ? [
          { sourcePath: 'Projects/spec.md', lineNumber: 2, context: 'Part of [[plan]].', linkType: 'wikilink' },
          { sourcePath: LOCKED, lineNumber: 2, context: `${SECRET} [[plan]]`, linkType: 'wikilink' },
        ]
        : [];
    },
    async getOutgoingLinks() {
      return [
        { targetPath: 'Projects/spec.md', rawTarget: 'Spec', lineNumber: 7, linkType: 'wikilink' },
        { targetPath: null, rawTarget: 'Missing', lineNumber: 8, linkType: 'wikilink' },
      ];
    },
    async getUnlinkedMentions() {
      return [{ sourcePath: 'Projects/spec.md', lineNumber: 1, context: 'the plan' }];
    },
  };
  const versionHistory = {
    async getHistory() {
      return [
        { id: 4, action: 'modified', userId: 1, userEmail: 'alice@example.com', createdAt: '2026-11-24T10:00:00.000Z' },
        { id: 3, action: 'modified', userId: 2, userEmail: BOB, createdAt: '2026-11-23T10:00:00.000Z' },
        { id: 2, action: 'modified', userId: 2, userEmail: BOB, createdAt: '2026-11-22T10:00:00.000Z' },
        { id: 1, action: 'created', userId: 2, userEmail: BOB, createdAt: '2026-11-21T10:00:00.000Z' },
      ];
    },
    async reconstructVersion(_path: string, changeId: number) {
      return versions.get(changeId) ?? { content: files.get(PLAN)!, partial: false };
    },
    async createPreRestoreSnapshot(path: string, content: string) {
      snapshots.push({ path, content });
    },
  };
  const trash = {
    async list() {
      return [
        { id: 't2', name: 'b.md', originalPath: 'Archive/b.md', originalFolder: 'Archive', kind: 'file', zone: 'shared', deletedByEmail: BOB, deletedAt: Date.UTC(2026, 10, 24), itemCount: 1, canPurge: true },
        { id: 't1', name: 'Old', originalPath: 'Old', originalFolder: '', kind: 'folder', zone: 'shared', deletedByEmail: BOB, deletedAt: Date.UTC(2026, 10, 20), itemCount: 3, canPurge: true },
      ];
    },
    async restore(id: string) {
      if (id !== 't2') throw new NotFoundException('Trash item not found');
      restoredTrash.push(id);
      return { id, path: 'Archive/b.md', kind: 'file' };
    },
  };

  service = new McpService(
    filesService as any,
    { search: async () => [] } as any,
    { getComments: async () => [] } as any,
    { getChangesSince: async () => ({ starred: [], other: [] }) } as any,
    { logToolCall: async () => {} } as any,
    null as any,
    null as any,
    { isE2EEncrypted: () => false } as any,
    { hasPin: async (p: string) => p === LOCKED, validateUnlockToken: () => null } as any,
    { assertReadableBy: async () => {}, assertCommentableBy: async () => {} } as any,
    docHandles,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    linkIndex as any,
    versionHistory as any,
    trash as any,
  );
}

async function connect(scope: string): Promise<Client> {
  const server = (service as any).createMcpServer({ sub: 2, email: BOB, scope });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: 'history-links-trash-test', version: '0' });
  await client.connect(clientTransport);
  clients.push(client);
  return client;
}

async function teardown() {
  for (const c of clients) await c.close();
  service?.onModuleDestroy();
  if (ds?.isInitialized) await ds.destroy();
}

async function call(client: Client, name: string, args: Record<string, unknown>): Promise<{ text: string; isError: boolean }> {
  const res = await client.callTool({ name, arguments: args });
  return { text: (res.content as { text: string }[]).map((c) => c.text).join('\n'), isError: !!res.isError };
}

describe('MCP links, history and trash tools', () => {
  beforeEach(setup);
  afterEach(teardown);

  it('offers the read tools to every scope and the restores to rw only', async () => {
    const reads = ['get_links', 'note_history', 'read_version', 'list_trash'];
    const restores = ['restore_version', 'restore_from_trash'];
    for (const [scope, canRestore] of [['ro', false], ['rc', false], ['rw', true]] as const) {
      const names = (await (await connect(scope)).listTools()).tools.map((t) => t.name);
      for (const n of reads) assert.ok(names.includes(n), `${scope} should see ${n}`);
      for (const n of restores) assert.equal(names.includes(n), canRestore, `${scope} / ${n}`);
    }
  });

  describe('get_links', () => {
    it('lists backlinks and outgoing links with ids, hiding the text of PIN-locked notes', async () => {
      const { text } = await call(await connect('ro'), 'get_links', { path: PLAN });
      const out = JSON.parse(text);
      assert.equal(out.path, PLAN);
      assert.deepEqual(out.backlinks.map((b: any) => b.path), ['Projects/spec.md', LOCKED]);
      assert.equal(out.backlinks[0].context, 'Part of [[plan]].');
      assert.ok(out.backlinks[0].id);
      assert.equal(out.backlinks[1].context, undefined);
      assert.ok(!text.includes(SECRET));
      assert.deepEqual(out.outgoing.map((o: any) => [o.path, o.target]), [['Projects/spec.md', 'Spec'], [null, 'Missing']]);
      assert.equal(out.unlinked_mentions, undefined);
    });

    it('adds unlinked mentions on request', async () => {
      const { text } = await call(await connect('ro'), 'get_links', { path: PLAN, include_unlinked: true });
      assert.deepEqual(JSON.parse(text).unlinked_mentions, [
        { path: 'Projects/spec.md', id: JSON.parse(text).backlinks[0].id, line: 1, context: 'the plan' },
      ]);
    });

    it('stops at the PIN of the note itself', async () => {
      const { text } = await call(await connect('ro'), 'get_links', { path: LOCKED });
      assert.match(text, /pin-protected/);
    });
  });

  describe('note history', () => {
    it('lists changes newest first, up to the limit', async () => {
      const { text } = await call(await connect('ro'), 'note_history', { path: PLAN, limit: 2 });
      const out = JSON.parse(text);
      assert.equal(out.total, 4);
      assert.deepEqual(out.changes.map((c: any) => c.change_id), [4, 3]);
      assert.equal(out.changes[1].author, BOB);
    });

    it('reads one version, and says so when the change is not in the history', async () => {
      const client = await connect('ro');
      const { text } = await call(client, 'read_version', { path: PLAN, change_id: 3 });
      assert.match(text, /change_id: 3/);
      assert.ok(text.endsWith('# Plan\n\nOld text.\n'));
      assert.match((await call(client, 'read_version', { path: PLAN, change_id: 99 })).text, /No change 99/);
    });

    it('keeps past versions of a PIN-locked note behind the PIN', async () => {
      const client = await connect('ro');
      assert.match((await call(client, 'note_history', { path: LOCKED })).text, /pin-protected/);
      assert.match((await call(client, 'read_version', { path: LOCKED, change_id: 3 })).text, /pin-protected/);
    });

    it('restores a version after snapshotting the current content', async () => {
      const before = files.get(PLAN)!;
      const { text, isError } = await call(await connect('rw'), 'restore_version', { path: PLAN, change_id: 3 });
      assert.ok(!isError, text);
      assert.deepEqual(snapshots, [{ path: PLAN, content: before }]);
      assert.deepEqual(writes, [{ path: PLAN, content: '# Plan\n\nOld text.\n', baseHash: hash(before) }]);
    });

    it('refuses a partial version, a stale base_hash and a locked note, writing nothing', async () => {
      const client = await connect('rw');
      assert.ok((await call(client, 'restore_version', { path: PLAN, change_id: 2 })).isError);
      assert.ok((await call(client, 'restore_version', { path: PLAN, change_id: 3, base_hash: 'stale' })).isError);
      const locked = await call(client, 'restore_version', { path: LOCKED, change_id: 3 });
      assert.match(locked.text, /pin-protected/);
      assert.deepEqual(writes, []);
      assert.deepEqual(snapshots, []);
    });
  });

  describe('trash', () => {
    it('lists trash items, filtered by path', async () => {
      const client = await connect('ro');
      const all = JSON.parse((await call(client, 'list_trash', {})).text);
      assert.equal(all.total, 2);
      assert.deepEqual(all.items[0], {
        trash_id: 't2', kind: 'file', original_path: 'Archive/b.md', deleted_by: BOB, deleted_at: '2026-11-24T00:00:00.000Z',
      });
      assert.equal(all.items[1].item_count, 3);
      const filtered = JSON.parse((await call(client, 'list_trash', { query: 'archive' })).text);
      assert.deepEqual(filtered.items.map((i: any) => i.trash_id), ['t2']);
    });

    it('delete_note hands back the trash id that restore_from_trash takes', async () => {
      const client = await connect('rw');
      const deleted = await call(client, 'delete_note', { path: PLAN });
      assert.match(deleted.text, /restore_from_trash \(trash_id: trash-1\)/);
      const restored = await call(client, 'restore_from_trash', { trash_id: 't2' });
      assert.match(restored.text, /^Restored note from Trash: Archive\/b\.md/);
      assert.deepEqual(restoredTrash, ['t2']);
      assert.ok((await call(client, 'restore_from_trash', { trash_id: 'nope' })).isError);
    });
  });

  describe('sections', () => {
    it('read_note returns just the section asked for', async () => {
      const { text } = await call(await connect('ro'), 'read_note', { path: PLAN, section: 'todo' });
      assert.ok(text.endsWith('## TODO\n- a'), text);
      assert.ok(!text.includes('See [[Spec]]'));
      assert.match(text, /contentHash: /);
    });

    it('read_note lists the headings when the section does not exist', async () => {
      const { text } = await call(await connect('ro'), 'read_note', { path: PLAN, section: 'Risks' });
      assert.match(text, /No section "Risks"[\s\S]*## Notes/);
    });

    it('append_to_note under_heading inserts into that section', async () => {
      const before = files.get(PLAN)!;
      const { isError } = await call(await connect('rw'), 'append_to_note', { path: PLAN, content: '- b', under_heading: '## TODO' });
      assert.ok(!isError);
      assert.equal(files.get(PLAN), '# Plan\n\n## TODO\n- a\n- b\n\n## Notes\nSee [[Spec]].\n');
      assert.equal(writes[0].baseHash, hash(before));
    });

    it('append_to_note under_heading fails on an unknown heading without writing', async () => {
      const { text, isError } = await call(await connect('rw'), 'append_to_note', { path: PLAN, content: 'x', under_heading: 'Risks' });
      assert.ok(isError);
      assert.match(text, /No section "Risks"/);
      assert.deepEqual(writes, []);
    });
  });
});
