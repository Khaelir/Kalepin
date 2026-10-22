// The per-note PIN gates the OT WebSocket the same way it gates REST reads:
//   1. doc:open on a PIN-locked note is refused until the viewer unlocks it,
//      and an op sent without a gated doc:open is refused too.
//   2. In the app, opening a PIN-locked note shows the PIN dialog; after the
//      unlock the note opens over the WebSocket and edits still sync.

import { test, expect } from '@playwright/test';
import jwt from 'jsonwebtoken';
import WebSocket from 'ws';
import { FRONTEND_PORT, BACKEND_PORT } from '../playwright.config';

const BASE_URL = `http://localhost:${FRONTEND_PORT}`;
const API_URL = `http://localhost:${BACKEND_PORT}`;
const WS_URL = `ws://localhost:${BACKEND_PORT}/ws`;
const JWT_SECRET = 'test-secret';
const PIN = 'abcd1234';

let userCounter = 9500;
function makeToken(email: string): string {
  return jwt.sign({ sub: ++userCounter, email }, JWT_SECRET, { expiresIn: '1h' });
}

function bearer(token: string): { Authorization: string } {
  return { Authorization: `Bearer ${token}` };
}

async function api(token: string, method: string, url: string, body?: unknown): Promise<Response> {
  const res = await fetch(`${API_URL}${url}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...bearer(token) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${method} ${url} failed: ${res.status} ${await res.text()}`);
  return res;
}

function pinUrl(path: string): string {
  return `/api/notes/${encodeURIComponent(path)}/pin`;
}

async function verifyPin(token: string, path: string): Promise<string> {
  const res = await api(token, 'POST', `${pinUrl(path)}/verify`, { pin: PIN });
  const data = (await res.json()) as { token?: string };
  expect(data.token).toBeTruthy();
  return data.token!;
}

async function lockedNote(owner: string, name: string, content: string): Promise<{ ownerToken: string; path: string }> {
  const ownerToken = makeToken(owner);
  await api(ownerToken, 'GET', '/api/files/tree');
  const path = `_users/${owner}/${name}`;
  await api(ownerToken, 'POST', '/api/files/create', { path, content });
  await api(ownerToken, 'POST', pinUrl(path), { pin: PIN });
  return { ownerToken, path };
}

type Frame = { type: string; code?: string; docId?: string; revision?: number };

/** Send frames in order and collect replies until `done` says stop. */
async function wsExchange(
  token: string,
  frames: Array<{ event: string; data: Record<string, unknown> }>,
  done: (msg: Frame, all: Frame[]) => boolean,
): Promise<Frame[]> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`${WS_URL}?token=${encodeURIComponent(token)}`);
    const seen: Frame[] = [];
    const timeout = setTimeout(() => {
      ws.close();
      reject(new Error(`ws exchange timed out; saw ${JSON.stringify(seen)}`));
    }, 8000);
    ws.on('open', () => {
      for (const f of frames) ws.send(JSON.stringify(f));
    });
    ws.on('message', (raw) => {
      const msg = JSON.parse(raw.toString()) as Frame;
      if (msg.type.startsWith('presence')) return;
      seen.push(msg);
      if (done(msg, seen)) {
        clearTimeout(timeout);
        ws.close();
        resolve(seen);
      }
    });
    ws.on('error', (err) => {
      clearTimeout(timeout);
      reject(err);
    });
  });
}

test.describe('PIN over the OT WebSocket', () => {
  test('doc:open and op are refused until the viewer unlocks', async () => {
    const owner = 'pin-owner@example.com';
    const grantee = 'pin-grantee@example.com';
    const { ownerToken, path } = await lockedNote(owner, 'plan.md', 'Locked plan');
    await api(ownerToken, 'POST', '/api/grants', { grantee_email: grantee, path, permission: 'write' });
    const granteeToken = makeToken(grantee);

    const [openReply] = await wsExchange(
      granteeToken,
      [{ event: 'doc:open', data: { docId: path } }],
      () => true,
    );
    expect(openReply).toMatchObject({ type: 'error', code: 'pin-locked', docId: path });

    const [opReply] = await wsExchange(
      granteeToken,
      [{ event: 'op', data: { docId: path, ops: [{ type: 'insert', text: 'X' }], rev: 0 } }],
      () => true,
    );
    expect(opReply).toMatchObject({ type: 'error', code: 'pin-locked' });

    const unlock = await verifyPin(granteeToken, path);
    const [opened] = await wsExchange(
      granteeToken,
      [{ event: 'doc:open', data: { docId: path, unlock } }],
      () => true,
    );
    expect(opened).toMatchObject({ type: 'doc:opened', docId: path });

    // The owner's token is bound to the owner, not the grantee.
    const ownerUnlock = await verifyPin(ownerToken, path);
    const [stolen] = await wsExchange(
      granteeToken,
      [{ event: 'doc:open', data: { docId: path, unlock: ownerUnlock } }],
      () => true,
    );
    expect(stolen).toMatchObject({ type: 'error', code: 'pin-locked' });
  });

  test('the app asks for the PIN, then opens the note live', async ({ page }) => {
    const owner = 'pin-ui@example.com';
    const { ownerToken, path } = await lockedNote(owner, 'diary.md', 'Locked diary');

    await page.goto(BASE_URL);
    await page.evaluate((t) => localStorage.setItem('kalepin_token', t), ownerToken);
    await page.goto(`${BASE_URL}/doc/${encodeURIComponent(path)}`);

    const dialog = page.getByRole('dialog');
    await expect(dialog.getByText('Enter PIN')).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('.editor-content .tiptap')).toHaveCount(0);

    await dialog.locator('input[type="password"]').fill(PIN);
    await dialog.getByRole('button', { name: 'Unlock' }).click();

    const editor = page.locator('.editor-content .tiptap');
    await expect(editor).toContainText('Locked diary', { timeout: 15_000 });
    await editor.click();
    await page.keyboard.press('End');
    await page.keyboard.type(' and more');

    const header = await verifyPin(ownerToken, path);
    await expect(async () => {
      const res = await fetch(`${API_URL}/api/files/read?path=${encodeURIComponent(path)}`, {
        headers: { ...bearer(ownerToken), 'X-Kalepin-Unlock': header },
      });
      expect(res.status).toBe(200);
      const data = (await res.json()) as { content: string };
      expect(data.content).toContain('and more');
    }).toPass({ timeout: 15_000 });
  });
});
