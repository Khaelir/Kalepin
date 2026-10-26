// Phase 4 leak-token property suite for the personal-folders feature.
// See openspec/changes/add-personal-user-folders/design.md
// "The 'no leakage AT ALL' safety net" + tasks 4.1–4.13.
//
// Plant four tokens inside Alice's personal namespace, then exercise every
// authenticated HTTP route, every MCP tool, the WebSocket gateway, the
// download-zip archive, share-link mint, and the file watcher AS BOB.
// Recursively scan every response payload for any of the tokens. A passing
// run proves none of these surfaces leak personal content to a non-owner.
//
// CURRENT STATUS: marked test.fixme per task 4.12. Phases 5–13 of the change
// are landed but the integrated end-to-end harness has not yet been triaged
// against them. Phase 17 (17.1, 17.2) will remove the fixme after the run is
// green on CI; failures discovered there are routed back as bug fixes in the
// corresponding phase, not as test relaxations.

import { test, expect, type APIRequestContext } from '@playwright/test';
import jwt from 'jsonwebtoken';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import WebSocket from 'ws';
import yauzl from 'yauzl';
import Database from 'better-sqlite3';
import {
  BACKEND_PORT,
  PERSONAL_PATH,
  VAULT_PATH,
  DB_PATH,
} from '../playwright.config';

const JWT_SECRET = 'test-secret';
const baseURL = `http://localhost:${BACKEND_PORT}`;

// ---------- Token plant ----------

const RUN = crypto.randomBytes(4).toString('hex');
const PATHTOK = `PATHTOK-${RUN}`;
const BODYTOK = `BODYTOK-${RUN}`;
const ATTACHTOK = `ATTACHTOK-${RUN}`;
const COMMENTTOK = `COMMENTTOK-${RUN}`;
const TOKENS = [PATHTOK, BODYTOK, ATTACHTOK, COMMENTTOK];

const ALICE = 'alice@example.com';
const BOB = 'bob@example.com';
const ALICE_ROOT = `_users/${ALICE}`;
const ALICE_NOTE = `${ALICE_ROOT}/${PATHTOK}.md`;
const ALICE_ATTACHMENT = `${ATTACHTOK}.png`;

// Banned strings the property test scans for. The literal personal-root
// `_users/alice@example.com` covers the case where a response surfaces the
// existence of Alice's namespace without exposing tokenized content.
const BANNED = [...TOKENS, ALICE_ROOT];

// ---------- Auth ----------

let userCounter = 1000;
function makeToken(email: string): string {
  return jwt.sign({ sub: ++userCounter, email }, JWT_SECRET, { expiresIn: '1h' });
}

let aliceToken: string;
let bobToken: string;

function bearer(token: string): { Authorization: string } {
  return { Authorization: `Bearer ${token}` };
}

// ---------- Token scan (recursive) ----------

function scanForTokens(value: unknown, where: string): { trail: string; token: string }[] {
  const found: { trail: string; token: string }[] = [];
  const visit = (v: unknown, trail: string): void => {
    if (typeof v === 'string') {
      for (const t of BANNED) if (v.includes(t)) found.push({ trail, token: t });
      return;
    }
    if (typeof v === 'number' || typeof v === 'boolean' || v === null || v === undefined) return;
    if (Array.isArray(v)) {
      v.forEach((x, i) => visit(x, `${trail}[${i}]`));
      return;
    }
    if (typeof v === 'object') {
      for (const k of Object.keys(v as Record<string, unknown>)) {
        for (const t of BANNED) if (k.includes(t)) found.push({ trail: `${trail}.${k}`, token: t });
        visit((v as Record<string, unknown>)[k], `${trail}.${k}`);
      }
    }
  };
  visit(value, where);
  return found;
}

function scanString(s: string, where: string): { trail: string; token: string }[] {
  const found: { trail: string; token: string }[] = [];
  for (const t of BANNED) if (s.includes(t)) found.push({ trail: where, token: t });
  return found;
}

// ---------- Plant fixtures ----------

async function plantAliceContent(api: APIRequestContext): Promise<void> {
  // 1. Create Alice's personal note with BODYTOK in body.
  const createRes = await api.post(`${baseURL}/api/files/create`, {
    headers: bearer(aliceToken),
    data: {
      path: ALICE_NOTE,
      content: `# Diary\n\n${BODYTOK}\n\n![pic](?name=${ALICE_ATTACHMENT}&doc=${encodeURIComponent(ALICE_NOTE)})\n`,
    },
  });
  expect(createRes.ok(), `create note failed: ${createRes.status()} ${await createRes.text()}`).toBeTruthy();

  // 2. Upload the attachment in Alice's personal namespace.
  const uploadRes = await api.post(`${baseURL}/api/files/upload`, {
    headers: bearer(aliceToken),
    multipart: {
      docPath: ALICE_NOTE,
      file: {
        name: ALICE_ATTACHMENT,
        mimeType: 'image/png',
        buffer: Buffer.from('fake-png-bytes'),
      },
    },
  });
  expect(uploadRes.ok(), `upload failed: ${uploadRes.status()} ${await uploadRes.text()}`).toBeTruthy();

  // 3. Add a comment containing COMMENTTOK on the personal note.
  const commentRes = await api.post(`${baseURL}/api/comments`, {
    headers: bearer(aliceToken),
    data: {
      path: ALICE_NOTE,
      blockId: 'block-1',
      text: COMMENTTOK,
    },
  });
  expect(commentRes.ok(), `comment failed: ${commentRes.status()} ${await commentRes.text()}`).toBeTruthy();

  // 4. Sanity: Alice can read back her own content (so the token plant is real).
  const readBack = await api.get(`${baseURL}/api/files/read?path=${encodeURIComponent(ALICE_NOTE)}`, {
    headers: bearer(aliceToken),
  });
  const body = await readBack.json();
  expect(body.content).toContain(BODYTOK);
}

// ---------- Suite ----------

test.describe.configure({ mode: 'serial' });

test.describe('personal-folder leak-token property suite (Phase 4)', () => {
  // Per task 4.12: the suite is wired into CI as expected-to-fail. Phase 17
  // (17.1, 17.2) flips this to expected-pass after the integrated stack has
  // been triaged. Removing this fixme without that triage is forbidden — any
  // failure discovered here is a missing gate, not a test bug.
  test.skip(
    process.env.LEAK_TOKEN_SUITE_ENABLED !== '1',
    'Phase 4 leak-token suite — expected-to-fail until Phase 17 triage. ' +
    'Set LEAK_TOKEN_SUITE_ENABLED=1 to opt in locally.',
  );

  test.beforeAll(async ({ request }) => {
    aliceToken = makeToken(ALICE);
    bobToken = makeToken(BOB);
    // Bob makes a no-op authenticated call so that ensurePersonalFolder runs
    // for both users (auth.service.ts:3.2). Alice's runs as a side-effect of
    // her note creation.
    await request.get(`${baseURL}/api/files/tree`, { headers: bearer(bobToken) });
    await plantAliceContent(request);
  });

  // -------- 4.4 HTTP route sweep --------

  test('4.4 every HTTP route as Bob does not surface any token', async ({ request }) => {
    const res = await request.get(`${baseURL}/api/__test/routes`, { headers: bearer(bobToken) });
    expect(res.ok()).toBeTruthy();
    const { routes, mcpTools } = await res.json() as {
      routes: { method: string; path: string }[];
      mcpTools: string[];
    };

    // Sanity-check discovery: at minimum every controller's first route must appear.
    const expectFirstRoute = (substring: string): void => {
      expect(
        routes.some((r) => r.path.includes(substring)),
        `route discovery missed ${substring}`,
      ).toBeTruthy();
    };
    expectFirstRoute('/api/files/tree');
    expectFirstRoute('/api/comments');
    expectFirstRoute('/api/share-links');
    expectFirstRoute('/api/links/');
    expectFirstRoute('/api/updates');
    expectFirstRoute('/api/search');
    expect(mcpTools.length).toBeGreaterThan(0);

    // Realistic-params fixture map. Routes not in the map use empty body / no
    // query — the property we're checking (no token in response) is independent
    // of whether the request succeeded; 4xx replies that include path params
    // back are still token-scanned.
    const fixturesForPath = (routePath: string): {
      query?: Record<string, string>;
      body?: unknown;
    } => {
      const probeForeign = ALICE_NOTE;
      const probeShared = 'Notes/known-nonexistent.md';
      const m = (s: string): boolean => routePath.includes(s);
      if (m('/api/files/read')) return { query: { path: probeForeign } };
      if (m('/api/files/headings')) return { query: { path: probeForeign } };
      if (m('/api/files/history')) return { query: { path: probeForeign } };
      if (m('/api/files/version')) return { query: { path: probeForeign, changeId: '1' } };
      if (m('/api/files/restore')) return { body: { path: probeForeign, changeId: 1 } };
      if (m('/api/files/create')) return { body: { path: probeForeign, content: '' } };
      if (m('/api/files/delete')) return { query: { path: probeForeign } };
      if (m('/api/files/directory')) return { body: { path: probeForeign }, query: { path: probeForeign } };
      if (m('/api/files/move')) return { body: { src: probeForeign, dest: 'Notes/x.md' } };
      if (m('/api/files/upload')) return {}; // multipart-only, skipped
      if (m('/api/files/attachment')) return { query: { name: ALICE_ATTACHMENT, doc: probeForeign } };
      if (m('/api/files/attachments/cleanup')) return {};
      if (m('/api/comments/reply')) return { body: { path: probeForeign, blockId: 'b', threadId: 't', text: '' } };
      if (m('/api/comments/resolve')) return { body: { path: probeForeign, blockId: 'b', threadId: 't', resolved: true } };
      if (m('/api/comments')) return { query: { path: probeForeign }, body: { path: probeForeign, blockId: 'b', text: '' } };
      if (m('/api/share-links')) return { body: { path: probeForeign } };
      if (m('/api/links/')) return { query: { path: probeForeign }, body: { path: probeForeign } };
      if (m('/api/updates')) return { query: { since: '0' } };
      if (m('/api/search/related')) return { query: { path: probeForeign } };
      if (m('/api/search')) return { query: { q: BODYTOK } };
      if (m('/api/vault/items')) return { body: { path: probeForeign, type: 'file' } };
      return {};
    };

    const failures: { method: string; path: string; trail: string; token: string }[] = [];

    for (const r of routes) {
      // Skip non-API routes (static files, OAuth pages, /share/:code, etc.)
      // The /share/:code surface is intentionally token-equals-permission and
      // the token-scan invariant does not apply.
      if (!r.path.startsWith('/api/')) continue;
      // Skip the test-debug controller — scanning it would be a tautology.
      if (r.path.startsWith('/api/__test/')) continue;
      // download-zip is exercised as 4.7.
      if (r.path.includes('/api/files/download-zip')) continue;
      // Multipart upload not modelled here.
      if (r.method === 'POST' && r.path.includes('/api/files/upload')) continue;
      // Admin-only endpoints will respond 403 without admin scope; the
      // negative response is still scanned, which is the property we want.

      const fixt = fixturesForPath(r.path);
      const url = new URL(r.path, baseURL);
      for (const [k, v] of Object.entries(fixt.query ?? {})) url.searchParams.set(k, v);
      const opts: Parameters<APIRequestContext['fetch']>[1] = {
        method: r.method,
        headers: { ...bearer(bobToken), 'content-type': 'application/json' },
      };
      if (fixt.body !== undefined && r.method !== 'GET' && r.method !== 'DELETE') {
        opts.data = fixt.body;
      }
      let response;
      try {
        response = await request.fetch(url.toString(), opts);
      } catch {
        continue; // unreachable / unsupported method shape — not a token-leak signal
      }

      const headerHits = scanForTokens(response.headers(), `${r.method} ${r.path} headers`);
      let textBody = '';
      try {
        textBody = await response.text();
      } catch { /* binary or empty */ }
      const bodyHits = scanString(textBody, `${r.method} ${r.path} body`);
      failures.push(...headerHits.map((h) => ({ method: r.method, path: r.path, ...h })));
      failures.push(...bodyHits.map((h) => ({ method: r.method, path: r.path, ...h })));
    }

    expect(failures, `Token leak surfaced on ${failures.length} response(s):\n` +
      failures.map((f) => `  ${f.method} ${f.path} @ ${f.trail} contains "${f.token}"`).join('\n'),
    ).toEqual([]);
  });

  // -------- 4.7 download-zip tar walk --------

  test('4.7 download-zip as Bob contains no Alice tokens', async ({ request }) => {
    const res = await request.get(`${baseURL}/api/files/download-zip`, {
      headers: bearer(bobToken),
    });
    expect(res.ok()).toBeTruthy();
    const buf = Buffer.from(await res.body());

    // yauzl reads zip from buffer
    const failures: { entry: string; token: string }[] = [];
    await new Promise<void>((resolve, reject) => {
      yauzl.fromBuffer(buf, { lazyEntries: true }, (err, zipfile) => {
        if (err || !zipfile) return reject(err ?? new Error('no zipfile'));
        zipfile.readEntry();
        zipfile.on('entry', (entry) => {
          for (const t of BANNED) if (entry.fileName.includes(t)) failures.push({ entry: entry.fileName, token: t });
          if (/\/$/.test(entry.fileName)) {
            zipfile.readEntry();
            return;
          }
          zipfile.openReadStream(entry, (rerr, stream) => {
            if (rerr || !stream) {
              zipfile.readEntry();
              return;
            }
            const chunks: Buffer[] = [];
            stream.on('data', (c: Buffer) => chunks.push(c));
            stream.on('end', () => {
              const content = Buffer.concat(chunks).toString('utf-8');
              for (const t of BANNED) if (content.includes(t)) failures.push({ entry: `${entry.fileName}:body`, token: t });
              zipfile.readEntry();
            });
            stream.on('error', () => zipfile.readEntry());
          });
        });
        zipfile.on('end', () => resolve());
        zipfile.on('error', reject);
      });
    });
    expect(failures, 'download-zip leaked tokens: ' + JSON.stringify(failures)).toEqual([]);
  });

  // -------- 4.9 byte-equality probe --------

  test('4.9 foreign-personal read is byte-identical to nonexistent read', async ({ request }) => {
    const a = await request.get(
      `${baseURL}/api/files/read?path=${encodeURIComponent(ALICE_NOTE)}`,
      { headers: bearer(bobToken) },
    );
    const b = await request.get(
      `${baseURL}/api/files/read?path=${encodeURIComponent(`Notes/known-nonexistent-${RUN}.md`)}`,
      { headers: bearer(bobToken) },
    );

    expect(a.status()).toBe(b.status());
    const cleanHeaders = (h: Record<string, string>): Record<string, string> => {
      const out: Record<string, string> = { ...h };
      delete out.date;
      delete out['content-length']; // body equality is checked separately
      return out;
    };
    expect(cleanHeaders(a.headers())).toEqual(cleanHeaders(b.headers()));
    // Body equality is asserted by content rather than byte-for-byte to tolerate
    // the {"message":"Not Found", path:"..."} echo NestJS sometimes surfaces.
    // The path field MUST NOT echo back a different value depending on existence.
    const aText = await a.text();
    const bText = await b.text();
    // Strip any path echo before comparing — the test asserts the rest of the
    // shape is identical. Both responses MUST be 404 with no token.
    const stripPathEcho = (s: string): string => s.replace(/"path":"[^"]*"/, '"path":""');
    expect(stripPathEcho(aText)).toBe(stripPathEcho(bText));
    expect(scanString(aText, 'foreign-read body')).toEqual([]);
  });

  // -------- 4.10 share-link mint negative --------

  test('4.10 Bob mint share-link for Alice path: 404 + no row inserted', async ({ request }) => {
    const before = readShortLinkRow(ALICE_NOTE);
    const res = await request.post(`${baseURL}/api/share-links`, {
      headers: bearer(bobToken),
      data: { path: ALICE_NOTE },
    });
    expect(res.status()).toBe(404);
    const after = readShortLinkRow(ALICE_NOTE);
    expect(after).toEqual(before);
  });

  // -------- 4.5 doc:open visibility + 4.11 watcher broadcast negative --------

  test('4.5 + 4.11 Bob WS sees no Alice personal events; doc:open returns error', async () => {
    const aliceWs = await openWs(aliceToken);
    const bobWs = await openWs(bobToken);

    const aliceEvents = collectEvents(aliceWs);
    const bobEvents = collectEvents(bobWs);

    // 4.5: Bob attempts doc:open on Alice's personal note. Expect an error frame,
    // not a doc:opened payload.
    bobWs.send(JSON.stringify({ event: 'doc:open', data: { docId: ALICE_NOTE } }));
    await new Promise((r) => setTimeout(r, 500));

    // 4.11: Alice creates a fresh personal note. Bob's WS must not receive any
    // event referencing it; Alice's WS must.
    const newPath = `${ALICE_ROOT}/NEW-${RUN}.md`;
    fs.mkdirSync(path.join(PERSONAL_PATH, ALICE), { recursive: true });
    fs.writeFileSync(path.join(PERSONAL_PATH, ALICE, `NEW-${RUN}.md`), '# new\n', 'utf-8');

    // Control: a shared-vault file change must reach both — confirms the
    // broadcast pipeline is alive (no false negative on the leak assertion).
    const sharedControl = `Notes/control-${RUN}.md`;
    fs.mkdirSync(path.join(VAULT_PATH, 'Notes'), { recursive: true });
    fs.writeFileSync(path.join(VAULT_PATH, sharedControl), '# control\n', 'utf-8');

    await new Promise((r) => setTimeout(r, 5000));

    aliceWs.close();
    bobWs.close();

    const bobLeaks = bobEvents().filter(
      (e) => typeof e.path === 'string' && (e.path.includes(ALICE_ROOT) || e.path === newPath),
    );
    expect(bobLeaks, `Bob saw Alice personal events: ${JSON.stringify(bobLeaks)}`).toEqual([]);

    const aliceSawOwn = aliceEvents().some(
      (e) => typeof e.path === 'string' && e.path === newPath,
    );
    expect(aliceSawOwn, "Alice's WS missed her own personal-note creation").toBeTruthy();

    const bothSawShared = bobEvents().some((e) => e.path === sharedControl);
    expect(bothSawShared, 'Bob did not receive the shared-vault control event — broadcast pipeline is dead').toBeTruthy();
  });

  // -------- 4.6 MCP tool sweep --------

  test('4.6 every MCP tool as Bob does not surface any token', async ({ request }) => {
    const list = await request.get(`${baseURL}/api/__test/routes`, { headers: bearer(bobToken) });
    const { mcpTools } = (await list.json()) as { mcpTools: string[] };

    // Drive each MCP tool through the JSON-RPC HTTP transport at /mcp.
    // Per the in-process MCP test pattern (mcp.tool-registration.test.ts), this
    // exercises the same wrapTool flow that production callers hit.
    const initRes = await request.post(`${baseURL}/mcp`, {
      headers: bearer(bobToken),
      data: {
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'leak-test', version: '0' } },
      },
    });
    expect(initRes.ok()).toBeTruthy();
    const sessionId = initRes.headers()['mcp-session-id'];
    expect(sessionId, 'no Mcp-Session-Id from initialize').toBeTruthy();

    const failures: { tool: string; trail: string; token: string }[] = [];

    const fixturesForTool = (tool: string): unknown => {
      const probe = ALICE_NOTE;
      switch (tool) {
        case 'search_notes': return { query: BODYTOK };
        case 'read_note': return { path: probe };
        case 'read_attachment': return { name: ALICE_ATTACHMENT, doc: probe };
        case 'list_files': return { path: ALICE_ROOT };
        case 'list_comments': return { path: probe };
        case 'related_notes': return { path: probe };
        case 'create_note': return { path: 'Notes/leak-probe.md', content: '' };
        case 'patch_note': return { path: probe, oldText: BODYTOK, newText: '' };
        case 'append_to_note': return { path: probe, content: '' };
        case 'edit_note': return { path: probe, content: '' };
        case 'delete_note': return { path: probe };
        case 'add_comment': return { path: probe, blockId: 'b', text: '' };
        case 'resolve_comment': return { path: probe, blockId: 'b', threadId: 't', resolved: true };
        case 'get_updates': return { since: '0' };
        case 'list_backups': return {};
        case 'create_backup': return {};
        case 'restore_backup': return { backupId: 'nonexistent' };
        case 'mcp_stats': return {};
        default: return {};
      }
    };

    let nextId = 100;
    for (const tool of mcpTools) {
      const callRes = await request.post(`${baseURL}/mcp`, {
        headers: { ...bearer(bobToken), 'mcp-session-id': sessionId },
        data: {
          jsonrpc: '2.0',
          id: nextId++,
          method: 'tools/call',
          params: { name: tool, arguments: fixturesForTool(tool) },
        },
      });
      const text = await callRes.text();
      // The response body either contains a tool result with `content[]` or
      // a JSON-RPC error. Both are scanned recursively.
      let parsed: unknown = text;
      try { parsed = JSON.parse(text); } catch { /* SSE or non-JSON */ }
      const hits = [
        ...scanForTokens(parsed, `mcp:${tool}`),
        ...scanForTokens(callRes.headers(), `mcp:${tool}:headers`),
      ];
      failures.push(...hits.map((h) => ({ tool, ...h })));
    }

    expect(failures, `MCP tool leaks: ${JSON.stringify(failures, null, 2)}`).toEqual([]);
  });

  // -------- 4.8 mention-suppression spy --------

  test('4.8 cross-personal mention emits zero notifications to Bob', async ({ request }) => {
    const reset = await request.post(`${baseURL}/api/__test/notifications/reset`, {
      headers: bearer(aliceToken),
    });
    expect(reset.ok()).toBeTruthy();

    // Alice posts a comment in her personal note that mentions Bob.
    const commentRes = await request.post(`${baseURL}/api/comments`, {
      headers: bearer(aliceToken),
      data: {
        path: ALICE_NOTE,
        blockId: 'block-2',
        text: `@${BOB} please check ${COMMENTTOK}`,
      },
    });
    expect(commentRes.ok()).toBeTruthy();

    // Allow async notification dispatch to settle.
    await new Promise((r) => setTimeout(r, 750));

    const counters = await request.get(`${baseURL}/api/__test/notifications`, {
      headers: bearer(aliceToken),
    });
    const data = (await counters.json()) as {
      emittedTo: Record<string, number>;
      suppressedTo: Record<string, number>;
    };

    // Bob received zero outbound notifications across all three dispatcher methods.
    // (See notification.service.ts — bumpEmitted runs only after the
    // isCrossPersonalMention guard, exactly when sendMail/dev-fallback would.)
    expect(
      data.emittedTo[BOB] ?? 0,
      `Bob received ${data.emittedTo[BOB]} emissions; counters=${JSON.stringify(data)}`,
    ).toBe(0);
    // And the suppression counter MUST have fired at least once — proving the
    // dispatcher actually saw the mention and elected to suppress it.
    expect(
      (data.suppressedTo[BOB] ?? 0),
      'No suppression recorded — the mention may not have been detected at all',
    ).toBeGreaterThan(0);
  });
});

// ---------- Helpers ----------

function readShortLinkRow(path: string): unknown {
  const db = new Database(DB_PATH, { readonly: true, fileMustExist: true });
  try {
    const row = db.prepare('SELECT * FROM short_links WHERE path = ?').get(path);
    return row ?? null;
  } finally {
    db.close();
  }
}

function openWs(token: string): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://localhost:${BACKEND_PORT}/ws?token=${encodeURIComponent(token)}`);
    ws.once('open', () => resolve(ws));
    ws.once('error', reject);
  });
}

function collectEvents(ws: WebSocket): () => Array<Record<string, unknown>> {
  const events: Array<Record<string, unknown>> = [];
  ws.on('message', (raw) => {
    try {
      const obj = JSON.parse(raw.toString());
      events.push(obj);
    } catch {
      events.push({ raw: raw.toString() });
    }
  });
  return () => events.slice();
}
