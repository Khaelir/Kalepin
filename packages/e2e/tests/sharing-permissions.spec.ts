// Sharing & permissions UI surfaces:
//   1. Sidebar flex sizing — `shared-with-me` sizes to its content; only the
//      Vault tree fills remaining height.
//   2. Comment-only grantees see the editor as read-only (banner + non-editable
//      ProseMirror), and the OT gateway rejects their ops at the wire level.
//   3. Per-note share dialog lists existing grants, allows changing permission
//      level inline, and revokes without leaving the dialog.
//
// Each test plants its own users + notes via the REST API (no UI login flow).

import { test, expect, type Page } from '@playwright/test';
import jwt from 'jsonwebtoken';
import WebSocket from 'ws';
import { FRONTEND_PORT, BACKEND_PORT } from '../playwright.config';

const BASE_URL = `http://localhost:${FRONTEND_PORT}`;
const API_URL = `http://localhost:${BACKEND_PORT}`;
const WS_URL = `ws://localhost:${BACKEND_PORT}/ws`;
const JWT_SECRET = 'test-secret';

let userCounter = 9000;
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

async function mintGrant(
  token: string,
  body: { grantee_email: string; path: string; permission: 'read' | 'comment' | 'write'; expires_at?: number | null },
): Promise<{ id: number }> {
  const res = await fetch(`${API_URL}/api/grants`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...bearer(token) },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`mint grant failed: ${res.status} ${await res.text()}`);
  return res.json();
}

async function listGrantsAsGrantor(token: string): Promise<unknown[]> {
  const res = await fetch(`${API_URL}/api/grants?as=grantor`, { headers: bearer(token) });
  if (!res.ok) throw new Error(`list grants failed: ${res.status}`);
  const data = (await res.json()) as { grants: unknown[] };
  return data.grants;
}

async function listGrantsForPath(token: string, path: string): Promise<unknown[]> {
  const res = await fetch(`${API_URL}/api/grants?path=${encodeURIComponent(path)}`, {
    headers: bearer(token),
  });
  if (!res.ok) throw new Error(`list grants for path failed: ${res.status}`);
  const data = (await res.json()) as { grants: unknown[] };
  return data.grants;
}

interface SwmGroup {
  grantor_email: string;
  items: { id: number; path: string; permission: string }[];
}

async function moveAt(token: string, src: string, dest: string): Promise<void> {
  const res = await fetch(`${API_URL}/api/files/move`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...bearer(token) },
    body: JSON.stringify({ src, dest }),
  });
  if (!res.ok) throw new Error(`move failed: ${res.status} ${await res.text()}`);
}

async function deleteAt(token: string, path: string): Promise<void> {
  const res = await fetch(`${API_URL}/api/files/delete?path=${encodeURIComponent(path)}`, {
    method: 'DELETE',
    headers: bearer(token),
  });
  if (!res.ok) throw new Error(`delete failed: ${res.status} ${await res.text()}`);
}

async function listSharedWithMe(token: string): Promise<SwmGroup[]> {
  const res = await fetch(`${API_URL}/api/files/shared-with-me`, { headers: bearer(token) });
  if (!res.ok) throw new Error(`shared-with-me failed: ${res.status}`);
  const data = (await res.json()) as { groups: SwmGroup[] };
  return data.groups;
}

async function readFileAt(
  token: string,
  path: string,
): Promise<{ ok: boolean; status: number; content?: string }> {
  const res = await fetch(`${API_URL}/api/files/read?path=${encodeURIComponent(path)}`, {
    headers: bearer(token),
  });
  if (!res.ok) return { ok: false, status: res.status };
  const data = (await res.json()) as { content: string };
  return { ok: true, status: res.status, content: data.content };
}

async function authAndOpenWorkspace(page: Page, token: string): Promise<void> {
  await page.goto(BASE_URL);
  await page.evaluate((t) => localStorage.setItem('kalepin_token', t), token);
  await page.goto(BASE_URL);
  await expect(page.locator('.file-tree').first()).toBeVisible({ timeout: 15_000 });
}

async function authAndOpenNote(page: Page, token: string, notePath: string): Promise<void> {
  await page.goto(BASE_URL);
  await page.evaluate((t) => localStorage.setItem('kalepin_token', t), token);
  const encoded = notePath.split('/').map(encodeURIComponent).join('/');
  await page.goto(`${BASE_URL}/doc/${encoded}`);
  await expect(page.locator('.editor-content .tiptap')).toBeVisible({ timeout: 15_000 });
}

interface DocOpenedFrame {
  type: 'doc:opened';
  docId: string;
  content: string;
  revision: number;
  permission: 'owner' | 'write' | 'comment';
}
interface ErrorFrame {
  type: 'error';
  code?: string;
  docId?: string;
  message?: string;
}
type WireFrame = DocOpenedFrame | ErrorFrame | { type: string; [k: string]: unknown };

// Nest's WsAdapter routes via { event, data } envelopes — outbound from the
// gateway is `client.send(JSON.stringify({ type, ... }))` (raw type-tagged
// frames). Mirror the frontend's WSClient by wrapping outbound traffic.
function sendNestEvent(ws: WebSocket, type: string, payload: Record<string, unknown> = {}): void {
  ws.send(JSON.stringify({ event: type, data: payload }));
}

/**
 * Connect to the OT gateway as `token`, send `doc:open`, then send an `op`,
 * and resolve with the next frame received after the op.
 */
async function probeOpFrame(token: string, docId: string): Promise<WireFrame> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`${WS_URL}?token=${encodeURIComponent(token)}`);
    let opened = false;
    const timeout = setTimeout(() => {
      ws.close();
      reject(new Error('probeOpFrame timed out'));
    }, 8000);

    ws.on('open', () => {
      sendNestEvent(ws, 'doc:open', { docId });
    });

    ws.on('message', (raw) => {
      let msg: WireFrame;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return;
      }
      if (!opened && msg.type === 'doc:opened' && (msg as DocOpenedFrame).docId === docId) {
        opened = true;
        sendNestEvent(ws, 'op', {
          docId,
          ops: [{ type: 'insert', text: 'X' }],
          rev: (msg as DocOpenedFrame).revision,
        });
        return;
      }
      if (opened && (msg.type === 'error' || msg.type === 'ack' || msg.type === 'op')) {
        clearTimeout(timeout);
        ws.close();
        resolve(msg);
      }
      if (!opened && msg.type === 'error') {
        // doc:opened error case (e.g. forbidden on read grants).
        clearTimeout(timeout);
        ws.close();
        resolve(msg);
      }
    });

    ws.on('error', (err) => {
      clearTimeout(timeout);
      reject(err);
    });
  });
}

test.describe('Sharing — sidebar flex sizing', () => {
  test('shared-with-me section sizes to its content; Vault gets the slack', async ({ browser }) => {
    const aliceEmail = `share-flex-alice-${Date.now()}@example.com`;
    const bobEmail = `share-flex-bob-${Date.now()}@example.com`;
    const aliceToken = makeToken(aliceEmail);
    const bobToken = makeToken(bobEmail);

    await ensureFolderExists(aliceToken);
    await ensureFolderExists(bobToken);

    // Alice owns one personal note and shares it with Bob.
    const sharedNote = `_users/${aliceEmail}/Shared.md`;
    await createNoteAt(aliceToken, sharedNote, '# Shared\n');
    await mintGrant(aliceToken, {
      grantee_email: bobEmail,
      path: sharedNote,
      permission: 'comment',
    });

    // Populate Vault with several notes so its file-tree wants to be tall —
    // if the regression were back, "shared-with-me" would steal half the room.
    for (let i = 0; i < 8; i++) {
      await createNoteAt(bobToken, `flex-vault-${Date.now()}-${i}.md`, `# vault ${i}\n`);
    }

    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    try {
      await authAndOpenWorkspace(page, bobToken);

      const sharedWithMeTree = page.locator('.file-tree[data-section="shared-with-me"]');
      const vaultTree = page.locator('.file-tree[data-section="shared"]');
      await expect(sharedWithMeTree).toBeVisible();
      await expect(vaultTree).toBeVisible();

      // Computed flex-grow tells the layout story directly. After the fix
      // shared-with-me has flex: 0 0 auto (grow=0); Vault has flex: 1 (grow=1).
      const sharedWithMeGrow = await sharedWithMeTree.evaluate(
        (el) => parseFloat(window.getComputedStyle(el).flexGrow),
      );
      const vaultGrow = await vaultTree.evaluate(
        (el) => parseFloat(window.getComputedStyle(el).flexGrow),
      );
      expect(sharedWithMeGrow).toBe(0);
      expect(vaultGrow).toBe(1);

      // Geometric check: shared-with-me's box hugs its 1 row of content. With
      // the regression the tree would expand to ~half the sidebar's height.
      const { rowHeight, treeHeight } = await sharedWithMeTree.evaluate((el) => {
        const row = el.querySelector('.file-tree-node') as HTMLElement | null;
        return {
          rowHeight: row ? row.getBoundingClientRect().height : 0,
          treeHeight: el.getBoundingClientRect().height,
        };
      });
      // Allow some padding around the row, but not half a sidebar's worth.
      expect(rowHeight).toBeGreaterThan(0);
      expect(treeHeight).toBeLessThan(rowHeight * 4);

      // Sanity: Vault occupies more vertical space than shared-with-me.
      const vaultHeight = await vaultTree.evaluate((el) => el.getBoundingClientRect().height);
      expect(vaultHeight).toBeGreaterThan(treeHeight);
    } finally {
      await ctx.close();
    }
  });
});

test.describe('Sharing — comment-only permission lock', () => {
  test('comment grantee gets read-only editor with banner; owner is not affected', async ({ browser }) => {
    const aliceEmail = `share-lock-alice-${Date.now()}@example.com`;
    const bobEmail = `share-lock-bob-${Date.now()}@example.com`;
    const aliceToken = makeToken(aliceEmail);
    const bobToken = makeToken(bobEmail);

    await ensureFolderExists(aliceToken);
    await ensureFolderExists(bobToken);

    const notePath = `_users/${aliceEmail}/CommentOnly.md`;
    const originalBody = 'Read but do not edit me.';
    await createNoteAt(aliceToken, notePath, `# CommentOnly\n\n${originalBody}\n`);
    await mintGrant(aliceToken, {
      grantee_email: bobEmail,
      path: notePath,
      permission: 'comment',
    });

    const aliceCtx = await browser.newContext();
    const bobCtx = await browser.newContext();
    const alicePage = await aliceCtx.newPage();
    const bobPage = await bobCtx.newPage();
    try {
      await authAndOpenNote(bobPage, bobToken, notePath);

      // Banner explains the permission. The exact copy is "comment-only access".
      const banner = bobPage.locator('.save-banner--info');
      await expect(banner).toBeVisible();
      await expect(banner).toContainText(/comment-only access/i);

      // ProseMirror's editable flag flips contenteditable on the surface div.
      const surface = bobPage.locator('.editor-content .tiptap');
      await expect(surface).toHaveAttribute('contenteditable', 'false');

      // Bob attempts to type at the end of the paragraph. The editor refuses
      // input (contenteditable=false), so the body must remain unchanged.
      await surface.click();
      await bobPage.keyboard.press('End');
      await bobPage.keyboard.type(' BOB-WAS-HERE');
      // Give any in-flight WS frames time to round-trip — they will be rejected.
      await bobPage.waitForTimeout(500);

      // Confirm the file on disk did NOT pick up the rejected text.
      const readRes = await fetch(`${API_URL}/api/files/read?path=${encodeURIComponent(notePath)}`, {
        headers: bearer(aliceToken),
      });
      expect(readRes.ok).toBe(true);
      const onDisk = (await readRes.json()) as { path: string; content: string };
      expect(onDisk.content).toContain(originalBody);
      expect(onDisk.content).not.toContain('BOB-WAS-HERE');

      // Alice (owner) can still edit normally.
      await authAndOpenNote(alicePage, aliceToken, notePath);
      await expect(alicePage.locator('.save-banner--info')).toHaveCount(0);
      await expect(alicePage.locator('.editor-content .tiptap')).toHaveAttribute(
        'contenteditable',
        'true',
      );
    } finally {
      await aliceCtx.close();
      await bobCtx.close();
    }
  });

  test('OT gateway rejects ops from comment-only grantees with a forbidden frame', async () => {
    const aliceEmail = `share-ws-alice-${Date.now()}@example.com`;
    const bobEmail = `share-ws-bob-${Date.now()}@example.com`;
    const carolEmail = `share-ws-carol-${Date.now()}@example.com`;
    const aliceToken = makeToken(aliceEmail);
    const bobToken = makeToken(bobEmail);
    const carolToken = makeToken(carolEmail);

    await ensureFolderExists(aliceToken);
    await ensureFolderExists(bobToken);
    await ensureFolderExists(carolToken);

    const notePath = `_users/${aliceEmail}/WsProbe.md`;
    await createNoteAt(aliceToken, notePath, '# probe\n\nbody.\n');
    await mintGrant(aliceToken, { grantee_email: bobEmail, path: notePath, permission: 'comment' });
    await mintGrant(aliceToken, { grantee_email: carolEmail, path: notePath, permission: 'write' });

    // Bob (comment) → forbidden on op.
    const bobFrame = await probeOpFrame(bobToken, notePath);
    expect(bobFrame.type).toBe('error');
    expect((bobFrame as ErrorFrame).code).toBe('forbidden');

    // Carol (write) → ack on op (sanity: gateway still works for valid grants).
    const carolFrame = await probeOpFrame(carolToken, notePath);
    expect(carolFrame.type).toBe('ack');
  });

  test('doc:opened payload carries the resolved permission for each role', async () => {
    const aliceEmail = `share-payload-alice-${Date.now()}@example.com`;
    const bobEmail = `share-payload-bob-${Date.now()}@example.com`;
    const carolEmail = `share-payload-carol-${Date.now()}@example.com`;
    const aliceToken = makeToken(aliceEmail);
    const bobToken = makeToken(bobEmail);
    const carolToken = makeToken(carolEmail);

    await ensureFolderExists(aliceToken);
    await ensureFolderExists(bobToken);
    await ensureFolderExists(carolToken);

    const notePath = `_users/${aliceEmail}/Payload.md`;
    await createNoteAt(aliceToken, notePath, '# payload\n');
    await mintGrant(aliceToken, { grantee_email: bobEmail, path: notePath, permission: 'comment' });
    await mintGrant(aliceToken, { grantee_email: carolEmail, path: notePath, permission: 'write' });

    const openOnly = (token: string): Promise<DocOpenedFrame> =>
      new Promise((resolve, reject) => {
        const ws = new WebSocket(`${WS_URL}?token=${encodeURIComponent(token)}`);
        const timeout = setTimeout(() => { ws.close(); reject(new Error('doc:opened timeout')); }, 6000);
        ws.on('open', () => sendNestEvent(ws, 'doc:open', { docId: notePath }));
        ws.on('message', (raw) => {
          const msg = JSON.parse(raw.toString());
          if (msg.type === 'doc:opened' && msg.docId === notePath) {
            clearTimeout(timeout);
            ws.close();
            resolve(msg);
          }
          if (msg.type === 'error') {
            clearTimeout(timeout);
            ws.close();
            reject(new Error(`doc:open errored: ${JSON.stringify(msg)}`));
          }
        });
        ws.on('error', (err) => { clearTimeout(timeout); reject(err); });
      });

    const ownerFrame = await openOnly(aliceToken);
    expect(ownerFrame.permission).toBe('owner');

    const writeFrame = await openOnly(carolToken);
    expect(writeFrame.permission).toBe('write');

    const commentFrame = await openOnly(bobToken);
    expect(commentFrame.permission).toBe('comment');
  });
});

test.describe('Sharing — per-note share dialog', () => {
  // Helper: open a personal note in Alice's workspace and pop the share dialog
  // via the file-tree right-click menu.
  async function openShareDialogForNote(page: Page, notePath: string): Promise<void> {
    const fileName = notePath.split('/').pop()!;
    const fileRow = page
      .locator('.file-tree[data-section="personal"] .file-tree-node', { hasText: fileName });
    await expect(fileRow).toBeVisible();
    await fileRow.click({ button: 'right' });
    const menu = page.locator('.context-menu');
    await expect(menu).toBeVisible();
    await menu.getByText('Share file…').click();
    await expect(page.locator('.modal-card.share-dialog')).toBeVisible();
  }

  test('lists existing grants with permission select and revoke', async ({ browser }) => {
    const aliceEmail = `share-panel-alice-${Date.now()}@example.com`;
    const bobEmail = `share-panel-bob-${Date.now()}@example.com`;
    const aliceToken = makeToken(aliceEmail);

    await ensureFolderExists(aliceToken);
    const notePath = `_users/${aliceEmail}/PanelTest.md`;
    await createNoteAt(aliceToken, notePath, '# panel\n');
    const { id: grantId } = await mintGrant(aliceToken, {
      grantee_email: bobEmail,
      path: notePath,
      permission: 'read',
    });

    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    try {
      await authAndOpenWorkspace(page, aliceToken);
      await openShareDialogForNote(page, notePath);

      const existing = page.locator('.share-dialog-existing');
      await expect(existing).toBeVisible();
      await expect(existing).toContainText('People with access (1)');

      const row = existing.locator('.share-dialog-existing-row');
      await expect(row).toHaveCount(1);
      await expect(row).toContainText(bobEmail);

      // Permission select reflects the wire value.
      const select = row.locator('.share-dialog-existing-perm');
      await expect(select).toHaveValue('read');

      // Change permission inline to 'comment' — backend should agree.
      await select.selectOption('comment');
      await expect(select).toHaveValue('comment');

      const grantsAfter = await listGrantsForPath(aliceToken, notePath);
      expect(grantsAfter).toHaveLength(1);
      expect((grantsAfter[0] as { id: number; permission: string }).permission).toBe('comment');
      expect((grantsAfter[0] as { id: number }).id).toBe(grantId);

      // Revoke from the panel — row clears and backend list returns empty.
      await row.locator('.share-dialog-existing-revoke').click();
      await expect(existing.locator('.share-dialog-existing-row')).toHaveCount(0);
      await expect(existing).toContainText('No one else has access yet');

      const grantsAfterRevoke = await listGrantsForPath(aliceToken, notePath);
      expect(grantsAfterRevoke).toHaveLength(0);
    } finally {
      await ctx.close();
    }
  });

  test('minting a grant from the dialog refreshes the existing-shares list', async ({ browser }) => {
    const aliceEmail = `share-mint-alice-${Date.now()}@example.com`;
    const bobEmail = `share-mint-bob-${Date.now()}@example.com`;
    const aliceToken = makeToken(aliceEmail);

    await ensureFolderExists(aliceToken);
    const notePath = `_users/${aliceEmail}/MintTest.md`;
    await createNoteAt(aliceToken, notePath, '# mint\n');

    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    try {
      await authAndOpenWorkspace(page, aliceToken);
      await openShareDialogForNote(page, notePath);

      const existing = page.locator('.share-dialog-existing');
      await expect(existing).toContainText('No one else has access yet');

      // Fill the new-share form and submit.
      const dialog = page.locator('.modal-card.share-dialog');
      await dialog.locator('input[type="email"]').fill(bobEmail);
      // Switch to "Comment" radio (default is "Read").
      await dialog.getByRole('radio', { name: 'Comment' }).check();
      await dialog.getByRole('button', { name: 'Share' }).click();

      // Dialog stays open; the existing-list now shows Bob with Comment.
      await expect(dialog).toBeVisible();
      await expect(existing).toContainText('People with access (1)');
      const row = existing.locator('.share-dialog-existing-row');
      await expect(row).toContainText(bobEmail);
      await expect(row.locator('.share-dialog-existing-perm')).toHaveValue('comment');

      // Backend sees one grant.
      const grants = await listGrantsAsGrantor(aliceToken);
      expect(grants).toHaveLength(1);
    } finally {
      await ctx.close();
    }
  });
});

// Pure-API tests — no browser. The grant lifecycle hooks (rename / delete /
// folder rename / dangling-row GC) live entirely in the backend, and exercising
// them through fetch is faster and less flaky than driving the UI.
test.describe('Sharing — grant path-sync on rename and delete', () => {
  test('file rename rewrites the grant path; grantee reads at the new path', async () => {
    const aliceEmail = `psync-rename-alice-${Date.now()}@example.com`;
    const bobEmail = `psync-rename-bob-${Date.now()}@example.com`;
    const aliceToken = makeToken(aliceEmail);
    const bobToken = makeToken(bobEmail);
    await ensureFolderExists(aliceToken);
    await ensureFolderExists(bobToken);

    const oldPath = `_users/${aliceEmail}/foo.md`;
    const newPath = `_users/${aliceEmail}/bar.md`;
    await createNoteAt(aliceToken, oldPath, 'shared body');
    await mintGrant(aliceToken, { grantee_email: bobEmail, path: oldPath, permission: 'read' });

    await moveAt(aliceToken, oldPath, newPath);

    // Bob's _shared_with_me lists the new path, not the old one.
    const groups = await listSharedWithMe(bobToken);
    const items = groups.flatMap((g) => g.items.map((i) => i.path));
    expect(items).toContain(newPath);
    expect(items).not.toContain(oldPath);

    // Bob can read at the new path; the old path 404s.
    const newRead = await readFileAt(bobToken, newPath);
    expect(newRead.ok).toBe(true);
    expect(newRead.content).toBe('shared body');
    const oldRead = await readFileAt(bobToken, oldPath);
    expect(oldRead.ok).toBe(false);
    expect(oldRead.status).toBe(404);
  });

  test('file delete revokes the grant; grantee no longer sees it and read 404s', async () => {
    const aliceEmail = `psync-delete-alice-${Date.now()}@example.com`;
    const bobEmail = `psync-delete-bob-${Date.now()}@example.com`;
    const aliceToken = makeToken(aliceEmail);
    const bobToken = makeToken(bobEmail);
    await ensureFolderExists(aliceToken);
    await ensureFolderExists(bobToken);

    const filePath = `_users/${aliceEmail}/doomed.md`;
    await createNoteAt(aliceToken, filePath, 'will be deleted');
    await mintGrant(aliceToken, { grantee_email: bobEmail, path: filePath, permission: 'read' });

    await deleteAt(aliceToken, filePath);

    const groups = await listSharedWithMe(bobToken);
    const items = groups.flatMap((g) => g.items.map((i) => i.path));
    expect(items).not.toContain(filePath);

    const read = await readFileAt(bobToken, filePath);
    expect(read.ok).toBe(false);
    expect(read.status).toBe(404);
  });

  test('folder rename rewrites all descendant grants', async () => {
    const aliceEmail = `psync-folder-alice-${Date.now()}@example.com`;
    const bobEmail = `psync-folder-bob-${Date.now()}@example.com`;
    const aliceToken = makeToken(aliceEmail);
    const bobToken = makeToken(bobEmail);
    await ensureFolderExists(aliceToken);
    await ensureFolderExists(bobToken);

    const oldFolder = `_users/${aliceEmail}/folder`;
    const newFolder = `_users/${aliceEmail}/renamed`;
    const aOld = `${oldFolder}/a.md`;
    const bOld = `${oldFolder}/b.md`;
    const aNew = `${newFolder}/a.md`;
    const bNew = `${newFolder}/b.md`;

    await createNoteAt(aliceToken, aOld, 'A');
    await createNoteAt(aliceToken, bOld, 'B');
    await mintGrant(aliceToken, { grantee_email: bobEmail, path: aOld, permission: 'read' });
    await mintGrant(aliceToken, { grantee_email: bobEmail, path: bOld, permission: 'read' });

    await moveAt(aliceToken, oldFolder, newFolder);

    const groups = await listSharedWithMe(bobToken);
    const items = groups.flatMap((g) => g.items.map((i) => i.path)).sort();
    expect(items).toEqual([aNew, bNew].sort());
    const aRead = await readFileAt(bobToken, aNew);
    const bRead = await readFileAt(bobToken, bNew);
    expect(aRead.ok).toBe(true);
    expect(bRead.ok).toBe(true);
  });

  test('pre-existing dangling grant is filtered from _shared_with_me and revoked on next read', async () => {
    // Backend allows minting against any path under the grantor's personal
    // root, regardless of disk presence — that is exactly how legacy dangling
    // rows were created before the rename/delete hooks shipped. We use that
    // here to seed a dangling row and then verify the safety net cleans it up.
    const aliceEmail = `psync-ghost-alice-${Date.now()}@example.com`;
    const bobEmail = `psync-ghost-bob-${Date.now()}@example.com`;
    const aliceToken = makeToken(aliceEmail);
    const bobToken = makeToken(bobEmail);
    await ensureFolderExists(aliceToken);
    await ensureFolderExists(bobToken);

    const ghostPath = `_users/${aliceEmail}/ghost-${Date.now()}.md`;
    const { id: ghostId } = await mintGrant(aliceToken, {
      grantee_email: bobEmail,
      path: ghostPath,
      permission: 'read',
    });

    // First read — Bob's _shared_with_me must not include the ghost path.
    const groups = await listSharedWithMe(bobToken);
    const items = groups.flatMap((g) => g.items.map((i) => i.path));
    expect(items).not.toContain(ghostPath);

    // Async GC fires-and-forgets — give it a moment to flush, then verify the
    // grantor's own list no longer shows this row as active.
    await new Promise((r) => setTimeout(r, 200));
    const aliceGrants = (await listGrantsAsGrantor(aliceToken)) as { id: number }[];
    expect(aliceGrants.find((g) => g.id === ghostId)).toBeUndefined();
  });
});

// Quiet create-flow: a fresh note in a personal folder where a sibling is
// already shared must NOT produce the death-by-papercuts toast cascade
// (".tmp.<hex>" leak, self-echo "File changed externally", premature share
// nudge). The nudge is deferred to the first meaningful save.
test.describe('Sharing — quiet create-flow', () => {
  test('creating a private note shows zero toasts; first save fires the share nudge once', async ({ browser }) => {
    const aliceEmail = `quiet-create-${Date.now()}@example.com`;
    const bobEmail = `quiet-create-bob-${Date.now()}@example.com`;
    const aliceToken = makeToken(aliceEmail);
    await ensureFolderExists(aliceToken);

    // Plant a sibling note already shared with Bob — this is what makes the
    // share nudge eligible to fire on the next sibling create.
    const sibling = `_users/${aliceEmail}/Sibling.md`;
    await createNoteAt(aliceToken, sibling, '# sibling\n');
    await mintGrant(aliceToken, {
      grantee_email: bobEmail,
      path: sibling,
      permission: 'comment',
    });

    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    try {
      await authAndOpenWorkspace(page, aliceToken);

      // Right-click the personal-root row → "New note here".
      const personalRow = page
        .locator('.file-tree[data-section="personal"]')
        .locator('.file-tree-node.personal-root');
      await personalRow.click({ button: 'right' });
      const menu = page.locator('.context-menu');
      await expect(menu).toBeVisible();
      await menu.getByText('New note here').click();

      // Editor opens. Give chokidar a generous window to fan out any stray
      // file:changed echoes (the regression we're guarding against).
      await expect(page.locator('.editor-content .tiptap')).toBeVisible({ timeout: 15_000 });
      await page.waitForTimeout(1500);

      // Negative assertions: no "File changed externally" toast, no ".tmp." leak.
      await expect(
        page.locator('.toast', { hasText: /File changed externally/ }),
      ).toHaveCount(0);
      await expect(page.locator('.toast', { hasText: /\.tmp\./ })).toHaveCount(0);
      // The share nudge must NOT have fired yet — the user hasn't committed
      // any content.
      await expect(
        page.locator('.toast', { hasText: /is private\. Share with/ }),
      ).toHaveCount(0);

      // Type a single character — the OT 'ack' lands and drains the pending
      // nudge for the active doc.
      const surface = page.locator('.editor-content .tiptap');
      await surface.click();
      await page.keyboard.type('hello');

      // Wait for the share nudge to surface. The OT flush + ack round-trip
      // fires within ~1s; allow more headroom for slower runners.
      const nudgeToast = page.locator('.toast', {
        hasText: new RegExp(`is private\\. Share with ${bobEmail.replace(/[.@]/g, '\\$&')}`),
      });
      await expect(nudgeToast).toHaveCount(1, { timeout: 10_000 });

      // Still no spurious "File changed externally" or ".tmp." toasts after typing.
      await expect(
        page.locator('.toast', { hasText: /File changed externally/ }),
      ).toHaveCount(0);
      await expect(page.locator('.toast', { hasText: /\.tmp\./ })).toHaveCount(0);
    } finally {
      await ctx.close();
    }
  });
});
