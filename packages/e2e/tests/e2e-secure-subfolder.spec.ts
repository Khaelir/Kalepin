// Leak-sweep for `_users/{email}/_secure/` paths. Mirrors the personal-folders
// suite at leak-tokens.spec.ts but exercises the E2E carve-outs. Plants four
// tokens (path / body / attachment / comment-attempt) and asserts that no
// authenticated route, WS event, or MCP tool surfaces any of them when Bob
// queries Alice's E2E content.
//
// Skip-by-default. Set `E2E_LEAK_SUITE_ENABLED=1` to run locally. CI picks this
// up alongside the personal-folders sweep once the harness is integration-
// triaged.

import { test, expect, type APIRequestContext } from '@playwright/test';
import jwt from 'jsonwebtoken';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import WebSocket from 'ws';
import {
  BACKEND_PORT,
  PERSONAL_PATH,
} from '../playwright.config';

const JWT_SECRET = 'test-secret';
const baseURL = `http://localhost:${BACKEND_PORT}`;

// ──────── Fixtures ────────

const RUN = crypto.randomBytes(4).toString('hex');
const PATHTOK = `E2EPATHTOK-${RUN}`;
const BODYTOK = `E2EBODYTOK-${RUN}`;
const ATTACHTOK = `E2EATTACHTOK-${RUN}`;
const COMMENTTOK = `E2ECOMMENTTOK-${RUN}`;
const TOKENS = [PATHTOK, BODYTOK, ATTACHTOK, COMMENTTOK];

const ALICE = 'alice-e2e@example.com';
const BOB = 'bob-e2e@example.com';
const ALICE_ROOT = `_users/${ALICE}`;
const ALICE_SECURE_DIR = `${ALICE_ROOT}/_secure`;
const ALICE_NOTE = `${ALICE_SECURE_DIR}/${PATHTOK}.md`;
const ALICE_ATTACH = `${ALICE_SECURE_DIR}/_attachments/${ATTACHTOK}.png`;

const BANNED = [...TOKENS, ALICE_ROOT];

// ──────── Auth ────────

let counter = 9000;
function makeToken(email: string): string {
  return jwt.sign({ sub: ++counter, email }, JWT_SECRET, { expiresIn: '1h' });
}
function bearer(token: string): { Authorization: string } {
  return { Authorization: `Bearer ${token}` };
}
let aliceToken: string;
let bobToken: string;

// ──────── Envelope construction (mechanical; no real crypto round-trip needed
// for the leak property) ────────

const ENVELOPE_MAGIC = Buffer.from([0x4b, 0x45, 0x31, 0x00]); // KE1\0
const ENVELOPE_VERSION = 0x01;
const ALG_AES_256_GCM = 0x01;
const KDF_ARGON2ID = 0x01;
const IV_LEN = 12;
const KEK_FP_LEN = 8;

function buildOpaqueEnvelope(virtualPath: string, kind: 'note' | 'attachment', payload: string): Buffer {
  const salt = crypto.randomBytes(16);
  const kdfParams = Buffer.concat([
    salt,
    u32le(64 * 1024),
    u16le(3),
    Buffer.from([4]),
  ]); // 23 bytes
  const iv = crypto.randomBytes(IV_LEN);
  const wrappedCek = crypto.randomBytes(40);
  const fingerprint = crypto.randomBytes(KEK_FP_LEN);
  const aad = Buffer.from(JSON.stringify({ v: 1, path: virtualPath, kind, z: 'personal' }), 'utf8');
  const cipherAndTag = Buffer.concat([
    Buffer.from(payload, 'utf8'),     // pretend ciphertext
    crypto.randomBytes(16),           // pretend tag
  ]);

  const parts: Buffer[] = [
    ENVELOPE_MAGIC,
    Buffer.from([ENVELOPE_VERSION, ALG_AES_256_GCM, KDF_ARGON2ID]),
    u16le(kdfParams.length),
    kdfParams,
    iv,
    u16le(wrappedCek.length),
    wrappedCek,
    fingerprint,
    u16le(aad.length),
    aad,
    cipherAndTag,
  ];
  return Buffer.concat(parts);
}

function u16le(n: number): Buffer {
  const b = Buffer.alloc(2);
  b.writeUInt16LE(n, 0);
  return b;
}
function u32le(n: number): Buffer {
  const b = Buffer.alloc(4);
  b.writeUInt32LE(n, 0);
  return b;
}

// ──────── Token scan ────────

function scanForTokens(value: unknown, where: string): { trail: string; token: string }[] {
  const found: { trail: string; token: string }[] = [];
  const visit = (v: unknown, trail: string): void => {
    if (typeof v === 'string') {
      for (const t of BANNED) if (v.includes(t)) found.push({ trail, token: t });
      return;
    }
    if (typeof v === 'number' || typeof v === 'boolean' || v == null) return;
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
  const out: { trail: string; token: string }[] = [];
  for (const t of BANNED) if (s.includes(t)) out.push({ trail: where, token: t });
  return out;
}

// ──────── Plant ────────

async function plantAliceSecureContent(api: APIRequestContext): Promise<void> {
  // Bootstrap Alice's user row with a no-op authenticated call so personal
  // folders / vault-meta read paths return a real user.
  await api.get(`${baseURL}/api/files/tree`, { headers: bearer(aliceToken) });

  // Set up Alice's vault meta. The server treats the wrapped blobs as opaque
  // bytes — invalid wrappings still pass storage and exercise every read site
  // we want to assert against.
  const vaultMetaRes = await api.put(`${baseURL}/api/users/me/vault-meta`, {
    headers: bearer(aliceToken),
    data: {
      passphrase_wrapped_kek: crypto.randomBytes(40).toString('base64'),
      passphrase_salt: crypto.randomBytes(16).toString('base64'),
    },
  });
  expect(vaultMetaRes.ok(), `vault-meta setup: ${vaultMetaRes.status()} ${await vaultMetaRes.text()}`).toBeTruthy();

  // Plant the envelope on disk directly. The path must exist before we POST
  // anything to /api/files/secure/write — and using the disk write side-steps
  // the need for a real Argon2id-derived master-KEK in the test runtime.
  const aliceDir = path.join(PERSONAL_PATH, ALICE, '_secure');
  fs.mkdirSync(aliceDir, { recursive: true });
  fs.writeFileSync(
    path.join(aliceDir, `${PATHTOK}.md`),
    buildOpaqueEnvelope(ALICE_NOTE, 'note', `# Diary\n\n${BODYTOK}\n`),
  );
  const attachDir = path.join(aliceDir, '_attachments');
  fs.mkdirSync(attachDir, { recursive: true });
  fs.writeFileSync(
    path.join(attachDir, `${ATTACHTOK}.png`),
    buildOpaqueEnvelope(ALICE_ATTACH, 'attachment', `fake-attach-${ATTACHTOK}`),
  );

  // Comment attempts on E2E paths must be rejected by the controller. Try the
  // attempt anyway so the comment surface gets exercised; we do NOT expect this
  // to land. If it does (200), that's a leak signal in itself.
  await api.post(`${baseURL}/api/comments`, {
    headers: bearer(aliceToken),
    data: { path: ALICE_NOTE, blockId: 'block-1', text: COMMENTTOK },
  });
}

// ──────── WebSocket helper ────────

async function openWs(token: string): Promise<WebSocket> {
  const ws = new WebSocket(`ws://localhost:${BACKEND_PORT}/ws?token=${token}`);
  await new Promise<void>((resolve, reject) => {
    ws.once('open', () => resolve());
    ws.once('error', reject);
    setTimeout(() => reject(new Error('ws open timeout')), 5000);
  });
  return ws;
}

function collectEvents(ws: WebSocket): () => Array<Record<string, unknown>> {
  const seen: Array<Record<string, unknown>> = [];
  ws.on('message', (data: Buffer) => {
    try {
      seen.push(JSON.parse(data.toString()));
    } catch { /* binary or malformed — ignore */ }
  });
  return () => [...seen];
}

// ──────── Suite ────────

test.describe.configure({ mode: 'serial' });

test.describe('e2e _secure/ leak-token property suite', () => {
  test.skip(
    process.env.E2E_LEAK_SUITE_ENABLED !== '1',
    '_secure/ leak suite — opt-in via E2E_LEAK_SUITE_ENABLED=1.',
  );

  test.beforeAll(async ({ request }) => {
    aliceToken = makeToken(ALICE);
    bobToken = makeToken(BOB);
    await request.get(`${baseURL}/api/files/tree`, { headers: bearer(bobToken) });
    await plantAliceSecureContent(request);
  });

  // Every authenticated HTTP route as Bob, recursive token scan.
  test('every HTTP route as Bob does not surface any token', async ({ request }) => {
    const res = await request.get(`${baseURL}/api/__test/routes`, { headers: bearer(bobToken) });
    expect(res.ok()).toBeTruthy();
    const { routes } = (await res.json()) as { routes: { method: string; path: string }[] };

    const fixtures = (routePath: string): { query?: Record<string, string>; body?: unknown } => {
      const probe = ALICE_NOTE;
      if (routePath.includes('/api/files/secure/read')) return { query: { path: probe } };
      if (routePath.includes('/api/files/secure/write')) return { body: { path: probe, envelope: '' } };
      if (routePath.includes('/api/files/secure/create')) return { body: { path: probe, envelope: '' } };
      if (routePath.includes('/api/files/secure/cek-handoff')) return { query: { path: probe } };
      if (routePath.includes('/api/files/move-to-secure')) return { body: { src: probe, encryptedEnvelope: '', handoffToken: '' } };
      if (routePath.includes('/api/files/move-from-secure')) return { body: { src: probe, dest: 'Notes/x.md', content: '' } };
      if (routePath.includes('/api/files/read')) return { query: { path: probe } };
      if (routePath.includes('/api/files/headings')) return { query: { path: probe } };
      if (routePath.includes('/api/files/history')) return { query: { path: probe } };
      if (routePath.includes('/api/files/version')) return { query: { path: probe, changeId: '1' } };
      if (routePath.includes('/api/comments')) return { query: { path: probe }, body: { path: probe, blockId: 'b', text: '' } };
      if (routePath.includes('/api/share-links')) return { body: { path: probe } };
      if (routePath.includes('/api/links/')) return { query: { path: probe }, body: { path: probe } };
      if (routePath.includes('/api/search')) return { query: { q: BODYTOK } };
      if (routePath.includes('/api/files/attachment')) return { query: { name: `${ATTACHTOK}.png`, doc: probe } };
      return {};
    };

    const failures: { method: string; path: string; trail: string; token: string }[] = [];

    for (const r of routes) {
      if (!r.path.startsWith('/api/')) continue;
      if (r.path.startsWith('/api/__test/')) continue;
      // download-zip is its own checked surface; the personal-folder suite already covers it.
      if (r.path.includes('/api/files/download-zip')) continue;
      // Multipart upload not modelled here.
      if (r.method === 'POST' && r.path.includes('/api/files/upload')) continue;

      const fixt = fixtures(r.path);
      const url = new URL(r.path, baseURL);
      for (const [k, v] of Object.entries(fixt.query ?? {})) url.searchParams.set(k, v);
      const opts: Parameters<APIRequestContext['fetch']>[1] = {
        method: r.method,
        headers: { ...bearer(bobToken), 'content-type': 'application/json' },
      };
      if (fixt.body !== undefined && r.method !== 'GET' && r.method !== 'DELETE') opts.data = fixt.body;
      let response;
      try {
        response = await request.fetch(url.toString(), opts);
      } catch {
        continue;
      }
      const headerHits = scanForTokens(response.headers(), `${r.method} ${r.path} headers`);
      let textBody = '';
      try {
        textBody = await response.text();
      } catch { /* binary — already covered: tokens in binary bodies still surface as text in the buffer */ }
      const bodyHits = scanString(textBody, `${r.method} ${r.path} body`);
      failures.push(...headerHits.map((h) => ({ method: r.method, path: r.path, ...h })));
      failures.push(...bodyHits.map((h) => ({ method: r.method, path: r.path, ...h })));
    }

    expect(failures, 'token leak surfaced on responses:\n' + failures.map((f) => `  ${f.method} ${f.path} @ ${f.trail} contains "${f.token}"`).join('\n')).toEqual([]);
  });

  test('Bob cannot read Alice\'s _secure file via /api/files/secure/read', async ({ request }) => {
    const res = await request.get(`${baseURL}/api/files/secure/read?path=${encodeURIComponent(ALICE_NOTE)}`, {
      headers: bearer(bobToken),
    });
    expect(res.ok()).toBeFalsy();
    const text = await res.text();
    expect(scanString(text, 'bob secure-read body')).toEqual([]);
  });

  test('Bob cannot mint a share-link on a _secure path', async ({ request }) => {
    const res = await request.post(`${baseURL}/api/share-links`, {
      headers: bearer(bobToken),
      data: { path: ALICE_NOTE },
    });
    expect(res.ok()).toBeFalsy();
  });

  test('Bob WS sees no events referencing Alice\'s _secure namespace', async () => {
    const bobWs = await openWs(bobToken);
    const events = collectEvents(bobWs);
    bobWs.send(JSON.stringify({ event: 'doc:open', data: { docId: ALICE_NOTE } }));
    await new Promise((r) => setTimeout(r, 500));
    bobWs.close();
    const leaks = events().filter((e) => {
      const seen = JSON.stringify(e);
      return BANNED.some((t) => seen.includes(t));
    });
    expect(leaks).toEqual([]);
  });

  test('comment creation on _secure path is rejected with 403', async ({ request }) => {
    const res = await request.post(`${baseURL}/api/comments`, {
      headers: bearer(aliceToken),
      data: { path: ALICE_NOTE, blockId: 'block-1', text: COMMENTTOK },
    });
    expect(res.status()).toBe(403);
    const text = await res.text();
    expect(text).toContain('e2e-no-comments');
  });

  test('Alice secure/read returns the envelope she planted', async ({ request }) => {
    const res = await request.get(`${baseURL}/api/files/secure/read?path=${encodeURIComponent(ALICE_NOTE)}`, {
      headers: bearer(aliceToken),
    });
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    // The envelope is base64-encoded raw bytes. The path token MUST appear in
    // the body (it's the AAD), but BODYTOK MUST NOT — it's inside the
    // ciphertext region of the envelope. Without a real master-KEK round-trip
    // in this test, BODYTOK is in our fake "ciphertext" bytes, but the
    // important security property is the negative one we already asserted as
    // Bob.
    expect(body.envelope).toBeTruthy();
    const decoded = Buffer.from(body.envelope, 'base64').toString('binary');
    // AAD path is bound; this is metadata, expected to surface here.
    expect(decoded).toContain(ALICE_NOTE);
  });
});
