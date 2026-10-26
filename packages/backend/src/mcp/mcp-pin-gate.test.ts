import 'reflect-metadata';
import { describe, it, beforeEach, afterEach } from 'node:test';
import * as assert from 'node:assert/strict';
import { NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { DocHandle } from '../entities/doc-handle.entity';
import { DocHandlesService } from '../doc-handles';
import { McpService } from './mcp.service';

// Every MCP surface that returns note content, quotes it, or writes to the
// note must stop at the PIN, not only read_note / search_notes / get_updates.

const BOB = 'bob@example.com';
const LOCKED = 'Notes/payroll.md';
const SECRET = 'salary-table-SECRET';

let ds: DataSource;
let service: McpService;
let client: Client;
let files: Map<string, string>;
let commentWrites: string[];

async function setup() {
  ds = new DataSource({ type: 'better-sqlite3', database: ':memory:', entities: [DocHandle], synchronize: true });
  await ds.initialize();
  files = new Map([
    [LOCKED, `# Payroll\n${SECRET}\n![](flow.svg)`],
    ['Notes/payroll-2.md', 'public numbers'],
  ]);
  commentWrites = [];

  const filesService = {
    async readFile(path: string) {
      if (!files.has(path)) throw new NotFoundException('File not found');
      return files.get(path)!;
    },
    async listTree() {
      return [...files.keys()].map((p) => ({ name: p.split('/').pop()!, path: p, type: 'file' as const }));
    },
  };
  const commentsService = {
    getComments: async () => [{ id: 't1', quotedText: SECRET, comments: [{ text: SECRET }] }],
    addComment: async (path: string) => { commentWrites.push(path); return { thread: { id: 't2' } }; },
    replyToThread: async (path: string) => { commentWrites.push(path); },
  };
  const allow = async () => {};

  service = new McpService(
    filesService as any,
    { search: async () => [{ path: LOCKED, snippet: SECRET, score: 1 }] } as any,
    commentsService as any,
    { getChangesSince: async () => ({ starred: [], other: [] }) } as any,
    { logToolCall: async () => {} } as any,
    null as any,
    null as any,
    { isE2EEncrypted: () => false } as any,
    { hasPin: async (p: string) => p === LOCKED, validateUnlockToken: () => null } as any,
    { assertReadableBy: allow, assertCommentableBy: allow } as any,
    new DocHandlesService(ds.getRepository(DocHandle)),
  );

  const server = (service as any).createMcpServer({ sub: 2, email: BOB, scope: 'rc' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  client = new Client({ name: 'pin-gate-test', version: '0' });
  await client.connect(clientTransport);
}

async function teardown() {
  await client?.close();
  service?.onModuleDestroy();
  if (ds?.isInitialized) await ds.destroy();
}

async function callText(name: string, args: Record<string, unknown>): Promise<{ text: string; isError: boolean }> {
  const res = await client.callTool({ name, arguments: args });
  return { text: (res.content as { text: string }[]).map((c) => c.text).join('\n'), isError: !!res.isError };
}

async function promptText(name: string, args: Record<string, string>): Promise<string> {
  const res = await client.getPrompt({ name, arguments: args });
  return res.messages.map((m) => (m.content as { text: string }).text).join('\n');
}

describe('MCP PIN gate', () => {
  beforeEach(setup);
  afterEach(teardown);

  it('review-doc returns the sentinel instead of the note', async () => {
    const text = await promptText('review-doc', { path: LOCKED });
    assert.ok(!text.includes(SECRET));
    assert.match(text, /pin-protected/);
  });

  it('summarize-notes leaves locked notes out', async () => {
    const text = await promptText('summarize-notes', { path: 'Notes/' });
    assert.ok(!text.includes(SECRET));
    assert.ok(text.includes('public numbers'));
  });

  it('list_comments does not return threads of a locked note', async () => {
    const { text } = await callText('list_comments', { path: LOCKED });
    assert.ok(!text.includes(SECRET));
    assert.match(text, /pin-protected/);
  });

  it('add_comment refuses a locked note', async () => {
    const { isError } = await callText('add_comment', { path: LOCKED, content: 'hi' });
    assert.ok(isError);
    assert.deepEqual(commentWrites, []);
  });

  it('read_attachment answers before looking inside a locked note', async () => {
    for (const attachmentId of ['flow.svg', 'nope.svg']) {
      const { text } = await callText('read_attachment', { notePath: LOCKED, attachmentId });
      assert.match(text, /pin-protected/);
    }
  });

  it('ambiguous-path listings carry no snippet of a locked note', async () => {
    const { text } = await callText('read_note', { path: 'pay' });
    assert.match(text, /Multiple notes match/);
    assert.ok(!text.includes(SECRET));
    assert.ok(text.includes('public numbers'));
  });
});
