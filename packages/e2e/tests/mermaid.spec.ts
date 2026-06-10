import { test, expect, createNote } from '../fixtures';
import jwt from 'jsonwebtoken';
import { FRONTEND_PORT } from '../playwright.config';
import type { Page, Locator } from '@playwright/test';

const BASE_URL = `http://localhost:${FRONTEND_PORT}`;

let subCounter = 800;

function makeToken(email: string): string {
  return jwt.sign({ sub: ++subCounter, email }, 'test-secret', { expiresIn: '1h' });
}

async function openNote(page: Page, token: string, notePath: string) {
  await page.goto(BASE_URL);
  await page.evaluate((t) => localStorage.setItem('kalepin_token', t), token);
  await page.goto(`${BASE_URL}/doc/${encodeURIComponent(notePath)}`);
  await expect(page.locator('.editor-content .tiptap')).toBeVisible({ timeout: 15_000 });
}

/**
 * Insert a mermaid block via the slash command and wait until it's fully
 * rendered. Returns the locator for the wrapper.
 */
async function insertMermaidViaSlashCommand(page: Page): Promise<Locator> {
  await page.locator('.editor-content .tiptap').click();
  await page.keyboard.type('/mermaid');
  await page
    .locator('.slash-menu-item')
    .filter({ hasText: /mermaid/i })
    .first()
    .click({ timeout: 5_000 });

  const wrapper = page.locator('.mermaid-wrapper').first();
  await expect(wrapper).toBeVisible({ timeout: 10_000 });
  await expect(wrapper.locator('.mermaid-rendered svg')).toBeVisible({ timeout: 15_000 });
  return wrapper;
}

test.describe('Mermaid default template', () => {
  test('/mermaid slash command inserts a renderable default diagram', async ({ page }) => {
    const noteName = `mermaid-slash-${Date.now()}.md`;
    createNote(noteName, '');
    const token = makeToken('mermaid-slash@test.com');
    await openNote(page, token, noteName);

    const wrapper = await insertMermaidViaSlashCommand(page);
    await expect(wrapper.locator('.mermaid-error')).toHaveCount(0);

    // The underlying source must contain a real newline AND a literal "-->"
    // (not the HTML-collapsed "graph LRA --&gt; B" we used to produce).
    const sourceText = await page.evaluate(() => {
      const wrap = document.querySelector('.mermaid-wrapper');
      // Source <pre> is hidden via display:none in the rendered branch but
      // textContent still contains the raw text node content.
      const hidden = wrap?.querySelector('div[style*="display: none"]') as HTMLElement | null;
      const code = wrap?.querySelector('pre, code') as HTMLElement | null;
      return (code?.textContent ?? hidden?.textContent ?? wrap?.textContent ?? '');
    });
    expect(sourceText).toContain('\n');
    expect(sourceText).toContain('-->');
    expect(sourceText).not.toContain('&gt;');
  });

  test('typing ```mermaid + Enter auto-fills with the default template', async ({ page }) => {
    const noteName = `mermaid-fence-${Date.now()}.md`;
    // Empty note so the cursor lands cleanly in the single empty paragraph.
    createNote(noteName, '');
    const token = makeToken('mermaid-fence@test.com');
    await openNote(page, token, noteName);

    await page.locator('.editor-content .tiptap').click();
    await page.keyboard.type('```mermaid');
    await page.keyboard.press('Enter');

    const wrapper = page.locator('.mermaid-wrapper').first();
    await expect(wrapper).toBeVisible({ timeout: 10_000 });
    await expect(wrapper.locator('.mermaid-rendered svg')).toBeVisible({ timeout: 15_000 });
    await expect(wrapper.locator('.mermaid-error')).toHaveCount(0);
  });
});

test.describe('Mermaid editing UX', () => {
  test('toggle button switches between rendered and source-edit views', async ({ page }) => {
    const noteName = `mermaid-toggle-${Date.now()}.md`;
    createNote(noteName, '');
    const token = makeToken('mermaid-toggle@test.com');
    await openNote(page, token, noteName);

    const wrapper = await insertMermaidViaSlashCommand(page);

    // Start: rendered view, edit mode is OFF.
    await expect(wrapper).not.toHaveClass(/mermaid-wrapper--editing/);
    await expect(wrapper.locator('.mermaid-rendered svg')).toBeVisible();

    // Click the toggle (eye icon) — switches to edit mode.
    await wrapper.locator('.mermaid-toggle-btn').click();
    await expect(wrapper).toHaveClass(/mermaid-wrapper--editing/);
    await expect(wrapper.locator('.mermaid-source')).toBeVisible();

    // Click the toggle again — switches back to rendered.
    await wrapper.locator('.mermaid-toggle-btn').click();
    await expect(wrapper).not.toHaveClass(/mermaid-wrapper--editing/);
    await expect(wrapper.locator('.mermaid-rendered svg')).toBeVisible();
  });

  test('clicking inside the source <pre> stays in edit mode (does not flip back)', async ({ page }) => {
    const noteName = `mermaid-click-inside-${Date.now()}.md`;
    createNote(noteName, '');
    const token = makeToken('mermaid-click-inside@test.com');
    await openNote(page, token, noteName);

    const wrapper = await insertMermaidViaSlashCommand(page);

    // Enter edit mode via the toggle.
    await wrapper.locator('.mermaid-toggle-btn').click();
    await expect(wrapper).toHaveClass(/mermaid-wrapper--editing/);

    // Click inside the source <pre>. Focus moves from the toggle button to
    // the editor's main contentEditable (an ancestor of the wrapper); the
    // node-view's onBlur fires but must NOT exit edit mode because the cursor
    // is still inside this block.
    await wrapper.locator('.mermaid-source').click();

    // Give any deferred blur logic a tick to run.
    await page.waitForTimeout(100);

    // Still in edit mode.
    await expect(wrapper).toHaveClass(/mermaid-wrapper--editing/);
    await expect(wrapper.locator('.mermaid-source')).toBeVisible();
    // The rendered SVG should not be visible at this point (we're editing).
    await expect(wrapper.locator('.mermaid-rendered svg')).toHaveCount(0);
  });

  test('typing in the source updates the rendered diagram after exiting edit mode', async ({ page }) => {
    const noteName = `mermaid-type-${Date.now()}.md`;
    createNote(noteName, '\nAfter paragraph.\n');
    const token = makeToken('mermaid-type@test.com');
    await openNote(page, token, noteName);

    await page.locator('.editor-content .tiptap').click();
    const wrapper = await insertMermaidViaSlashCommand(page);

    // Enter edit mode and click at the far bottom-right of the source so the
    // caret lands at the end of the last line (browsers clamp the click to
    // the closest text position; clicking past content lands at end-of-text).
    await wrapper.locator('.mermaid-toggle-btn').click();
    await expect(wrapper).toHaveClass(/mermaid-wrapper--editing/);
    const sourceBox = await wrapper.locator('.mermaid-source').boundingBox();
    if (!sourceBox) throw new Error('mermaid-source has no bounding box');
    await page.mouse.click(
      sourceBox.x + sourceBox.width - 5,
      sourceBox.y + sourceBox.height - 5,
    );
    await page.waitForTimeout(50);

    // Append a new edge.
    await page.keyboard.press('Enter');
    await page.keyboard.type('  C --> D');

    // Click another paragraph in the doc — selection moves out of the block,
    // selectionUpdate listener exits edit mode and re-renders.
    await page
      .locator('.editor-content .tiptap p')
      .filter({ hasText: 'After paragraph' })
      .click();
    await page.waitForTimeout(150);

    await expect(wrapper).not.toHaveClass(/mermaid-wrapper--editing/);
    await expect(wrapper.locator('.mermaid-rendered svg')).toBeVisible({ timeout: 10_000 });
    await expect(wrapper.locator('.mermaid-error')).toHaveCount(0);

    // Source text reflects the appended line AND preserves the default template.
    const sourceText = await page.evaluate(() => {
      const wrap = document.querySelector('.mermaid-wrapper');
      const hidden = wrap?.querySelector('div[style*="display: none"]') as HTMLElement | null;
      const pre = wrap?.querySelector('pre, code') as HTMLElement | null;
      return (pre?.textContent ?? hidden?.textContent ?? '');
    });
    expect(sourceText).toContain('A --> B');
    expect(sourceText).toContain('C --> D');
  });

  test('clicking another paragraph exits edit mode and renders', async ({ page }) => {
    const noteName = `mermaid-click-out-${Date.now()}.md`;
    createNote(noteName, '\nAfter paragraph.\n');
    const token = makeToken('mermaid-click-out@test.com');
    await openNote(page, token, noteName);

    await page.locator('.editor-content .tiptap').click();
    const wrapper = await insertMermaidViaSlashCommand(page);

    await wrapper.locator('.mermaid-toggle-btn').click();
    await expect(wrapper).toHaveClass(/mermaid-wrapper--editing/);

    // Click another paragraph in the doc — selection moves out of the block,
    // so we exit edit mode.
    await page.locator('.editor-content .tiptap p').filter({ hasText: 'After paragraph' }).click();
    await page.waitForTimeout(100);

    await expect(wrapper).not.toHaveClass(/mermaid-wrapper--editing/);
    await expect(wrapper.locator('.mermaid-rendered svg')).toBeVisible({ timeout: 10_000 });
  });

  test('empty-state placeholder is clickable and enters edit mode with caret in <pre>', async ({ page }) => {
    const noteName = `mermaid-empty-${Date.now()}.md`;
    createNote(noteName, '\nAfter paragraph.\n');
    const token = makeToken('mermaid-empty@test.com');
    await openNote(page, token, noteName);

    await page.locator('.editor-content .tiptap').click();
    const wrapper = await insertMermaidViaSlashCommand(page);

    // Enter edit mode (toggle moves cursor inside the block at end of source).
    await wrapper.locator('.mermaid-toggle-btn').click();
    await expect(wrapper).toHaveClass(/mermaid-wrapper--editing/);

    // Clear the source by backspacing exactly once per character of the
    // current source. `Meta+a` would select-all across the whole doc here
    // (Playwright dispatches it as a browser-level select-all), which would
    // delete the wrapper itself; over-backspacing chews into the next
    // paragraph. Backspaces are scoped to the cursor.
    const sourceLen = await wrapper.locator('.mermaid-source').evaluate(
      (el) => (el.textContent ?? '').length,
    );
    for (let i = 0; i < sourceLen; i++) {
      await page.keyboard.press('Backspace');
    }

    // Click another paragraph to move the cursor out of the block — exits
    // edit mode without refilling (auto-fill only fires on creation).
    await page
      .locator('.editor-content .tiptap p')
      .filter({ hasText: 'After paragraph' })
      .click();
    await page.waitForTimeout(150);

    // Placeholder should be visible: source is empty and we're not editing.
    const placeholder = wrapper.locator('.mermaid-empty');
    await expect(placeholder).toBeVisible({ timeout: 5_000 });
    await expect(placeholder).toContainText(/empty mermaid/i);

    // Click it — switches back to edit mode.
    await placeholder.click();
    await page.waitForTimeout(100);
    await expect(wrapper).toHaveClass(/mermaid-wrapper--editing/);
    await expect(wrapper.locator('.mermaid-source')).toBeVisible();
  });
});
