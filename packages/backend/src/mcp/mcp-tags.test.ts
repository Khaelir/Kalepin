import 'reflect-metadata';
import { describe, it, afterEach } from 'node:test';
import * as assert from 'node:assert/strict';
import { DataSource } from 'typeorm';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { DocHandle } from '../entities/doc-handle.entity';
import { DocHandlesService } from '../doc-handles';
import { McpService } from './mcp.service';

let ds: DataSource;
let service: McpService;
let client: Client;

async function setup(opts: {
  scope?: 'ro' | 'rc' | 'rw' | 'admin';
  email?: string;
  pinned?: string[];
  listTags?: (email?: string) => Promise<{ tag: string; count: number }[]>;
  search?: (query: string, source: string, email: string) => Promise<unknown[]>;
}) {
  ds = new DataSource({ type: 'better-sqlite3', database: ':memory:', entities: [DocHandle], synchronize: true });
  await ds.initialize();
  const docHandles = new DocHandlesService(ds.getRepository(DocHandle));
  const pinned = new Set(opts.pinned ?? []);
  service = new McpService(
    {} as any,
    { search: opts.search ?? (async () => []) } as any,
    { getComments: async () => [] } as any,
    {} as any,
    { logToolCall: async () => {} } as any,
    null as any,
    null as any,
    { isE2EEncrypted: () => false } as any,
    { hasPin: async (p: string) => pinned.has(p), validateUnlockToken: () => null } as any,
    {} as any,
    docHandles,
    undefined,
    undefined,
    undefined,
    undefined,
    { listTags: opts.listTags ?? (async () => []) } as any,
  );
  const server = (service as any).createMcpServer({ sub: 2, email: opts.email ?? 'bob@example.com', scope: opts.scope });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  client = new Client({ name: 'tags-test', version: '0' });
  await client.connect(clientTransport);
}

afterEach(async () => {
  await client?.close();
  service?.onModuleDestroy();
  if (ds?.isInitialized) await ds.destroy();
});

async function call(name: string, args: Record<string, unknown> = {}): Promise<string> {
  const res = await client.callTool({ name, arguments: args });
  return (res.content as { text: string }[]).map((c) => c.text).join('\n');
}

describe('MCP list_tags', () => {
  it('is registered for a read-only key and documented as read-only', async () => {
    await setup({ scope: 'ro' });
    const { tools } = await client.listTools();
    const tool = tools.find((t) => t.name === 'list_tags');
    assert.ok(tool, 'list_tags must be registered for ro keys');
    assert.equal(tool!.annotations?.readOnlyHint, true);
    const search = tools.find((t) => t.name === 'search_notes');
    assert.match(search!.description ?? '', /tag:<name>/);
  });

  it('returns the caller\'s visible tags, keyed by the lowercased email', async () => {
    let seen: string | undefined;
    await setup({
      email: 'Bob@Example.com',
      listTags: async (email) => {
        seen = email;
        return [{ tag: 'project', count: 2 }, { tag: 'project/kalepin', count: 1 }];
      },
    });
    const tags = JSON.parse(await call('list_tags'));
    assert.deepEqual(tags, [{ tag: 'project', count: 2 }, { tag: 'project/kalepin', count: 1 }]);
    assert.equal(seen, 'bob@example.com');
  });
});

describe('MCP search_notes with tag: filters', () => {
  it('passes the query through and keeps modifiedAt on tag-only results', async () => {
    let seenQuery = '';
    await setup({
      search: async (query) => {
        seenQuery = query;
        return [{ path: 'Notes/a.md', snippet: 'x', score: 1, modifiedAt: '2026-01-01T00:00:00.000Z' }];
      },
    });
    const results = JSON.parse(await call('search_notes', { query: 'tag:meeting' }));
    assert.equal(seenQuery, 'tag:meeting');
    assert.equal(results[0].path, 'Notes/a.md');
    assert.equal(results[0].modifiedAt, '2026-01-01T00:00:00.000Z');
    assert.match(results[0].id, /^[A-Z2-7]{16}$/);
  });

  it('turns a PIN-locked tagged note into the sentinel', async () => {
    await setup({
      pinned: ['Notes/locked.md'],
      search: async () => [{ path: 'Notes/locked.md', snippet: 'secret body', score: 1, modifiedAt: '2026-01-01T00:00:00.000Z' }],
    });
    const results = JSON.parse(await call('search_notes', { query: 'tag:meeting' }));
    assert.equal(results[0].kind, 'pin-protected');
    assert.equal(results[0].snippet, undefined);
  });
});
