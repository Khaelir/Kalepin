import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { rewriteMarkdownForGuest } from './asset-rewriter';

const stubMinter = {
  mintAssetToken: ({ code, assetPath }: { code: string; assetPath: string }) => ({
    token: `tok(${code}:${assetPath})`,
    expiresAt: 1,
  }),
};

describe('rewriteMarkdownForGuest', () => {
  it('rewrites a basic markdown image reference', () => {
    const input = '![alt](_attachments/abc.png)';
    const out = rewriteMarkdownForGuest(input, 'CODE001', stubMinter);
    assert.equal(
      out,
      '![alt](/api/share-links/CODE001/asset?name=abc.png&st=tok(CODE001%3Aabc.png))',
    );
  });

  it('rewrites a relative-climb image reference (../_attachments/...)', () => {
    const input = '![](../_attachments/foo.gif)';
    const out = rewriteMarkdownForGuest(input, 'CODE001', stubMinter);
    assert.match(
      out,
      /\/api\/share-links\/CODE001\/asset\?name=foo\.gif&st=tok/,
    );
  });

  it('rewrites a markdown attachment download link', () => {
    const input = '[Download the slides](_attachments/deck.pdf)';
    const out = rewriteMarkdownForGuest(input, 'CODE001', stubMinter);
    assert.match(out, /\/api\/share-links\/CODE001\/asset\?name=deck\.pdf/);
  });

  it('rewrites HTML <img src="..."> references', () => {
    const input = '<img src="_attachments/diagram.svg" alt="d">';
    const out = rewriteMarkdownForGuest(input, 'CODE001', stubMinter);
    assert.match(out, /<img src="\/api\/share-links\/CODE001\/asset\?name=diagram\.svg/);
  });

  it('handles single-quoted HTML src too', () => {
    const input = "<img src='_attachments/x.png'>";
    const out = rewriteMarkdownForGuest(input, 'CODE001', stubMinter);
    assert.match(out, /\/api\/share-links\/CODE001\/asset\?name=x\.png/);
  });

  it('leaves external URLs untouched', () => {
    const input = '![alt](https://cdn.example.com/img.png)';
    const out = rewriteMarkdownForGuest(input, 'CODE001', stubMinter);
    assert.equal(out, input);
  });

  it('leaves plain markdown text untouched (no _attachments substring)', () => {
    const input = 'Just a # heading and **bold** text. No images here.';
    assert.equal(rewriteMarkdownForGuest(input, 'CODE001', stubMinter), input);
  });

  it('rewrites multiple references in the same line', () => {
    const input = '![a](_attachments/a.png) and ![b](_attachments/b.png)';
    const out = rewriteMarkdownForGuest(input, 'CODE001', stubMinter);
    assert.match(out, /a\.png/);
    assert.match(out, /b\.png/);
    assert.equal(out.match(/\/asset\?name=/g)?.length, 2);
  });

  it('does not rewrite a literal mention of _attachments outside a link', () => {
    const input = 'The folder `_attachments/` holds binary blobs.';
    assert.equal(rewriteMarkdownForGuest(input, 'CODE001', stubMinter), input);
  });

  it('blanks out traversal-looking names so the browser cannot dispatch a relative fetch', () => {
    // Captured name is `..`; the rewriter replaces the entire URL with the
    // empty string so the rendered <img>/link points nowhere. The point: a
    // traversal target must NOT survive into the rendered DOM as a relative
    // URL the browser would fetch from the guest page's origin.
    const input = '![evil](_attachments/../etc/passwd)';
    const out = rewriteMarkdownForGuest(input, 'CODE001', stubMinter);
    assert.equal(out, '![evil]()');
    assert.ok(!out.includes('/etc/passwd'));
    assert.ok(!out.includes('..'));
  });

  it('preserves the alt text and surrounding markdown', () => {
    const input = '# Title\n\nSee ![diagram of flow](_attachments/flow.svg) for context.';
    const out = rewriteMarkdownForGuest(input, 'CODE001', stubMinter);
    assert.ok(out.startsWith('# Title\n\n'));
    assert.ok(out.includes('![diagram of flow](/api/share-links/CODE001/asset?name=flow.svg'));
    assert.ok(out.endsWith(' for context.'));
  });
});
