// Watcher gate: `LocalFSAdapter.writeBytesAtomic` writes to `<file>.tmp.<hex>`
// and renames into place. Chokidar emits add/change events for the tmp file
// before the rename — those must NEVER reach connected WS clients (the regex
// filter in OTGateway drops them). The e2e harness runs with at-rest
// encryption ON (see playwright.config.ts), so every personal-folder write
// goes through `writeBytesAtomic` and therefore through the chokidar watcher.

import { test, expect } from '@playwright/test';
import jwt from 'jsonwebtoken';
import WebSocket from 'ws';
import { FRONTEND_PORT, BACKEND_PORT } from '../playwright.config';

const API_URL = `http://localhost:${BACKEND_PORT}`;
const WS_URL = `ws://localhost:${BACKEND_PORT}/ws`;
const JWT_SECRET = 'test-secret';

let userCounter = 7000;
function makeToken(email: string): string {
  return jwt.sign({ sub: ++userCounter, email }, JWT_SECRET, { expiresIn: '1h' });
}

function bearer(token: string): { Authorization: string } {
  return { Authorization: `Bearer ${token}` };
}

async function ensureFolderExists(token: string): Promise<void> {
  const res = await fetch(`${API_URL}/api/files/tree`, { headers: bearer(token) });
  if (!res.ok) throw new Error(`tree fetch failed: ${res.status}`);
}

async function createNoteAt(token: string, path: string, content: string): Promise<void> {
  const res = await fetch(`${API_URL}/api/files/create`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...bearer(token) },
    body: JSON.stringify({ path, content }),
  });
  if (!res.ok) throw new Error(`create note failed: ${res.status} ${await res.text()}`);
}

interface CapturedFrame {
  type: string;
  path?: string;
  event?: string;
}

async function captureFramesDuring(
  token: string,
  durationMs: number,
  trigger: () => Promise<void>,
): Promise<CapturedFrame[]> {
  return new Promise((resolve, reject) => {
    const frames: CapturedFrame[] = [];
    const ws = new WebSocket(`${WS_URL}?token=${encodeURIComponent(token)}`);
    let triggered = false;

    const timeout = setTimeout(() => {
      ws.close();
      resolve(frames);
    }, durationMs + 1000);

    ws.on('open', async () => {
      // Give the gateway a beat to register the connection in clientsByEmail.
      setTimeout(async () => {
        try {
          await trigger();
          triggered = true;
        } catch (err) {
          clearTimeout(timeout);
          ws.close();
          reject(err);
        }
      }, 100);
    });

    ws.on('message', (raw) => {
      try {
        const msg = JSON.parse(raw.toString()) as CapturedFrame;
        frames.push(msg);
      } catch {
        // ignore non-json frames
      }
    });

    ws.on('error', (err) => {
      clearTimeout(timeout);
      reject(err);
    });

    // Drain a fixed window after the trigger to catch every fanout.
    setTimeout(() => {
      if (triggered) {
        clearTimeout(timeout);
        ws.close();
        resolve(frames);
      }
    }, durationMs);
  });
}

test.describe('Watcher — atomic-write tmp filter', () => {
  test('REST create in a personal folder fans out no `.tmp.<hex>` paths', async () => {
    const aliceEmail = `tmp-filter-${Date.now()}@example.com`;
    const aliceToken = makeToken(aliceEmail);
    await ensureFolderExists(aliceToken);

    const notePath = `_users/${aliceEmail}/quiet-note.md`;

    const frames = await captureFramesDuring(aliceToken, 2500, async () => {
      await createNoteAt(aliceToken, notePath, '# hello\n');
    });

    // Negative: no frame leaks the atomic-write tmp filename.
    const tmpFrames = frames.filter(
      (f) => typeof f.path === 'string' && /\.tmp\.[0-9a-f]+$/.test(f.path),
    );
    expect(tmpFrames, `unexpected tmp frames: ${JSON.stringify(tmpFrames)}`).toHaveLength(0);

    // Positive: the rename-into-place still produces a fanout for the real
    // path. Either branch (file:changed or file:tree-update add) is fine; the
    // assertion is just that something for the final path arrived, proving the
    // watcher is alive and the gate did not over-filter.
    const realPathFrames = frames.filter((f) => f.path === notePath);
    expect(
      realPathFrames.length,
      `expected at least one frame for ${notePath}, got: ${JSON.stringify(frames)}`,
    ).toBeGreaterThan(0);
  });
});
