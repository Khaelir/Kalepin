import 'reflect-metadata';
import { describe, it, beforeEach, afterEach } from 'node:test';
import * as assert from 'node:assert/strict';
import { NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { DocHandle } from '../entities/doc-handle.entity';
import { DocHandlesService } from '../doc-handles';
import type { RelatedNotesResult } from '../search/related-notes.service';
import { McpService } from './mcp.service';

const BOB = 'bob@example.com';
const ALICE_NOTE = '_users/alice@example.com/diary.md';
const ID_RE = /^[A-Z2-7]{16}$/;

let ds: DataSource;
let docHandles: DocHandlesService;
let service: McpService;
let files: Map<string, string>;
let pinned: Set<string>;
let relatedCalls: { path: string; opts: { limit?: number; userEmail?: string } }[];
let relatedResult: RelatedNotesResult;
let clients: Client[];

function visibleTo(path: string, email: string): boolean {
  return !path.startsWith('_users/') || path.startsWith(`_users/${email}/`);
}

async function connect(scope?: string): Promise<Client> {
  const server = (service as any).createMcpServer({ sub: 2, email: BOB, scope });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: 'related-notes-test', version: '0' });
  await client.connect(clientTransport);
  clients.push(client);
  return client;
}

async function call(args: Record<string, unknown>): Promise<string> {
  const client = clients[0] ?? (await connect());
  const res = await client.callTool({ name: 'related_notes', arguments: args });
  return (res.content as { text: string }[]).map((c) => c.text).join('\n');
}

beforeEach(async () => {
  ds = new DataSource({ type: 'better-sqlite3', database: ':memory:', entities: [DocHandle], synchronize: true });
  await ds.initialize();
  docHandles = new DocHandlesService(ds.getRepository(DocHandle));
  files = new Map([
    ['Notes/plan.md', 'deploy plan'],
    ['Notes/runbook.md', 'deploy runbook'],
    ['Notes/locked.md', 'secret plan'],
    [ALICE_NOTE, 'diary'],
    ['_users/bob@example.com/_secure/journal.md', 'ciphertext'],
  ]);
  pinned = new Set();
  relatedCalls = [];
  clients = [];
  relatedResult = {
    available: true,
    items: [{
      path: 'Notes/runbook.md',
      title: 'runbook',
      score: 0.912345,
      linked: false,
      reason: { heading: 'Deployment', sourceHeading: 'Rollout', excerpt: 'Build the image…' },
    }],
  };

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
  };
  const relatedNotes = {
    async findRelated(path: string, opts: { limit?: number; userEmail?: string }) {
      relatedCalls.push({ path, opts });
      return relatedResult;
    },
  };

  service = new McpService(
    filesService as any,
    { search: async () => [] } as any,
    { getComments: async () => [] } as any,
    { getChangesSince: async () => ({}) } as any,
    { logToolCall: async () => {} } as any,
    null as any,
    null as any,
    { isE2EEncrypted: (p: string) => p.includes('/_secure/') } as any,
    { hasPin: async (p: string) => pinned.has(p), validateUnlockToken: () => null } as any,
    { assertReadableBy, assertCommentableBy: assertReadableBy } as any,
    docHandles,
    undefined,
    undefined,
    undefined,
    relatedNotes as any,
  );
});

afterEach(async () => {
  for (const c of clients) await c.close();
  service.onModuleDestroy();
  await ds.destroy();
});

describe('MCP related_notes', () => {
  it('resolves a note id and returns related notes with their own ids', async () => {
    const id = await docHandles.findOrCreateForPath('Notes/plan.md');
    const items = JSON.parse(await call({ id, limit: 3 }));
    assert.deepEqual(relatedCalls, [{ path: 'Notes/plan.md', opts: { limit: 3, userEmail: BOB } }]);
    assert.equal(items.length, 1);
    assert.match(items[0].id, ID_RE);
    assert.equal(items[0].id, await docHandles.forPath('Notes/runbook.md'));
    assert.deepEqual(
      { ...items[0], id: undefined },
      {
        path: 'Notes/runbook.md',
        id: undefined,
        title: 'runbook',
        score: 0.912,
        linked: false,
        reason: { heading: 'Deployment', sourceHeading: 'Rollout', excerpt: 'Build the image…' },
      },
    );
  });

  it('resolves a fuzzy path like the other note tools', async () => {
    JSON.parse(await call({ path: 'plan' }));
    assert.equal(relatedCalls[0].path, 'Notes/plan.md');
  });

  it("does not resolve another user's note by path or id", async () => {
    const id = await docHandles.findOrCreateForPath(ALICE_NOTE);
    assert.match(await call({ id }), /^No notes found/);
    assert.match(await call({ path: ALICE_NOTE }), /^No notes found/);
    assert.equal(relatedCalls.length, 0);
  });

  it('returns the pin-protected sentinel for a locked note', async () => {
    pinned.add('Notes/locked.md');
    assert.deepEqual(JSON.parse(await call({ path: 'Notes/locked.md' })), { kind: 'pin-protected', path: 'Notes/locked.md' });
    assert.equal(relatedCalls.length, 0);
  });

  it('explains end-to-end encrypted notes instead of ranking them', async () => {
    assert.match(await call({ path: '_users/bob@example.com/_secure/journal.md' }), /^kind: e2e-encrypted/);
    assert.equal(relatedCalls.length, 0);
  });

  it('says so when the semantic index is unavailable', async () => {
    relatedResult = { available: false, items: [] };
    assert.match(await call({ path: 'Notes/plan.md' }), /unavailable/);
  });

  it('is registered for read-only keys', async () => {
    const client = await connect('ro');
    const { tools } = await client.listTools();
    assert.ok(tools.some((t) => t.name === 'related_notes'));
    assert.ok(!tools.some((t) => t.name === 'edit_note'));
  });
});
