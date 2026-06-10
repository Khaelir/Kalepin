import { test, expect, createNote } from '../fixtures';
import { FRONTEND_PORT, VAULT_PATH } from '../playwright.config';
import fs from 'fs';
import path from 'path';

const BASE_URL = `http://localhost:${FRONTEND_PORT}`;

function makeToken(email: string): string {
  const jwt = require('jsonwebtoken');
  return jwt.sign({ sub: 999, email }, 'test-secret', { expiresIn: '1h' });
}

async function login(page: any, noteName: string) {
  const token = makeToken('drawio@test.com');
  await page.goto(BASE_URL);
  await page.evaluate((t: string) => localStorage.setItem('kalepin_token', t), token);
  await page.goto(`${BASE_URL}/doc/${encodeURIComponent(noteName)}`);
  await expect(page.locator('.editor-content .tiptap')).toBeVisible({ timeout: 15_000 });
}

// A draw.io SVG with 2 boxes and an arrow
const DIAGRAM_SVG = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" content="&lt;mxfile&gt;&lt;diagram id=&quot;t&quot; name=&quot;Page-1&quot;&gt;&lt;mxGraphModel&gt;&lt;root&gt;&lt;mxCell id=&quot;0&quot;/&gt;&lt;mxCell id=&quot;1&quot; parent=&quot;0&quot;/&gt;&lt;mxCell id=&quot;2&quot; value=&quot;Hello&quot; style=&quot;rounded=1;whiteSpace=wrap;html=1;&quot; vertex=&quot;1&quot; parent=&quot;1&quot;&gt;&lt;mxGeometry x=&quot;100&quot; y=&quot;100&quot; width=&quot;120&quot; height=&quot;60&quot; as=&quot;geometry&quot;/&gt;&lt;/mxCell&gt;&lt;mxCell id=&quot;3&quot; value=&quot;World&quot; style=&quot;rounded=1;whiteSpace=wrap;html=1;&quot; vertex=&quot;1&quot; parent=&quot;1&quot;&gt;&lt;mxGeometry x=&quot;340&quot; y=&quot;100&quot; width=&quot;120&quot; height=&quot;60&quot; as=&quot;geometry&quot;/&gt;&lt;/mxCell&gt;&lt;mxCell id=&quot;4&quot; source=&quot;2&quot; target=&quot;3&quot; edge=&quot;1&quot; parent=&quot;1&quot;&gt;&lt;mxGeometry relative=&quot;1&quot; as=&quot;geometry&quot;/&gt;&lt;/mxCell&gt;&lt;/root&gt;&lt;/mxGraphModel&gt;&lt;/diagram&gt;&lt;/mxfile&gt;" width="361" height="61" viewBox="-0.5 -0.5 361 61"><rect x="0" y="0" width="120" height="60" rx="9" ry="9" fill="#fff" stroke="#000"/><text x="60" y="34" text-anchor="middle">Hello</text><rect x="240" y="0" width="120" height="60" rx="9" ry="9" fill="#fff" stroke="#000"/><text x="300" y="34" text-anchor="middle">World</text></svg>`;

async function waitForDrawioEditor(page: any, timeout = 60_000) {
  await expect(page.locator('.drawio-modal-overlay')).toBeVisible({ timeout: 10_000 });
  await expect(page.locator('.drawio-modal-loading')).toBeHidden({ timeout });
}

test('new diagram via slash command loads editor', async ({ page }) => {
  const noteName = `drawio-new-${Date.now()}.md`;
  createNote(noteName, '# Test\n\nSome text.\n');

  page.on('console', (msg: any) => {
    const t = msg.text();
    if (t.includes('drawio') && !t.includes('storage shim')) console.log(`  ${t}`);
  });

  await login(page, noteName);

  // Create diagram via slash command
  await page.locator('.editor-content .tiptap').click();
  await page.keyboard.press('End');
  await page.keyboard.press('Enter');
  await page.keyboard.type('/drawio');
  await page.locator('.slash-menu-item').filter({ hasText: /draw/i }).click({ timeout: 5_000 });

  await waitForDrawioEditor(page);
  console.log('New diagram editor loaded');

  // Verify editor has sidebar and canvas
  const iframe = page.frame({ url: /embed\.html/ });
  expect(iframe).not.toBeNull();

  const editorState = await iframe!.evaluate(() => {
    const sidebar = !!document.querySelector('.geSidebarContainer');
    const embed = document.body.classList.contains('geEmbed');
    const canvas = !!document.querySelector('.geDiagramContainer');
    const svg = !!document.querySelector('.geDiagramContainer svg');
    // Verify CSS grid layout is active (requires geEditor class on body)
    const bodyDisplay = getComputedStyle(document.body).display;
    // Canvas must have real dimensions (was 0 height before geEditor fix)
    const container = document.querySelector('.geDiagramContainer') as HTMLElement;
    const rect = container?.getBoundingClientRect();
    return {
      sidebar, embed, canvas, svg, bodyDisplay,
      containerWidth: rect?.width ?? 0,
      containerHeight: rect?.height ?? 0,
    };
  });

  console.log('Editor state:', JSON.stringify(editorState));
  expect(editorState.sidebar).toBe(true);
  expect(editorState.embed).toBe(true);
  expect(editorState.canvas).toBe(true);
  expect(editorState.svg).toBe(true);
  expect(editorState.bodyDisplay).toBe('grid');
  expect(editorState.containerHeight).toBeGreaterThan(100);
});

test('existing diagram loads content in editor', async ({ page }) => {
  // Create attachment
  const attachDir = path.join(VAULT_PATH, '_attachments');
  fs.mkdirSync(attachDir, { recursive: true });
  const svgFile = `diagram-${Date.now()}.svg`;
  fs.writeFileSync(path.join(attachDir, svgFile), DIAGRAM_SVG);

  const noteName = `drawio-edit-${Date.now()}.md`;
  createNote(noteName, `# Edit Test\n\n![diagram](_attachments/${svgFile})\n`);

  const loadXmlLength: number[] = [];
  page.on('console', (msg: any) => {
    const t = msg.text();
    if (t.includes('drawio') && !t.includes('storage shim')) console.log(`  ${t}`);
    const match = t.match(/load action, xml length: (\d+)/);
    if (match) loadXmlLength.push(parseInt(match[1]));
  });

  await login(page, noteName);

  // Find and click the draw.io edit badge on the image
  const img = page.locator('.editor-content img[src*="attachment"], .editor-content img[src*="blob"]').first();
  await img.waitFor({ state: 'visible', timeout: 10_000 });
  if (await img.isVisible({ timeout: 5_000 }).catch(() => false)) {
    await img.hover();

    // Click the draw.io badge or any edit button overlay
    const badge = page.locator('.image-drawio-badge, .image-drawio-edit').first();
    if (await badge.isVisible({ timeout: 3_000 }).catch(() => false)) {
      await badge.click();
    } else {
      // Try clicking any button that appears on hover
      const btns = page.locator('.image-hover-actions button, .image-actions button').first();
      if (await btns.isVisible({ timeout: 2_000 }).catch(() => false)) {
        await btns.click();
      } else {
        console.log('No edit button found - checking HTML');
        const html = await page.locator('.editor-content').innerHTML();
        console.log('Editor HTML (first 500):', html.substring(0, 500));
        throw new Error('Could not find draw.io edit button');
      }
    }
  } else {
    console.log('Image not visible, checking editor content...');
    const editorText = await page.locator('.editor-content .tiptap').innerHTML();
    console.log('Editor content:', editorText.substring(0, 300));
    throw new Error('Draw.io image not visible in editor');
  }

  await waitForDrawioEditor(page);
  console.log('Existing diagram editor loaded');

  // Verify the diagram content was sent (extracted mxGraphModel XML is ~586 chars;
  // empty template is ~170 chars)
  expect(loadXmlLength.length).toBeGreaterThan(0);
  console.log('Load XML length:', loadXmlLength[0]);
  expect(loadXmlLength[0]).toBeGreaterThan(400);

  // Verify diagram shapes actually rendered in the canvas
  const iframe = page.frame({ url: /embed\.html/ });
  expect(iframe).not.toBeNull();

  const diagramState = await iframe!.evaluate(() => {
    const container = document.querySelector('.geDiagramContainer');
    if (!container) return { canvas: false, hasHello: false, hasWorld: false, svgChildCount: 0 };
    const svg = container.querySelector('svg');
    if (!svg) return { canvas: true, hasHello: false, hasWorld: false, svgChildCount: 0 };
    const hasHello = svg.textContent?.includes('Hello') ?? false;
    const hasWorld = svg.textContent?.includes('World') ?? false;
    // mxGraph renders shapes as nested SVG groups
    const svgChildCount = svg.querySelectorAll('g').length;
    return { canvas: true, hasHello, hasWorld, svgChildCount };
  });

  console.log('Diagram state:', JSON.stringify(diagramState));
  expect(diagramState.canvas).toBe(true);
  expect(diagramState.hasHello).toBe(true);
  expect(diagramState.hasWorld).toBe(true);
  expect(diagramState.svgChildCount).toBeGreaterThan(0);
});

// ---------------------------------------------------------------------------
// Regression tests for draw.io editor fixes
// ---------------------------------------------------------------------------

test('diagram canvas always has white background', async ({ page }) => {
  const noteName = `drawio-bg-${Date.now()}.md`;
  createNote(noteName, '# Test\n\nSome text.\n');
  await login(page, noteName);

  // Open draw.io editor via slash command
  await page.locator('.editor-content .tiptap').click();
  await page.keyboard.press('End');
  await page.keyboard.press('Enter');
  await page.keyboard.type('/drawio');
  await page.locator('.slash-menu-item').filter({ hasText: /draw/i }).click({ timeout: 5_000 });
  await waitForDrawioEditor(page);

  // Check the Kalepin modal overlay has fixed white background (not theme-dependent)
  const overlayBg = await page.locator('.drawio-modal-overlay').evaluate(
    (el: Element) => getComputedStyle(el).backgroundColor,
  );
  expect(overlayBg).toBe('rgb(255, 255, 255)');

  // Check inside the iframe
  const iframe = page.frame({ url: /embed\.html/ });
  expect(iframe).not.toBeNull();

  const iframeStyles = await iframe!.evaluate(() => {
    // color-scheme should be forced to light
    const colorScheme = getComputedStyle(document.documentElement).colorScheme;
    // Diagram container background
    const container = document.querySelector('.geDiagramContainer') as HTMLElement;
    const containerBg = container ? getComputedStyle(container).backgroundColor : '';
    return { colorScheme, containerBg };
  });

  console.log('Iframe styles:', JSON.stringify(iframeStyles));
  expect(iframeStyles.colorScheme).toBe('light');
  // Background should be white (rgb(255,255,255)) not dark
  expect(iframeStyles.containerBg).toBe('rgb(255, 255, 255)');
});

test('popup menus use absolute positioning', async ({ page }) => {
  const noteName = `drawio-menu-${Date.now()}.md`;
  createNote(noteName, '# Test\n\nSome text.\n');
  await login(page, noteName);

  await page.locator('.editor-content .tiptap').click();
  await page.keyboard.press('End');
  await page.keyboard.press('Enter');
  await page.keyboard.type('/drawio');
  await page.locator('.slash-menu-item').filter({ hasText: /draw/i }).click({ timeout: 5_000 });
  await waitForDrawioEditor(page);

  const iframe = page.frame({ url: /embed\.html/ });
  expect(iframe).not.toBeNull();

  // Click the File menu inside the draw.io editor
  const fileMenu = iframe!.locator('.geMenubar .geItem').first();
  await fileMenu.click({ timeout: 5_000 });

  // Wait for popup menu to appear
  await expect(iframe!.locator('div.mxPopupMenu')).toBeVisible({ timeout: 3_000 });

  // Verify the popup menu uses mxGraph's default position:absolute
  const menuState = await iframe!.evaluate(() => {
    const popup = document.querySelector('div.mxPopupMenu') as HTMLElement;
    if (!popup) return { position: '', top: 0, viewportHeight: 0 };
    const style = getComputedStyle(popup);
    return {
      position: style.position,
      top: popup.getBoundingClientRect().top,
      viewportHeight: window.innerHeight,
    };
  });

  console.log('Menu state:', JSON.stringify(menuState));
  expect(menuState.position).toBe('absolute');
  // The menu should appear in the top portion of the viewport (near the menu bar)
  expect(menuState.top).toBeLessThan(menuState.viewportHeight * 0.3);
});

test('double-click to edit cell positions editor on shape', async ({ page }) => {
  // Use the existing diagram with shapes so we have cells to double-click
  const attachDir = path.join(VAULT_PATH, '_attachments');
  fs.mkdirSync(attachDir, { recursive: true });
  const svgFile = `diagram-editor-${Date.now()}.svg`;
  fs.writeFileSync(path.join(attachDir, svgFile), DIAGRAM_SVG);

  const noteName = `drawio-editor-pos-${Date.now()}.md`;
  createNote(noteName, `# Editor Position Test\n\n![diagram](_attachments/${svgFile})\n`);
  await login(page, noteName);

  // Open the draw.io editor — wait for the draw.io edit button to appear
  const img = page.locator('.editor-content img[src*="attachment"], .editor-content img[src*="blob"]').first();
  await img.waitFor({ state: 'visible', timeout: 10_000 });

  // Hover to reveal action buttons, then wait for draw.io detection
  await img.hover();
  const editBtn = page.locator('.drawio-edit-btn').first();
  await expect(editBtn).toBeVisible({ timeout: 10_000 });
  await editBtn.click({ force: true });
  await waitForDrawioEditor(page);

  const iframe = page.frame({ url: /embed\.html/ });
  expect(iframe).not.toBeNull();

  // Wait for shapes to render
  await expect(async () => {
    const hasShapes = await iframe!.evaluate(() => {
      const svg = document.querySelector('.geDiagramContainer svg');
      return svg ? svg.querySelectorAll('g').length > 2 : false;
    });
    expect(hasShapes).toBe(true);
  }).toPass({ timeout: 10_000 });

  // Find a shape element and double-click it via dispatched events.
  // mxGraph renders text in <foreignObject>, not <text>. We find the "Hello"
  // cell's foreignObject and dispatch a dblclick on its parent <g> group.
  const triggered = await iframe!.evaluate(() => {
    const container = document.querySelector('.geDiagramContainer') as HTMLElement;
    if (!container) return false;
    const fos = container.querySelectorAll('svg foreignObject');
    let target: Element | null = null;
    for (const fo of fos) {
      if (fo.textContent?.includes('Hello')) {
        target = fo.closest('g') || fo;
        break;
      }
    }
    if (!target) return false;
    const rect = target.getBoundingClientRect();
    const x = rect.x + rect.width / 2;
    const y = rect.y + rect.height / 2;
    const opts = { bubbles: true, clientX: x, clientY: y, detail: 2 };
    target.dispatchEvent(new MouseEvent('dblclick', opts));
    return true;
  });
  console.log('Dispatched dblclick on shape:', triggered);
  expect(triggered).toBe(true);

  // Wait for the cell editor to appear (retry-aware)
  await expect(async () => {
    const hasEditor = await iframe!.evaluate(
      () => !!document.querySelector('.mxCellEditor'),
    );
    expect(hasEditor).toBe(true);
  }).toPass({ timeout: 5_000 });

  // Verify the cell editor is positioned on the shape, not at (0,0)
  const editorState = await iframe!.evaluate(() => {
    const editor = document.querySelector('.mxCellEditor') as HTMLElement;
    const rect = editor.getBoundingClientRect();
    return { top: rect.top, left: rect.left };
  });

  console.log('Editor state:', JSON.stringify(editorState));
  expect(editorState.top).toBeGreaterThan(0);
  expect(editorState.left).toBeGreaterThan(0);
});
