import 'reflect-metadata';
import { describe, it, beforeEach, afterEach } from 'node:test';
import * as assert from 'node:assert/strict';
import { NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { DocHandle } from '../entities/doc-handle.entity';
import { DocHandlesService } from '../doc-handles';
import { McpService, moveDestination } from './mcp.service';

const BOB = 'bob@example.com';
const NOTE = 'inbox/idea.md';
const LOCKED = 'inbox/payroll.md';

let ds: DataSource;
let docHandles: DocHandlesService;
let service: McpService;
let files: Map<string, string>;
let moves: { src: string; dest: string; email?: string }[];
let clients: Client[];

async function setup() {
  ds = new DataSource({ type: 'better-sqlite3', database: ':memory:', entities: [DocHandle], synchronize: true });
  await ds.initialize();
  docHandles = new DocHandlesService(ds.getRepository(DocHandle));
  files = new Map([
    [NOTE, '# Idea'],
    [LOCKED, '# Payroll'],
    ['_secure/vault.md', 'ciphertext'],
  ]);
  moves = [];
  clients = [];

  const filesService = {
    async readFile(path: string) {
      if (!files.has(path)) throw new NotFoundException('File not found');
      return files.get(path)!;
    },
    async listTree() {
      return [...files.keys()].map((p) => ({ name: p.split('/').pop()!, path: p, type: 'file' as const }));
    },
    // Mirrors what FilesService.move does to the parts move_note relies on.
    async move(src: string, dest: string, email?: string) {
      moves.push({ src, dest, email });
      if (src === dest) return;
      files.set(dest, files.get(src)!);
      files.delete(src);
      await docHandles.updatePathByPath(src, dest);
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
    { isE2EEncrypted: (p: string) => p.startsWith('_secure/') } as any,
    { hasPin: async (p: string) => p === LOCKED, validateUnlockToken: () => null } as any,
    { assertReadableBy: async () => {}, assertCommentableBy: async () => {} } as any,
    docHandles,
  );
}

async function connect(scope: string): Promise<Client> {
  const server = (service as any).createMcpServer({ sub: 2, email: 'Bob@Example.com', scope });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: 'move-note-test', version: '0' });
  await client.connect(clientTransport);
  clients.push(client);
  return client;
}

async function teardown() {
  for (const c of clients) await c.close();
  service?.onModuleDestroy();
  if (ds?.isInitialized) await ds.destroy();
}

async function callText(client: Client, args: Record<string, unknown>): Promise<{ text: string; isError: boolean }> {
  const res = await client.callTool({ name: 'move_note', arguments: args });
  return { text: (res.content as { text: string }[]).map((c) => c.text).join('\n'), isError: !!res.isError };
}

describe('moveDestination', () => {
  it('takes a full destination path as is', () => {
    assert.equal(moveDestination(NOTE, 'projects/idea.md'), 'projects/idea.md');
  });

  it('adds .md when missing', () => {
    assert.equal(moveDestination(NOTE, 'projects/better idea'), 'projects/better idea.md');
  });

  it('keeps the file name when the destination ends with a slash', () => {
    assert.equal(moveDestination(NOTE, 'projects/archive/'), 'projects/archive/idea.md');
    assert.equal(moveDestination(NOTE, '/'), 'idea.md');
  });

  it('drops leading and repeated slashes', () => {
    assert.equal(moveDestination(NOTE, '/projects//idea.md'), 'projects/idea.md');
  });

  it('rejects an empty destination', () => {
    assert.throws(() => moveDestination(NOTE, '  '), /new_path/);
  });
});

describe('MCP move_note', () => {
  beforeEach(setup);
  afterEach(teardown);

  it('is only offered to keys that can write notes', async () => {
    for (const [scope, offered] of [['ro', false], ['rc', false], ['rw', true], ['admin', true]] as const) {
      const client = await connect(scope);
      const names = (await client.listTools()).tools.map((t) => t.name);
      assert.equal(names.includes('move_note'), offered, `scope ${scope}`);
    }
  });

  it('moves a note by id, keeping its id', async () => {
    const client = await connect('rw');
    const id = await docHandles.findOrCreateForPath(NOTE);
    const { text, isError } = await callText(client, { id, new_path: 'projects/archive/' });
    assert.ok(!isError, text);
    assert.deepEqual(moves, [{ src: NOTE, dest: 'projects/archive/idea.md', email: BOB }]);
    assert.equal(text, `Moved note: ${NOTE} → projects/archive/idea.md (id: ${id})`);
  });

  it('renames a note by path', async () => {
    const client = await connect('rw');
    const { isError } = await callText(client, { path: NOTE, new_path: 'inbox/better idea' });
    assert.ok(!isError);
    assert.deepEqual(moves.map((m) => m.dest), ['inbox/better idea.md']);
  });

  it('refuses a PIN-locked note', async () => {
    const client = await connect('rw');
    const { text, isError } = await callText(client, { path: LOCKED, new_path: 'archive/' });
    assert.ok(isError);
    assert.match(text, /pin-protected/);
    assert.deepEqual(moves, []);
  });

  it('refuses moves into or out of the encrypted folder', async () => {
    const client = await connect('rw');
    for (const args of [{ path: NOTE, new_path: '_secure/' }, { path: '_secure/vault.md', new_path: 'inbox/' }]) {
      const { text, isError } = await callText(client, args);
      assert.ok(isError, JSON.stringify(args));
      assert.match(text, /encrypted folder/);
    }
    assert.deepEqual(moves, []);
  });

  it('reports a note that is already at the destination', async () => {
    const client = await connect('rw');
    const { text } = await callText(client, { path: NOTE, new_path: 'inbox/' });
    assert.equal(text, `Note is already at ${NOTE}.`);
  });
});
