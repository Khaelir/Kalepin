import { test as base, expect, type Page, type BrowserContext } from '@playwright/test';
import jwt from 'jsonwebtoken';
import fs from 'fs';
import path from 'path';
import { VAULT_PATH, FRONTEND_PORT, BACKEND_PORT } from './playwright.config';

const JWT_SECRET = 'test-secret';
let userCounter = 0;

function makeToken(email: string): string {
  // sub must be a number; use a hash-like counter for uniqueness
  const sub = ++userCounter;
  return jwt.sign({ sub, email }, JWT_SECRET, { expiresIn: '1h' });
}

export function createNote(name: string, content: string): string {
  const filePath = path.join(VAULT_PATH, name);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, 'utf-8');
  return name;
}

async function authenticateAndOpen(page: Page, token: string, notePath: string) {
  // Set token in localStorage before navigating
  const baseURL = `http://localhost:${FRONTEND_PORT}`;
  await page.goto(baseURL);
  await page.evaluate((t) => {
    localStorage.setItem('kalepin_token', t);
  }, token);

  // Navigate to the note
  await page.goto(`${baseURL}/doc/${encodeURIComponent(notePath)}`);

  // Wait for the TipTap editor to be ready
  await expect(page.locator('.editor-content .tiptap')).toBeVisible({ timeout: 15_000 });
}

interface EditorPageFixture {
  page: Page;
  notePath: string;
}

interface CollaborationPair {
  pageA: Page;
  pageB: Page;
  notePath: string;
  waitForSync: (source: Page, target: Page, expectedText: string) => Promise<void>;
}

export const test = base.extend<{
  editorPage: EditorPageFixture;
  collaborationPair: CollaborationPair;
}>({
  editorPage: async ({ page }, use) => {
    const noteName = `test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.md`;
    createNote(noteName, '# Test Note\n\nHello world.\n');
    const token = makeToken('testuser@example.com');
    await authenticateAndOpen(page, token, noteName);
    await use({ page, notePath: noteName });
  },

  collaborationPair: async ({ browser }, use) => {
    const noteName = `collab-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.md`;
    createNote(noteName, '');
    const tokenA = makeToken('alice@example.com');
    const tokenB = makeToken('bob@example.com');

    const contextA = await browser.newContext();
    const contextB = await browser.newContext();
    const pageA = await contextA.newPage();
    const pageB = await contextB.newPage();

    await authenticateAndOpen(pageA, tokenA, noteName);
    await authenticateAndOpen(pageB, tokenB, noteName);

    const waitForSync = async (_source: Page, target: Page, expectedText: string) => {
      await expect(async () => {
        const text = await target.locator('.editor-content .tiptap').innerText();
        expect(text).toContain(expectedText);
      }).toPass({ timeout: 10_000 });
    };

    await use({ pageA, pageB, notePath: noteName, waitForSync });

    await contextA.close();
    await contextB.close();
  },
});

export { expect };
