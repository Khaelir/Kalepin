# Frontend e2e recipe — stable doc handles

Run after `docker compose up -d` and `export JWT=$(get_jwt)` (see [README](README.md)).

Each block is a manual QA scenario covering tasks 10.2 and 10.3 of the
`add-stable-doc-handles` change.

## Scenario 1 — Open unshared doc → URL bar becomes `/doc/<id>`

```js
import { chromium } from 'playwright';

const JWT = process.env.JWT;
const browser = await chromium.launch({ headless: false });
const context = await browser.newContext();
const page = await context.newPage();

// Auth
await page.goto(`http://localhost:3000/?token=${JWT}`);
await page.waitForSelector('.sidebar', { timeout: 10000 });

// Create a fresh test note via the API so we have a known path
const path = 'doc-handle-e2e-1.md';
await page.evaluate(async (p, jwt) => {
  await fetch('/api/files/create', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${jwt}`,
    },
    body: JSON.stringify({ path: p, content: '# Hello' }),
  });
}, path, JWT);

// Navigate to the legacy path-form URL
await page.goto(`http://localhost:3000/doc/${encodeURIComponent(path)}`);
await page.waitForSelector('.editor-content .tiptap', { timeout: 10000 });

// Wait one frame for replaceState normalization
await page.waitForTimeout(200);

const url = page.url();
console.log('URL after open:', url);
// Expect: http://localhost:3000/doc/<16-char-base32-id>
const match = url.match(/\/doc\/([A-Z2-7]{16})$/);
console.assert(match, 'URL should normalize to /doc/<handle-id>');
console.log('Captured handleId:', match?.[1]);

await browser.close();
```

## Scenario 2 — Mint share link → URL bar unchanged, clipboard has `/s/<code>`

```js
// Continuing from Scenario 1's authed page, with a doc already open at /doc/<id>:
const urlBefore = page.url();

// Open the share dialog (Cmd-Shift-C is the shortcut, or click "Share" button)
await page.keyboard.press('Meta+Shift+KeyC');
await page.waitForTimeout(300);

const urlAfter = page.url();
console.assert(urlBefore === urlAfter, 'URL bar must NOT change after mint');

// Read clipboard contents
const clipboard = await page.evaluate(() => navigator.clipboard.readText());
console.assert(/\/s\/[A-Za-z0-9]{15}$/.test(clipboard),
  'Clipboard must contain /s/<code> with no cosmetic suffix');
console.log('Clipboard:', clipboard);
```

## Scenario 3 — Click `/s/<code>` while authed → URL bar normalizes to `/doc/<id>`

```js
// Extract the code from clipboard (Scenario 2 captured it):
const code = clipboard.match(/\/s\/([A-Za-z0-9]{15})/)?.[1];

// Navigate as if the user pasted the recipient URL
await page.goto(`http://localhost:3000/s/${code}`);
await page.waitForSelector('.editor-content .tiptap', { timeout: 10000 });
await page.waitForTimeout(500);

const url = page.url();
const ok = /\/doc\/[A-Z2-7]{16}$/.test(url);
console.assert(ok, `Authed visit to /s/<code> must normalize to /doc/<id>; got ${url}`);
console.log('Normalized URL:', url);
```

## Scenario 4 — `/s/<code>#heading` while authed → `/doc/<id>#heading`

```js
await page.goto(`http://localhost:3000/s/${code}#hello`);
await page.waitForSelector('.editor-content .tiptap', { timeout: 10000 });
await page.waitForTimeout(500);

const url = page.url();
const ok = /\/doc\/[A-Z2-7]{16}#hello$/.test(url);
console.assert(ok, `Heading must be preserved; got ${url}`);
```

## Scenario 5 — Legacy `/doc/<full/path>` URL still resolves and normalizes

```js
// Pre-deploy URLs may contain slashes in the path. Verify that arm still works:
const legacyUrl = `http://localhost:3000/doc/${encodeURIComponent('Notes/inner.md')}`;

// Set up the file first
await page.evaluate(async (jwt) => {
  await fetch('/api/files/create', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${jwt}` },
    body: JSON.stringify({ path: 'Notes/inner.md', content: '# Inner' }),
  });
}, JWT);

await page.goto(legacyUrl);
await page.waitForSelector('.editor-content .tiptap', { timeout: 10000 });
await page.waitForTimeout(500);

const url = page.url();
const ok = /\/doc\/[A-Z2-7]{16}$/.test(url);
console.assert(ok, `Legacy /doc/<path> should normalize; got ${url}`);
```

## Scenario 6 — Pre-deploy `/s/<code>/<cosmetic>` still resolves (cosmetic dropped)

```js
// Simulate a pre-deploy URL that includes a cosmetic suffix
await page.goto(`http://localhost:3000/s/${code}/some-old-cosmetic-name`);
await page.waitForSelector('.editor-content .tiptap', { timeout: 10000 });
await page.waitForTimeout(500);

const url = page.url();
const ok = /\/doc\/[A-Z2-7]{16}$/.test(url);
console.assert(ok, `Cosmetic suffix should be ignored; got ${url}`);
```

## Scenario 7 — Tombstoned handle renders "this note no longer exists"

```js
// Open the doc, capture its handle, then delete the file via API.
await page.goto(`http://localhost:3000/doc/${encodeURIComponent(path)}`);
await page.waitForTimeout(500);
const handleUrl = page.url();
const handleId = handleUrl.match(/\/doc\/([A-Z2-7]{16})/)?.[1];

await page.evaluate(async (p, jwt) => {
  await fetch(`/api/files/delete?path=${encodeURIComponent(p)}`, {
    method: 'DELETE', headers: { Authorization: `Bearer ${jwt}` },
  });
}, path, JWT);

// Navigate to the tombstoned handle
await page.goto(`http://localhost:3000/doc/${handleId}`);
await page.waitForSelector('.share-link-gone-card', { timeout: 5000 });

const title = await page.locator('.share-link-gone-title').textContent();
console.assert(/no longer exists/i.test(title || ''),
  'Tombstone card must say "this note no longer exists"');
```
